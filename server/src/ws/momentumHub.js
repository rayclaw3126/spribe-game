// Momentum 全局共享房间（照 aviatorHub.js 结构）：betting → running(逐柱) → done 状态机，
// 所有连接看到的是同一局、同一条 31 柱随机游走（crash 类游戏本质：房间只有一个）。
//
// ⚠️ 逐柱 reveal 铁律：betting 开局即算好整条 walkPath（内存私密），但【每 700ms 只广播已走的柱】，
//    serverSeed / 整条 walk 保密到 done 才 reveal。running 期间 DB rounds.result 也保持 NULL
//    （walk 只活在内存）→ 客户端/DB 都拿不到未来柱，无预知作弊。同 Aviator crashPoint、RollingBall 按步现派。
// ⚠️ cashout 时点权威：兑现按 state.xRef（最后一根已 tick 柱的 X）结算，绝不信客户端报的 X。
//
// 接钱只走 wallet.debit/credit，输局分成只走 commission.distributeLoss；rounds.player_id 恒 NULL
// （共享房间，归属落在 bets 表）。
import { query, withTransaction } from '../db.js';
import { debit, credit } from '../lib/wallet.js';
import { assertBetWithinLimits, maxPayoutFor, assertRoundLiability, RiskError } from '../lib/risk.js';
import { distributeLoss } from '../lib/commission.js';
import { hashSeed, walkPath, newServerSeed, newClientSeed } from '../game/momentum.js';

const BETTING_MS = 5000;   // 下注窗口，与前端 Momentum.jsx 一致
const STEP_MS = 700;       // 每根柱间隔
const DONE_PAUSE_MS = 2000; // 开奖后到下一局的停顿

// 模块级单例状态：整个进程只有一个房间。serverSeed / walk 私密，done 才 reveal。
const state = {
  phase: 'betting', // 'betting' | 'running' | 'done'
  nonce: 0,
  roundId: null,
  serverSeed: null,
  clientSeed: null,
  commitHash: null,
  walk: null,       // { bars:[{barIdx,f,x}], crashBar, finalX } —— 私密，running 不广播未来柱，done 才 reveal
  barIdx: 0,        // 当前已 tick 到第几根柱
  xRef: 1,          // 最后一根已 tick 柱的 X（cashout 服务端权威结算用）
  bettingStart: null,
  // key = `${playerId}:${panel}`（复合键，S8 双注位：同轮每人两槽 panel 0/1，各自 autoTarget/结算独立），
  // value = { ws, playerId, panel, amount, cashedOut, betId, agentId, payout, autoTarget }。
  // 老协议（不带 panel 的 bet/cashout）缺省 panel=0，与新协议 panel0 槽同键、行为一致。
  bets: new Map(),
};

const timers = { bettingTimeout: null, runningInterval: null, doneTimeout: null };
let started = false;

// S8 双注位：解析 panel（缺省 0，老协议不带）；非 {0,1} 返回 null（调用方转 rejected）。
function parsePanel(msg) {
  if (msg.panel === undefined || msg.panel === null) return 0;
  const p = Number(msg.panel);
  return p === 0 || p === 1 ? p : null;
}
const betKey = (playerId, panel) => `${playerId}:${panel}`;

function sendJSON(ws, payload) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload)); }
function broadcast(wss, payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) if (client.readyState === 1) client.send(data);
}

