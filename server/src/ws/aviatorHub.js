// Aviator 全局共享房间：驱动 waiting -> flying -> crashed 的状态机，
// 所有连接上来的客户端看到的是同一局、同一个崩盘点（crash 类游戏的本质：
// 房间只有一个，不是每个玩家各跑各的随机数）。
//
// 这批不接钱：不调用 wallet/credit/commission，rounds 记录 player_id 恒为 NULL，
// 只负责把「可验证公平」的开奖流程通过 WebSocket 广播出去。
import { query } from '../db.js';
import {
  hashSeed,
  generateCrash,
  multiplierAt,
  newServerSeed,
  newClientSeed,
} from '../game/aviator.js';

const BETTING_MS = 5000; // 下注窗口，与前端 Aviator.jsx 的 BETTING_MS 一致
const CRASHED_PAUSE_MS = 3000; // 开奖后到下一局开始的停顿
const TICK_MS = 100; // 飞行阶段广播频率

// 模块级单例状态：整个进程只有一个房间。
// serverSeed/crashPoint 是「私密」字段，只在内存里活着，crashed 广播时才 reveal，
// 任何时候都不允许在 betting/flying 阶段的广播或日志里出现。
const state = {
  phase: 'betting', // 'betting' | 'flying' | 'crashed'
  nonce: 0,
  roundId: null,
  serverSeed: null,
  clientSeed: null,
  commitHash: null,
  crashPoint: null,
  flyStart: null,
};

// 定时器句柄留引用，方便以后需要停止房间时清理（常驻服务，写规范一点）。
const timers = {
  bettingTimeout: null,
  flyingInterval: null,
  crashedTimeout: null,
};

let started = false;

function broadcast(wss, payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    // 1 === WebSocket.OPEN
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

async function insertPendingRound() {
  try {
    const result = await query(
      `INSERT INTO rounds(game, player_id, server_seed, client_seed, result_hash, status)
       VALUES('aviator', NULL, $1, $2, $3, 'pending')
       RETURNING id`,
      [state.serverSeed, state.clientSeed, state.commitHash],
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    // 插入失败只记日志，不阻断游戏循环（这批不接钱，rounds 记录是旁路审计用途）。
    console.error('[aviatorHub] 插入 pending round 失败：', err.message);
    return null;
  }
}

async function markRoundCrashed(roundId, crashPoint) {
  if (!roundId) return;
  try {
    await query(
      `UPDATE rounds SET status = 'crashed', payout = NULL, result = $1::jsonb WHERE id = $2`,
      [JSON.stringify({ crashPoint }), roundId],
    );
  } catch (err) {
    console.error('[aviatorHub] 更新 crashed round 失败：', err.message);
  }
}

async function runWaitingPhase(wss) {
  const serverSeed = newServerSeed();
  const clientSeed = newClientSeed();
  const nonce = state.nonce;
  const crashPoint = generateCrash(serverSeed, clientSeed, nonce);
  const commitHash = hashSeed(serverSeed);

  state.phase = 'betting';
  state.serverSeed = serverSeed;
  state.clientSeed = clientSeed;
  state.commitHash = commitHash;
  state.crashPoint = crashPoint;
  state.nonce = nonce;
  state.roundId = null;

  const roundId = await insertPendingRound();
  state.roundId = roundId;

  // 只广播 commitHash，绝不广播 serverSeed、也绝不广播 crashPoint。
  broadcast(wss, {
    type: 'betting',
    roundId,
    nonce,
    clientSeed,
    commitHash,
    waitMs: BETTING_MS,
  });

  timers.bettingTimeout = setTimeout(() => {
    runFlyingPhase(wss);
  }, BETTING_MS);
}

function runFlyingPhase(wss) {
  state.phase = 'flying';
  state.flyStart = Date.now();

  timers.flyingInterval = setInterval(() => {
    const elapsed = (Date.now() - state.flyStart) / 1000;
    const mult = multiplierAt(elapsed);

    if (mult >= state.crashPoint) {
      clearInterval(timers.flyingInterval);
      runCrashedPhase(wss);
      return;
    }

    broadcast(wss, {
      type: 'tick',
      roundId: state.roundId,
      multiplier: mult,
    });
  }, TICK_MS);
}

async function runCrashedPhase(wss) {
  state.phase = 'crashed';
  const { roundId, crashPoint, serverSeed, clientSeed, nonce } = state;

  // 到这一刻才 reveal serverSeed —— 任何人都可以用 clientSeed+nonce+serverSeed
  // 重算 generateCrash() 验证 crashPoint 没被临时改过，也可以 sha256(serverSeed)
  // 校验和 betting 阶段广播的 commitHash 一致。
  broadcast(wss, {
    type: 'crashed',
    roundId,
    crashPoint,
    serverSeed,
    clientSeed,
    nonce,
  });

  await markRoundCrashed(roundId, crashPoint);

  timers.crashedTimeout = setTimeout(() => {
    state.nonce += 1;
    runWaitingPhase(wss);
  }, CRASHED_PAUSE_MS);
}

/**
 * 启动 Aviator 全局房间的状态机循环，并挂上新连接的 hello 快照。
 * 模块级单例：重复调用会被忽略，避免起两个并行的房间循环。
 * @param {import('ws').WebSocketServer} wss
 */
export function startAviatorHub(wss) {
  if (started) {
    console.error('[aviatorHub] startAviatorHub 被重复调用，已忽略');
    return;
  }
  started = true;

  wss.on('connection', (ws) => {
    // 新连接进来时给一个最简快照，至少不报错；不在这里补发完整的
    // betting/flying 现场数据（那些数据会随下一次 broadcast 自然到达）。
    ws.send(JSON.stringify({ type: 'hello', phase: state.phase }));
  });

  runWaitingPhase(wss).catch((err) => {
    console.error('[aviatorHub] 启动房间循环失败：', err.message);
  });
}
