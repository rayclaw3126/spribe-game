// Aviator 全局共享房间：驱动 waiting -> flying -> crashed 的状态机，
// 所有连接上来的客户端看到的是同一局、同一个崩盘点（crash 类游戏的本质：
// 房间只有一个，不是每个玩家各跑各的随机数）。
//
// 这批接钱：下注/兑现/结算的资金变动只通过 lib/wallet.js 的 debit/credit，
// 输局的链式分成只通过 lib/commission.js 的 distributeLoss，本文件不直接
// UPDATE wallets 或 INSERT commissions；rounds 记录 player_id 仍恒为 NULL
// （这是共享房间，不是某个玩家私有的一局），真正的归属关系落在 bets 表上。
import { query, withTransaction } from '../db.js';
import { debit, credit } from '../lib/wallet.js';
import { assertBetWithinLimits, assertPayoutCap, RiskError } from '../lib/risk.js';
import { distributeLoss } from '../lib/commission.js';
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
  bettingStart: null, // betting 阶段开始时间戳（ms）—— 支撑中途加入时的 snapshot 剩余时间计算
  // 本局下注表：key = playerId（字符串，来自 JWT payload.sub），
  // value = { amount, cashedOut, betId, agentId, payout }。
  // 每局 betting 阶段开始时清空（runWaitingPhase），crashed 阶段结算时读取。
  bets: new Map(),
};

// 定时器句柄留引用，方便以后需要停止房间时清理（常驻服务，写规范一点）。
const timers = {
  bettingTimeout: null,
  flyingInterval: null,
  crashedTimeout: null,
};

let started = false;