async function insertPendingRound() {
  try {
    const result = await query(
      `INSERT INTO rounds(game, player_id, server_seed, client_seed, result_hash, status)
       VALUES('momentum', NULL, $1, $2, $3, 'pending') RETURNING id`,
      [state.serverSeed, state.clientSeed, state.commitHash],
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    console.error('[momentumHub] 插入 pending round 失败：', err.message);
    return null;
  }
}
// done 才写 result（整条已走柱 + crashBar + finalX）；running 期间 rounds.result 恒 NULL（无未来柱）。
// 单V3c：nonce 随 result 落库（照 V1 给轮次彩补 nonce 的先例）。原先 result 无 nonce、rounds 表也无
// nonce 列 → 历史局重算三要素缺一，玩家事后翻旧局【永远验不了】。补落后新局历史可验；老局显「缺要素」。
// done 时 serverSeed 本就已 reveal，落 nonce 不多泄露任何东西。
async function markRoundDone(roundId, walk, nonce) {
  if (!roundId) return;
  try {
    await query(
      `UPDATE rounds SET status = 'settled', result = $1::jsonb WHERE id = $2`,
      [JSON.stringify({ crashBar: walk.crashBar, finalX: walk.finalX, bars: walk.bars, nonce }), roundId],
    );
  } catch (err) {
    console.error('[momentumHub] 更新 done round 失败：', err.message);
  }
}

async function runWaitingPhase(wss) {
  const serverSeed = newServerSeed();
  const clientSeed = newClientSeed();
  const nonce = state.nonce;
  const walk = walkPath(serverSeed, clientSeed, nonce);   // 整条路径 —— 私密，绝不广播/落库直到 done
  const commitHash = hashSeed(serverSeed);

  state.phase = 'betting';
  state.serverSeed = serverSeed;
  state.clientSeed = clientSeed;
  state.commitHash = commitHash;
  state.walk = walk;
  state.barIdx = 0;
  state.xRef = 1;
  state.nonce = nonce;
  state.roundId = null;
  state.bettingStart = Date.now();
  state.bets.clear();

  const roundId = await insertPendingRound();
  state.roundId = roundId;

  // 只广播 commitHash + clientSeed + nonce，绝不广播 serverSeed / walk / 任何未来柱。
  broadcast(wss, { type: 'betting', roundId, nonce, clientSeed, commitHash, waitMs: BETTING_MS });
  timers.bettingTimeout = setTimeout(() => runRunningPhase(wss), BETTING_MS);
}

function runRunningPhase(wss) {
  state.phase = 'running';
  state.barIdx = 0;
  state.xRef = 1;

  timers.runningInterval = setInterval(() => {
    const walk = state.walk;
    const bar = walk.bars[state.barIdx];   // 逐柱揭示（内存已算好，此刻才广播这一根）
    state.xRef = bar.x;

    // 只广播【本根已走柱】，绝不带未来柱。
    broadcast(wss, { type: 'bar', roundId: state.roundId, barIdx: bar.barIdx, x: bar.x });

    // auto-cashout：开着 auto 的未兑现注，X ≥ 目标 → 按【目标价】结算（付目标非 overshoot）。
    if (bar.x > 0) {
      for (const [, bet] of state.bets) {
        if (!bet.cashedOut && bet.autoTarget != null && bar.x >= bet.autoTarget) {
          settleBetAt(bet, bet.autoTarget, 'auto');   // fire-and-forget（内部事务）
        }
      }
    }

    const isBust = bar.x <= 0;
    const isLast = state.barIdx >= walk.bars.length - 1;
    if (isBust || isLast) {
      clearInterval(timers.runningInterval);
      runDonePhase(wss);
    } else {
      state.barIdx += 1;
    }
  }, STEP_MS);
}

// 单笔结算（cashout / auto / done 最终结算共用）：payout = 钳制 LEAST(amount×atX, maxPayout)。
// netLoss = max(0, amount − payout) 走 distributeLoss（momentum 用净损分成，X 可 <1）。
async function settleBetAt(bet, atX, source) {
  if (bet.cashedOut) return;
  bet.cashedOut = true;   // 先占位防并发重入（auto + manual 同柱竞态）
  const idempotencyKey = `momentum-cash-${state.roundId}-${bet.playerId}-p${bet.panel}`;
  try {
    const { payout, netLoss, balanceAfter } = await withTransaction(async (client) => {
      const row = await client.query(
        'SELECT LEAST(($1::numeric * $2::numeric)::numeric(18,2), $3::numeric)::numeric(18,2) AS payout',
        [bet.amount, String(atX), String(maxPayoutFor('momentum'))],
      );
      const p = row.rows[0].payout;
      const loss = Math.max(0, Number(bet.amount) - Number(p));
      let after = null;
      if (Number(p) > 0) {
        const cr = await credit(client, { playerId: bet.playerId, amount: p, type: 'momentum_payout', idempotencyKey, roundId: state.roundId });
        after = cr.balanceAfter;
      }
      if (loss > 0 && bet.agentId) {
        await distributeLoss(client, { playerId: bet.playerId, agentId: bet.agentId, roundId: state.roundId, lossAmount: loss.toFixed(2) });
      }
      await client.query(`UPDATE bets SET outcome = $1 WHERE id = $2`, [Number(p) >= Number(bet.amount) ? 'win' : 'lose', bet.betId]);
      return { payout: p, netLoss: loss, balanceAfter: after };
    });
    bet.payout = payout;
    sendJSON(bet.ws, { type: 'cashout_ok', source, multiplier: Number(atX), payout, netLoss: netLoss.toFixed(2), balanceAfter, panel: bet.panel });
  } catch (err) {
    if (err.code === '23505') { sendJSON(bet.ws, { type: 'cashout_rejected', reason: '已兑现', panel: bet.panel }); return; }
    bet.cashedOut = false;   // 结算失败回滚占位，允许重试
    console.error('[momentumHub] 结算异常：', err.message);
    sendJSON(bet.ws, { type: 'cashout_rejected', reason: '兑现失败，请重试', panel: bet.panel });
  }
}

async function runDonePhase(wss) {
  state.phase = 'done';
  const { roundId, walk, serverSeed, clientSeed, nonce } = state;

  // done 才 reveal serverSeed + 整条 walk —— 任何人可 walkPath() 重算校验。
  broadcast(wss, { type: 'done', roundId, crashBar: walk.crashBar, finalX: walk.finalX, bars: walk.bars, serverSeed, clientSeed, nonce });
  await markRoundDone(roundId, walk, nonce);   // 单V3c：nonce 一并落库，供历史局重算

  // 未兑现注最终结算：survive(finalX>0)→按 finalX 结算（含 <1 半输照付）；bust(finalX=0)→全输分成。
  for (const [, bet] of state.bets) {
    if (bet.cashedOut) continue;
    if (walk.finalX > 0) {
      // eslint-disable-next-line no-await-in-loop
      await settleBetAt(bet, walk.finalX, 'final');
    } else {
      try {
        // eslint-disable-next-line no-await-in-loop
        await withTransaction(async (client) => {
          if (bet.agentId) await distributeLoss(client, { playerId: bet.playerId, agentId: bet.agentId, roundId, lossAmount: bet.amount });
          await client.query(`UPDATE bets SET outcome = 'lose' WHERE id = $1`, [bet.betId]);
        });
        bet.cashedOut = true;
      } catch (err) { console.error('[momentumHub] bust 结算失败：', err.message); }
    }
  }

  broadcast(wss, { type: 'settled', roundId });
  timers.doneTimeout = setTimeout(() => { state.nonce += 1; runWaitingPhase(wss); }, DONE_PAUSE_MS);
}

async function handleBet(ws, msg) {
  const playerId = ws.playerId;
  // S8：解析注位（老协议不带 panel → 缺省 0）；panel ∉ {0,1} 直接拒。
  const panel = parsePanel(msg);
  if (panel === null) { sendJSON(ws, { type: 'bet_rejected', reason: '注位无效', panel: msg.panel }); return; }
  if (state.phase !== 'betting') { sendJSON(ws, { type: 'bet_rejected', reason: '非下注阶段', panel }); return; }

  const rawAmount = Number(msg.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) { sendJSON(ws, { type: 'bet_rejected', reason: '下注金额无效', panel }); return; }
  const amount = rawAmount.toFixed(2);
  // auto-cashout 目标（可选，随槽独立）：>1 才有意义
  let autoTarget = null;
  if (msg.autoTarget != null) { const t = Number(msg.autoTarget); if (Number.isFinite(t) && t > 1) autoTarget = t; }

  try {
    // S8 敞口：每注各自过 maxBet 闸（每 panel 独立），玩家单轮上限自然 = 2×单注上限（双注位=同轮可押两注，Spribe 同款，属产品预期）。
    assertBetWithinLimits('momentum', amount);
    // 聚合负债闸：本局未兑现注潜在赔付（每注封顶 maxPayout）+ 本注 > maxRoomLiability 则拒
    const openLiability = [...state.bets.values()].filter((b) => !b.cashedOut).length * maxPayoutFor('momentum');
    assertRoundLiability('momentum', openLiability, maxPayoutFor('momentum'));
  } catch (err) {
    if (err instanceof RiskError) { sendJSON(ws, { type: 'bet_rejected', reason: err.message, code: err.code, panel }); return; }
    throw err;
  }

  // 幂等（防双击守卫）：内存里已记过这个玩家本局【本 panel】的下注，直接回已有信息，不重复扣钱。
  const existing = state.bets.get(betKey(playerId, panel));
  if (existing) { sendJSON(ws, { type: 'bet_ack', roundId: state.roundId, amount: existing.amount, panel, idempotent: true }); return; }

  const roundId = state.roundId;
  const idempotencyKey = `momentum-${roundId}-${playerId}-p${panel}`;
  try {
    const { betId, agentId, balanceAfter } = await withTransaction(async (client) => {
      const { balanceAfter: after } = await debit(client, { playerId, amount, type: 'momentum_bet', idempotencyKey, roundId });
      const betResult = await client.query(
        `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome) VALUES ($1, $2, $3::numeric, $4, 'pending') RETURNING id`,
        [roundId, playerId, amount, idempotencyKey],
      );
      const playerResult = await client.query('SELECT agent_id FROM players WHERE id = $1', [playerId]);
      return { betId: betResult.rows[0].id, agentId: playerResult.rows[0]?.agent_id ?? null, balanceAfter: after };
    });
    if (state.roundId === roundId) {
      state.bets.set(betKey(playerId, panel), { ws, playerId, panel, amount, cashedOut: false, betId, agentId, payout: null, autoTarget });
    } else {
      console.error('[momentumHub] 下注写库完成但房间已翻页，跳过内存登记');
    }
    sendJSON(ws, { type: 'bet_ack', roundId, amount, autoTarget, balanceAfter, panel, idempotent: false });
  } catch (err) {
    if (err.code === '23505') {
      try {
        const existingBet = await query('SELECT amount FROM bets WHERE idempotency_key = $1', [idempotencyKey]);
        sendJSON(ws, { type: 'bet_ack', roundId, amount: existingBet.rows[0]?.amount ?? amount, panel, idempotent: true });
      } catch { sendJSON(ws, { type: 'bet_rejected', reason: '下注失败，请重试', panel }); }
      return;
    }
    if (err.message === '余额不足' || err.message === '钱包不存在') { sendJSON(ws, { type: 'bet_rejected', reason: err.message, panel }); return; }
    console.error('[momentumHub] 下注处理异常：', err.message);
    sendJSON(ws, { type: 'bet_rejected', reason: '下注失败，请重试', panel });
  }
}

// ⭐ 服务端权威 cashout：按 state.xRef（最后已 tick 柱 X）结算，不信客户端报的 X。
async function handleCashout(ws, msg) {
  const playerId = ws.playerId;
  // S8：解析注位（老协议不带 panel → 缺省 0）；panel ∉ {0,1} 直接拒。
  const panel = parsePanel(msg);
  if (panel === null) { sendJSON(ws, { type: 'cashout_rejected', reason: '注位无效', panel: msg.panel }); return; }
  if (state.phase !== 'running') { sendJSON(ws, { type: 'cashout_rejected', reason: '非进行阶段', panel }); return; }
  const bet = state.bets.get(betKey(playerId, panel));
  if (!bet || bet.cashedOut) { sendJSON(ws, { type: 'cashout_rejected', reason: '无有效下注或已兑现', panel }); return; }
  if (state.barIdx < 0 || state.xRef <= 0) { sendJSON(ws, { type: 'cashout_rejected', reason: '已崩盘', panel }); return; }
  bet.ws = ws;   // 刷新 ws（可能重连）
  await settleBetAt(bet, state.xRef, 'manual');   // ← 服务端 X，客户端报的 X 一律不用；panel 已存在 bet 上
}

// S8：某玩家本局的注槽列表（新数组，前端恢复两注位只吃此字段；带 autoTarget 供重连恢复自动挡）。老 JS 忽略未知字段不炸。
function playerBets(playerId) {
  const out = [];
  for (const bet of state.bets.values()) {
    if (bet.playerId === playerId) {
      out.push({ panel: bet.panel, amount: bet.amount, cashedOut: bet.cashedOut, payout: bet.payout, autoTarget: bet.autoTarget });
    }
  }
  return out.sort((a, b) => a.panel - b.panel);
}

function buildSnapshot(playerId) {
  const bets = playerBets(playerId);
  if (state.phase === 'betting') {
    const remainingMs = Math.max(0, BETTING_MS - (state.bettingStart ? Date.now() - state.bettingStart : 0));
    return { type: 'snapshot', phase: 'betting', roundId: state.roundId, nonce: state.nonce, clientSeed: state.clientSeed, commitHash: state.commitHash, waitMs: BETTING_MS, remainingMs, bets };
  }
  if (state.phase === 'running') {
    // 只给已走的柱（bars 到 barIdx），绝不给未来柱 / serverSeed / walk 全貌。
    const revealed = state.walk.bars.slice(0, state.barIdx + 1).map((b) => ({ barIdx: b.barIdx, x: b.x }));
    return { type: 'snapshot', phase: 'running', roundId: state.roundId, nonce: state.nonce, clientSeed: state.clientSeed, commitHash: state.commitHash, barIdx: state.barIdx, x: state.xRef, bars: revealed, bets };
  }
  // done —— serverSeed 已 reveal
  return { type: 'snapshot', phase: 'done', roundId: state.roundId, nonce: state.nonce, clientSeed: state.clientSeed, commitHash: state.commitHash, crashBar: state.walk?.crashBar, finalX: state.walk?.finalX, serverSeed: state.serverSeed, bets };
}

async function fetchPlayerBalance(playerId) {
  try { const r = await query('SELECT balance FROM wallets WHERE player_id = $1', [playerId]); return r.rows[0]?.balance ?? null; }
  catch (err) { console.error('[momentumHub] 查询余额失败：', err.message); return null; }
}

export function startMomentumHub(wss) {
  if (started) { console.error('[momentumHub] startMomentumHub 被重复调用，已忽略'); return; }
  started = true;
  wss.on('connection', (ws) => {
    if (ws.playerId) {
      fetchPlayerBalance(ws.playerId).then((balance) => {
        sendJSON(ws, { type: 'hello', phase: state.phase, balance });
        sendJSON(ws, buildSnapshot(ws.playerId));
      }).catch((err) => console.error('[momentumHub] 连接初始化异常：', err.message));
    }
    ws.on('message', (raw) => {
      if (!ws.playerId || ws.readyState !== 1) return;
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'bet') { handleBet(ws, msg).catch((err) => console.error('[momentumHub] handleBet 异常：', err.message)); return; }
      if (msg.type === 'cashout') { handleCashout(ws, msg).catch((err) => console.error('[momentumHub] handleCashout 异常：', err.message)); return; }
      if (msg.type === 'sync') { sendJSON(ws, buildSnapshot(ws.playerId)); }
    });
  });
  runWaitingPhase(wss).catch((err) => console.error('[momentumHub] 启动房间循环失败：', err.message));
}
