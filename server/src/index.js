// 服务入口
// 说明：/health 是纯进程存活探针；此外挂载登录鉴权（/auth）和一局协议（/round）路由。
import 'dotenv/config';
import http from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { WebSocketServer } from 'ws';
import authRouter from './routes/auth.js';
import roundRouter from './routes/round.js';
import agentRouter from './routes/agent.js';
import playerRouter from './routes/player.js';
import seedRouter from './routes/seed.js';
import issuesRouter from './routes/issues.js';
import tenantsRouter from './routes/tenants.js';
import dashboardRouter from './routes/dashboard.js';
import feesRouter from './routes/fees.js';
import riskRouter from './routes/risk.js';
import { startAviatorHub } from './ws/aviatorHub.js';
import { startMomentumHub } from './ws/momentumHub.js';
import { startRoundHub } from './ws/roundHub.js';
import { RiskError } from './lib/risk.js';

// ESM 下手动还原 __dirname，供 express.static 定位 uploads/ 目录。
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// CORS 白名单：从环境变量读取，逗号分隔支持多个来源。
// 这份数组是模块级共享变量，HTTP 层的 cors 中间件和下面 WS 握手的 origin 校验都用它，
// 保证两条通道对「谁是合法来源」的判断口径一致。
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // 无 origin（例如服务端调用、curl、同源请求）直接放行
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS: 该来源不在白名单内'));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// 静态托管上传的问题截图：uploads/ 目录映射到 /uploads 访问路径。
// 例：uploads/issues/<hash>.png → GET /uploads/issues/<hash>.png
// 只读托管，不接受这里的写入；上传统一走 POST /issues/:id/images。
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// 登录限流：15 分钟内同一来源最多 20 次尝试，防暴力破解密码。
// 只挂在 /auth/login 这一条路径上，其余接口（含 /auth 下其它路由，若未来新增）不受影响。
// 注：express-rate-limit 默认用内存计数，单进程部署够用；后续如果多实例横向扩展，
// 要换成 Redis 等共享存储的 store，否则各实例各算各的，限流会形同虚设。
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登录尝试过于频繁，请稍后再试' },
});
app.use('/auth/login', loginLimiter);

// 存活探针：不查数据库，纯进程健康检查
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/round', roundRouter);
app.use('/agent', agentRouter);
app.use('/player', playerRouter);
app.use('/seed', seedRouter);
app.use('/issues', issuesRouter);
app.use('/tenants', tenantsRouter);
app.use('/dashboard', dashboardRouter);
app.use('/fees', feesRouter);
app.use('/risk', riskRouter);

// 404 兜底
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 统一错误处理中间件：对客户端只返回 JSON { error }，绝不泄露堆栈信息；
// 服务端可以 console.error 记录排查用的错误详情，但严禁打印密码/token 等敏感字段。
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[unhandled error]', err.message);

  // 风控拦截（下注超限/派彩封顶等）：RiskError 自带 status 与可辨识的 code，直接透出。
  if (err instanceof RiskError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  // 路由主动抛出的、带显式 4xx status 的客户端错误（如账单非法 game 筛选值）：按其 status 透出。
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }

  // 业务代码里主动抛出的「余额不足」「钱包不存在」等属于客户端可读的提示，用 400 返回；
  // 其余未预期的异常按 500 处理，且不把 err.stack 等内部细节吐给客户端。
  const knownBusinessErrors = ['余额不足', '钱包不存在'];
  if (knownBusinessErrors.includes(err.message)) {
    return res.status(400).json({ error: err.message });
  }

  return res.status(500).json({ error: '服务器内部错误' });
});

const PORT = process.env.PORT || 4000;

// HTTP + WebSocket 共用同一个端口：express app 挂在 http server 上，
// Aviator 的实时通道走 /ws/aviator 这条独立 path，互不干扰。
const server = http.createServer(app);
// 多 WSS 挂同一 http server：用 noServer + 单一 upgrade 路由按 path 分发（避免多个 WSS 都 hook
// 'upgrade' 事件时 perMessageDeflate 协商互撞导致 "RSV1 must be clear"）。
const wss = new WebSocketServer({ noServer: true });