function sendJSON(ws, payload) {
  // 1 === WebSocket.OPEN；连接已关闭/正在关闭时静默丢弃，不抛异常。
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

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
  state.bettingStart = Date.now(); // 支撑 snapshot 里 betting 阶段的剩余时间计算
  // 新的一局开始：清空上一局的下注表，避免残留上一局玩家的 cashedOut/payout 状态。
  state.bets.clear();

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

/**
 * 崩盘后结算本局所有未兑现的下注（= 输家）：
 *   - 钱已经在下注时通过 wallet.debit 扣走，崩盘后不返还；
 *   - 每个输家单独走一次 distributeLoss（唯一分成入口）+ 把该笔 bet 标记 outcome='lose'；
 *   - 已经 cashedOut 的赢家在 cashout 时已经把 outcome 置为 'win'，这里不再处理；
 *   - 单个玩家结算失败只记日志，不阻断其他玩家的结算（同局多玩家各自独立）。
 * @param {import('ws').WebSocketServer} wss
 */
async function settleRound(wss) {
  const { roundId, bets } = state;

  for (const [playerId, bet] of bets) {
    if (bet.cashedOut) continue; // 赢家：cashout 时已经结算过

    try {
      // eslint-disable-next-line no-await-in-loop
      await withTransaction(async (client) => {
        await distributeLoss(client, {
          playerId,
          agentId: bet.agentId,
          roundId,
          lossAmount: bet.amount,
        });
        await client.query(`UPDATE bets SET outcome = 'lose' WHERE id = $1`, [bet.betId]);
      });
    } catch (err) {
      console.error(`[aviatorHub] 结算输家失败 playerId=${playerId}：`, err.message);
    }
  }

  broadcast(wss, { type: 'settled', roundId });
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
  await settleRound(wss);

  timers.crashedTimeout = setTimeout(() => {
    state.nonce += 1;
    runWaitingPhase(wss);
  }, CRASHED_PAUSE_MS);
}

/**
 * 处理下注消息 {type:'bet', amount}。
 * 钱只走 wallet.debit（事务 + 幂等键 aviator-${roundId}-${playerId}），
 * hub 本身不直接 UPDATE wallets。
 * @param {import('ws').WebSocket} ws - 已认证（ws.playerId 存在）的连接
 * @param {{amount: number|string}} msg
 */
async function handleBet(ws, msg) {
  const playerId = ws.playerId;

  if (state.phase !== 'betting') {
    sendJSON(ws, { type: 'bet_rejected', reason: '非下注阶段' });
    return;
  }

  const rawAmount = Number(msg.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    sendJSON(ws, { type: 'bet_rejected', reason: '下注金额无效' });
    return;
  }
  const amount = rawAmount.toFixed(2);

  // 风控前置（WS 专用）：注额超限直接拒。RiskError 不能靠 HTTP 中间件兜，
  // 这里就地转成 bet_rejected 帧并带 code，绝不落到下面兜底的「请重试」。
  try {
    assertBetWithinLimits('aviator', amount);
  } catch (err) {
    if (err instanceof RiskError) {
      sendJSON(ws, { type: 'bet_rejected', reason: err.message, code: err.code });
      return;
    }
    throw err;
  }

  // 幂等：内存里已经记过这个玩家本局的下注，直接回已有信息，不重复扣钱。
  const existing = state.bets.get(playerId);
  if (existing) {
    sendJSON(ws, {
      type: 'bet_ack',
      roundId: state.roundId,
      amount: existing.amount,
      idempotent: true,
    });
    return;
  }

  const roundId = state.roundId;
  const idempotencyKey = `aviator-${roundId}-${playerId}`;

  try {
    const { betId, agentId, balanceAfter } = await withTransaction(async (client) => {
      const { balanceAfter: after } = await debit(client, {
        playerId,
        amount,
        type: 'aviator_bet',
        idempotencyKey,
        roundId,
      });

      const betResult = await client.query(
        `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome)
         VALUES ($1, $2, $3::numeric, $4, 'pending')
         RETURNING id`,
        [roundId, playerId, amount, idempotencyKey],
      );

      const playerResult = await client.query('SELECT agent_id FROM players WHERE id = $1', [playerId]);

      return {
        betId: betResult.rows[0].id,
        agentId: playerResult.rows[0]?.agent_id ?? null,
        balanceAfter: after,
      };
    });

    // 防御：下注写库期间房间恰好翻页到下一局（betting 窗口极短的边界情况），
    // 这一注仍然真实落库、钱已扣，只是本局内存 Map 不再登记它参与本局结算。
    if (state.roundId === roundId) {
      state.bets.set(playerId, { amount, cashedOut: false, betId, agentId, payout: null });
    } else {
      console.error('[aviatorHub] 下注写库完成但房间已翻页，roundId 不一致，跳过内存登记');
    }

    sendJSON(ws, { type: 'bet_ack', roundId, amount, balanceAfter, idempotent: false });
  } catch (err) {
    if (err.code === '23505') {
      // 唯一索引冲突：并发重复下注消息导致的竞态，回查已落库的记录按幂等命中处理。
      try {
        const existingBet = await query('SELECT amount FROM bets WHERE idempotency_key = $1', [idempotencyKey]);
        sendJSON(ws, {
          type: 'bet_ack',
          roundId,
          amount: existingBet.rows[0]?.amount ?? amount,
          idempotent: true,
        });
      } catch (lookupErr) {
        console.error('[aviatorHub] 幂等回查失败：', lookupErr.message);
        sendJSON(ws, { type: 'bet_rejected', reason: '下注失败，请重试' });
      }
      return;
    }

    if (err.message === '余额不足' || err.message === '钱包不存在') {
      sendJSON(ws, { type: 'bet_rejected', reason: err.message });
      return;
    }

    console.error('[aviatorHub] 下注处理异常：', err.message);
    sendJSON(ws, { type: 'bet_rejected', reason: '下注失败，请重试' });
  }
}

/**
 * 处理兑现消息 {type:'cashout'}。
 * 兑现倍数完全由服务端算（multiplierAt + state.flyStart），绝不信客户端传的倍数；
 * 竞态兜底：算出来的 mult 若已经 >= crashPoint，说明这一刻其实已经崩了（飞行阶段的
 * setInterval 每 100ms 才检测一次，存在这个窗口），直接拒绝、不 credit，
 * 该玩家会在 crashed 阶段结算时按输家处理。
 * @param {import('ws').WebSocket} ws - 已认证（ws.playerId 存在）的连接
 */
async function handleCashout(ws) {
  const playerId = ws.playerId;

  if (state.phase !== 'flying') {
    sendJSON(ws, { type: 'cashout_rejected', reason: '非飞行阶段' });
    return;
  }

  const bet = state.bets.get(playerId);
  if (!bet || bet.cashedOut) {
    sendJSON(ws, { type: 'cashout_rejected', reason: '无有效下注或已兑现' });
    return;
  }

  const elapsed = (Date.now() - state.flyStart) / 1000;
  const mult = multiplierAt(elapsed);

  if (mult >= state.crashPoint) {
    sendJSON(ws, { type: 'cashout_rejected', reason: '已过崩盘点' });
    return;
  }

  const roundId = state.roundId;
  const idempotencyKey = `aviator-cash-${roundId}-${playerId}`;

  try {
    const { payout, balanceAfter } = await withTransaction(async (client) => {
      // 派彩金额交给 Postgres numeric 算乘法，避免 JS 浮点乘法的精度问题。
      const payoutResult = await client.query(
        'SELECT ($1::numeric * $2::numeric)::numeric(18,2) AS payout',
        [bet.amount, mult],
      );
      const computedPayout = payoutResult.rows[0].payout;

      // 风控封顶：派彩不得超上限。RiskError 抛出后由下面的 catch 转成 cashout_rejected（带 code）。
      assertPayoutCap('aviator', computedPayout);

      const { balanceAfter: after } = await credit(client, {
        playerId,
        amount: computedPayout,
        type: 'aviator_payout',
        idempotencyKey,
        roundId,
      });

      await client.query(`UPDATE bets SET outcome = 'win' WHERE id = $1`, [bet.betId]);

      return { payout: computedPayout, balanceAfter: after };
    });

    bet.cashedOut = true;
    bet.payout = payout;

    sendJSON(ws, { type: 'cashout_ok', multiplier: mult, payout, balanceAfter });
  } catch (err) {
    if (err.code === '23505') {
      // 幂等命中：这个玩家的兑现请求已经处理过一次（并发重复消息），不重复加钱。
      bet.cashedOut = true;
      sendJSON(ws, { type: 'cashout_rejected', reason: '无有效下注或已兑现' });
      return;
    }
    // 风控封顶（WS 专用）：派彩超上限。带 code 明确告知，绝不落到下面兜底的「请重试」。
    if (err instanceof RiskError) {
      sendJSON(ws, { type: 'cashout_rejected', reason: err.message, code: err.code });
      return;
    }
    console.error('[aviatorHub] 兑现处理异常：', err.message);
    sendJSON(ws, { type: 'cashout_rejected', reason: '兑现失败，请重试' });
  }
}

/**
 * 组装「当前局的公开快照」，供新连接和客户端主动 {type:'sync'} 请求使用。
 * 严守不变量：betting/flying 阶段绝不包含 serverSeed/crashPoint；
 * crashed 阶段的 serverSeed 早已随 crashed 广播 reveal 过，snapshot 里带出来不算破例。
 */
function buildSnapshot() {
  if (state.phase === 'betting') {
    const waitMs = BETTING_MS;
    const elapsed = state.bettingStart ? Date.now() - state.bettingStart : 0;
    const remainingMs = Math.max(0, waitMs - elapsed);
    return {
      type: 'snapshot',
      phase: 'betting',
      roundId: state.roundId,
      nonce: state.nonce,
      clientSeed: state.clientSeed,
      commitHash: state.commitHash,
      waitMs,
      remainingMs,
    };
  }

  if (state.phase === 'flying') {
    const elapsed = state.flyStart ? (Date.now() - state.flyStart) / 1000 : 0;
    return {
      type: 'snapshot',
      phase: 'flying',
      roundId: state.roundId,
      nonce: state.nonce,
      clientSeed: state.clientSeed,
      commitHash: state.commitHash,
      elapsed,
      multiplier: multiplierAt(elapsed),
    };
  }

  // crashed —— serverSeed 已经 reveal 过，可以带出来
  return {
    type: 'snapshot',
    phase: 'crashed',
    roundId: state.roundId,
    nonce: state.nonce,
    clientSeed: state.clientSeed,
    commitHash: state.commitHash,
    crashPoint: state.crashPoint,
    serverSeed: state.serverSeed,
  };
}

/**
 * 连接建立时查该玩家当前余额，供前端把 serverBalance 初始化到位。
 * 查询失败（钱包不存在/DB 异常）不阻断连接，balance 发 null。
 * @param {string} playerId
 * @returns {Promise<string|null>}
 */
async function fetchPlayerBalance(playerId) {
  try {
    const result = await query('SELECT balance FROM wallets WHERE player_id = $1', [playerId]);
    return result.rows[0]?.balance ?? null;
  } catch (err) {
    console.error('[aviatorHub] 查询玩家余额失败：', err.message);
    return null;
  }
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
    // 未认证成功的连接这一刻已经被 index.js 的握手 handler close 掉，ws.playerId
    // 也不会挂上；显式跳过，不查余额、不发 hello/snapshot。
    if (ws.playerId) {
      fetchPlayerBalance(ws.playerId).then((balance) => {
        sendJSON(ws, { type: 'hello', phase: state.phase, balance });
        sendJSON(ws, buildSnapshot());
      }).catch((err) => {
        console.error('[aviatorHub] 连接初始化异常：', err.message);
      });
    }

    // 下注/兑现走这里：ws.playerId 由 index.js 里更早注册的认证 handler 挂好，
    // 没认证成功的连接此时已经被 close，不会走到这个消息处理逻辑
    // （保险起见仍然显式判断 ws.playerId 存在 + 连接处于 OPEN 状态）。
    ws.on('message', (raw) => {
      if (!ws.playerId || ws.readyState !== 1) return;

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // 非法 JSON，静默丢弃
      }

      if (msg.type === 'bet') {
        handleBet(ws, msg).catch((err) => {
          console.error('[aviatorHub] handleBet 未捕获异常：', err.message);
        });
        return;
      }

      if (msg.type === 'cashout') {
        handleCashout(ws).catch((err) => {
          console.error('[aviatorHub] handleCashout 未捕获异常：', err.message);
        });
        return;
      }

      if (msg.type === 'sync') {
        // 断线重连 / 中途加入主动请求当前局快照，补发的字段和连接时一致。
        sendJSON(ws, buildSnapshot());
      }
    });
  });

  runWaitingPhase(wss).catch((err) => {
    console.error('[aviatorHub] 启动房间循环失败：', err.message);
  });
}
