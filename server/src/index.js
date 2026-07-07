// 服务入口
// 说明：/health 是纯进程存活探针；此外挂载登录鉴权（/auth）和一局协议（/round）路由。
import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import authRouter from './routes/auth.js';
import roundRouter from './routes/round.js';
import agentRouter from './routes/agent.js';
import { startAviatorHub } from './ws/aviatorHub.js';

const app = express();

// CORS 白名单：从环境变量读取，逗号分隔支持多个来源
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
};

app.use(cors(corsOptions));
app.use(express.json());

// 存活探针：不查数据库，纯进程健康检查
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/round', roundRouter);
app.use('/agent', agentRouter);

// 404 兜底
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 统一错误处理中间件：对客户端只返回 JSON { error }，绝不泄露堆栈信息；
// 服务端可以 console.error 记录排查用的错误详情，但严禁打印密码/token 等敏感字段。
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[unhandled error]', err.message);

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
const wss = new WebSocketServer({ server, path: '/ws/aviator' });

// WS 握手认证：连接建立时用 query string 里的 token 校验身份，只允许 player 类型连接。
// 这个 handler 在 startAviatorHub(wss) 之前注册，'connection' 事件的多个监听器按注册顺序
// 同步依次触发，所以等 hub 内部的 connection handler 跑起来时，ws.playerId 已经挂好。
// 严禁在任何日志里打印 token 原文，认证失败静默关闭连接。
wss.on('connection', (ws, req) => {
  try {
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

server.listen(PORT, () => {
  console.log(`spribe-server 已启动，监听端口 ${PORT}`);
  console.log(`WebSocket 实时通道已就绪：ws://localhost:${PORT}/ws/aviator`);
});