// WS 握手认证：连接建立时用 query string 里的 token 校验身份，只允许 player 类型连接。
// 这个 handler 在 startAviatorHub(wss) 之前注册，'connection' 事件的多个监听器按注册顺序
// 同步依次触发，所以等 hub 内部的 connection handler 跑起来时，ws.playerId 已经挂好。
// 严禁在任何日志里打印 token 原文，认证失败静默关闭连接。
wss.on('connection', (ws, req) => {
  try {
    // Origin 校验：和 HTTP 层的 CORS 白名单共用同一份 allowedOrigins。
    // 无 origin（node 脚本 / curl 直连 WS 本来就不带这个头）放行；
    // 带了 origin 但不在白名单里的一律拒绝，防止恶意网页跨站发起 WS 连接。
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      ws.close(1008, '来源不允许');
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const payload = jwt.verify(token, process.env.JWT_SECRET); // 失败抛异常
    if (payload.type !== 'player') throw new Error('仅玩家可连');
    ws.playerId = payload.sub;
    ws.playerName = payload.username;
  } catch (e) {
    console.error('[ws] WS 认证失败');
    try {
      ws.close(1008, '认证失败');
    } catch {
      // 关闭失败无需处理，连接大概率已经异常
    }
  }
});

startAviatorHub(wss);

// Momentum 实时通道走 /ws/momentum（独立 path，与 aviator 互不干扰）。同款握手认证（token + Origin）。
const momentumWss = new WebSocketServer({ noServer: true });
momentumWss.on('connection', (ws, req) => {
  try {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) { ws.close(1008, '来源不允许'); return; }
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== 'player') throw new Error('仅玩家可连');
    ws.playerId = payload.sub;
    ws.playerName = payload.username;
  } catch (e) {
    console.error('[ws] Momentum WS 认证失败');
    try { ws.close(1008, '认证失败'); } catch { /* 连接已异常 */ }
  }
});
startMomentumHub(momentumWss);

// 轮次排期器实时通道走 /ws/rounds（独立 path，与 aviator/momentum 互不干扰）。同款握手认证（token + Origin）。
const roundsWss = new WebSocketServer({ noServer: true });
roundsWss.on('connection', (ws, req) => {
  try {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) { ws.close(1008, '来源不允许'); return; }
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== 'player') throw new Error('仅玩家可连');
    ws.playerId = payload.sub;
    ws.playerName = payload.username;
  } catch (e) {
    console.error('[ws] Rounds WS 认证失败');
    try { ws.close(1008, '认证失败'); } catch { /* 连接已异常 */ }
  }
});
startRoundHub(roundsWss);

// 单一 upgrade 路由：按 pathname 分发到对应 WSS（noServer 模式各自不 hook upgrade，这里统一路由）。
server.on('upgrade', (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { socket.destroy(); return; }
  if (pathname === '/ws/aviator') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname === '/ws/momentum') {
    momentumWss.handleUpgrade(req, socket, head, (ws) => momentumWss.emit('connection', ws, req));
  } else if (pathname === '/ws/rounds') {
    roundsWss.handleUpgrade(req, socket, head, (ws) => roundsWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// 默认 0.0.0.0（dev/现 prod 行为不变）；prod 可用 HOST=127.0.0.1 收口到本机（配反代）。
server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`spribe-server 已启动，监听 ${process.env.HOST || '0.0.0.0'}:${PORT}`);
  console.log(`WebSocket 实时通道已就绪：ws://localhost:${PORT}/ws/aviator`);
  console.log(`Momentum 实时通道已就绪：ws://localhost:${PORT}/ws/momentum`);
  console.log(`轮次排期器实时通道已就绪：ws://localhost:${PORT}/ws/rounds`);
});
