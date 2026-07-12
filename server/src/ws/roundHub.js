// 轮次排期器 Hub（#43 单1）—— 服务器按房间节奏统一开奖、全局期号、全场共享一局。
//
// 对照 aviatorHub 的「离散版」：aviator 的 flying 阶段是连续 tick 广播倍率；轮次没有连续过程，
// betting 窗口到点后一次性开奖（一次 spin）就是全部结果。相位机：
//   betting(30s) → locked(2s) → drawn(瞬时) → settled(瞬时) → idle(5s) → 下一期
//
// 首个接入房间：speedgrid（其余 9 款仍走 round.js 里 per-player 的 makeRoundGameHandler，本文件不碰）。
//
// 资金铁律（与 aviator/通用 handler 一致）：本文件不直接 UPDATE wallets，只走 wallet.debit/credit
// （debit 发生在 HTTP 下注端点，本文件只在 drawn 后 credit 派彩）；输局链式分成只走 commission.distributeLoss；
// 共享房间的 rounds 行 player_id 恒为 NULL，归属落在 bets 表（每玩家一行 + selections 明细）。
//
// commit-reveal 铁律：serverSeed 明文在 betting/locked 期间【绝不出进程】——不广播、不落库；
// 只在 betting 广播 sha256(serverSeed) 承诺（serverSeedHash）；drawn 那一刻才 reveal（广播 + UPDATE 落库）。
import crypto from 'crypto';
import { query, withTransaction } from '../db.js';
import { debit, credit } from '../lib/wallet.js';
import { distributeLoss } from '../lib/commission.js';
import { maxPayoutFor } from '../lib/risk.js';
import { makeSeededRng } from '../lib/seededRng.js';
import * as speedGridEngine from '../game/speedGrid.js';

// 相位时长（ms）。
const BETTING_MS = 30000;
const LOCKED_MS = 2000;
const IDLE_MS = 5000;

const round2 = (x) => Math.round(x * 100) / 100;

// —— 房间引擎表：gameName → { prefix(期号前缀), MARKETS, isValidMarketKey, hasPush, spin(rng) } ——
// 与 round.js 的 ROUND_GAME_REGISTRY.speedgrid 同源（同一 engine），spin 一行逐位一致。
const ROOM_ENGINES = {
  speedgrid: {
    prefix: 'SG',
    MARKETS: speedGridEngine.MARKETS,
    isValidMarketKey: speedGridEngine.isValidMarketKey,
    hasPush: speedGridEngine.HAS_PUSH,
    spin: (rng) => {
      const n = speedGridEngine.drawCar(rng);
      return { drawResult: { n }, hits: speedGridEngine.hitsOf(n), pushes: new Set() };
    },
  },
};

// 模块级房间表：gameName → room。round.js 的下注端点通过 getRoomState() 读同一活对象判相位。
const rooms = new Map();
let started = false;

// 私密字段（serverSeed）只活在 room 内存里，reveal 前不出现在任何广播/快照/日志。
function makeRoom(gameName) {
  const engine = ROOM_ENGINES[gameName];
  return {
    gameName,
    engine,
    phase: 'idle', // 'betting' | 'locked' | 'drawn' | 'settled' | 'idle'
    dateKey: null, // 'YYYYMMDD'，跨零点重置期号序号
    seq: 0, // 当日期号序号（NNN）
    roundNo: null, // 期号 SG-YYYYMMDD-NNN
    roundId: null, // 当期共享 rounds 行 id
    nonce: 0, // rng 派生 nonce，每期 +1
    serverSeed: null, // 私密，drawn 前绝不出进程
    clientSeed: null,
    serverSeedHash: null,
    drawResult: null, // 开奖结果（reveal 后）
    endsAt: null, // 当前相位结束时间戳（ms），供倒计时/快照剩余秒
    clients: new Set(),
    timer: null,
  };
}

function sendJSON(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload)); // 1 === WebSocket.OPEN
}

function broadcast(room, payload) {
  const data = JSON.stringify(payload);
  for (const ws of room.clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

// 本地日期 YYYYMMDD（服务器时区）。跨零点由 runBetting 检测重置序号。
function dateKeyNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function fmtRoundNo(prefix, dateKey, seq) {
  return `${prefix}-${dateKey}-${String(seq).padStart(3, '0')}`;
}

// 启动恢复当日已用的最大序号，防重启撞号。按数字 MAX 恢复（不受 padStart 位数与字符串排序影响）。
async function recoverSeq(gameName, prefix, dateKey) {
  try {
    const r = await query(
      `SELECT COALESCE(MAX((split_part(round_no, '-', 3))::int), 0) AS mx
         FROM rounds WHERE game = $1 AND round_no LIKE $2`,
      [gameName, `${prefix}-${dateKey}-%`],
    );
    return Number(r.rows[0]?.mx || 0);
  } catch (err) {
    console.error(`[roundHub:${gameName}] 恢复当日期号序号失败：`, err.message);
    return 0;
  }
}

// —— betting：生成本期种子 + INSERT 共享 round(status='betting', result/server_seed 都不落) + 广播承诺 ——
async function runBetting(room) {
  const { engine, gameName } = room;

  // 跨零点：日期变了则序号从 0 重置。
  const dk = dateKeyNow();
  if (room.dateKey !== dk) {
    room.dateKey = dk;
    room.seq = 0;
  }
  room.seq += 1;
  const roundNo = fmtRoundNo(engine.prefix, room.dateKey, room.seq);

  const serverSeed = crypto.randomBytes(32).toString('hex');
  const clientSeed = crypto.randomBytes(8).toString('hex');
  const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
  const nonce = room.nonce;

  room.phase = 'betting';
  room.roundNo = roundNo;
  room.serverSeed = serverSeed;
  room.clientSeed = clientSeed;
  room.serverSeedHash = serverSeedHash;
  room.drawResult = null;
  room.roundId = null;

  // 共享 round 行：betting 阶段先落，bets 才有 round_id 可挂。
  // 只落承诺 result_hash + client_seed；server_seed 与 result 一律 NULL（drawn 才 reveal）。
  try {
    const ins = await query(
      `INSERT INTO rounds (game, player_id, round_no, client_seed, result_hash, status)
       VALUES ($1, NULL, $2, $3, $4, 'betting')
       RETURNING id`,
      [gameName, roundNo, clientSeed, serverSeedHash],
    );
    room.roundId = ins.rows[0].id;
  } catch (err) {
    // 落库失败：本期无 roundId → 下注端点会因 phase 判定/roundId 缺失兜住；短暂跳到 idle 再重试。
    console.error(`[roundHub:${gameName}] betting round 落库失败：`, err.message);
    room.phase = 'idle';
    room.endsAt = Date.now() + IDLE_MS;
    room.timer = setTimeout(() => { room.nonce += 1; runBetting(room).catch(logLoopErr(gameName)); }, IDLE_MS);
    return;
  }

  room.endsAt = Date.now() + BETTING_MS;
  broadcast(room, {
    type: 'phase',
    phase: 'betting',
    roundNo,
    roundId: room.roundId,
    endsAt: room.endsAt,
    durationMs: BETTING_MS,
    serverSeedHash,
    clientSeed,
    nonce,
  });

  room.timer = setTimeout(() => runLocked(room), BETTING_MS);
}

// —— locked：封盘缓冲（2s），给「betting 末刻刚通过相位判定的 HTTP 下注」留出提交窗口 ——
// 保证任何被接受的下注都在 drawn 的结算 SELECT 之前落库，规避截止边界竞态。
function runLocked(room) {
  room.phase = 'locked';
  room.endsAt = Date.now() + LOCKED_MS;
  broadcast(room, {
    type: 'phase',
    phase: 'locked',
    roundNo: room.roundNo,
    roundId: room.roundId,
    endsAt: room.endsAt,
    durationMs: LOCKED_MS,
  });
  room.timer = setTimeout(() => { runDrawn(room).catch(logLoopErr(room.gameName)); }, LOCKED_MS);
}

// —— drawn：一次 spin 开奖 → reveal（广播 serverSeed + UPDATE 落 result/server_seed）→ 结算全员 → settled ——
async function runDrawn(room) {
  const { engine, gameName } = room;
  room.phase = 'drawn';

  const rng = makeSeededRng(room.serverSeed, room.clientSeed, room.nonce);
  const { drawResult, hits, pushes } = engine.spin(rng);
  room.drawResult = drawResult;

  // reveal 落库：此刻才写 server_seed 明文 + result。
  try {
    await query(
      `UPDATE rounds SET result = $1::jsonb, server_seed = $2, status = 'drawn' WHERE id = $3`,
      [JSON.stringify({ drawResult }), room.serverSeed, room.roundId],
    );
  } catch (err) {
    console.error(`[roundHub:${gameName}] drawn 落库失败：`, err.message);
  }

  // reveal 广播：任何人可用 sha256(serverSeed) 校验 == betting 期广播的 serverSeedHash。
  broadcast(room, {
    type: 'phase',
    phase: 'drawn',
    roundNo: room.roundNo,
    roundId: room.roundId,
    result: drawResult,
    serverSeed: room.serverSeed,
  });

  await settleRound(room, hits, pushes);

  try {
    await query(`UPDATE rounds SET status = 'settled' WHERE id = $1`, [room.roundId]);
  } catch (err) {
    console.error(`[roundHub:${gameName}] settled 落库失败：`, err.message);
  }
  room.phase = 'settled';
  broadcast(room, { type: 'phase', phase: 'settled', roundNo: room.roundNo, roundId: room.roundId });

  runIdle(room);
}

// —— 结算：SELECT 本期全部 pending bets → 逐玩家逐 key 三态 → 赢/push credit、全输 distributeLoss ——
// 幂等/恰好一次：每玩家事务内先「守 pending 翻转 outcome」（rowCount=0 即已结算，跳过），
// 再 credit（幂等键 rgs-<roundId>-<playerId>，ledger 唯一键兜底）。单玩家失败记日志继续结其他人。
async function settleRound(room, hits, pushes) {
  const { engine, gameName, roundId } = room;
  const maxPayout = String(maxPayoutFor(gameName));

  let bets;
  try {
    bets = (await query(
      `SELECT id, player_id, amount, selections FROM bets WHERE round_id = $1 AND outcome = 'pending'`,
      [roundId],
    )).rows;
  } catch (err) {
    console.error(`[roundHub:${gameName}] 读本期 bets 失败：`, err.message);
    return;
  }

  const perPlayer = new Map(); // playerId(string) → { yourResult, totalPayout, balanceAfter }

  for (const bet of bets) {
    const playerId = bet.player_id;
    const selections = bet.selections || {};
    const entries = Object.entries(selections);

    // 逐 key 三态（照 makeRoundGameHandler 口径）：hit→amt×odds，push→退本金，未中→输。
    const yourResult = [];
    let rawTotalPayout = 0;
    for (const [key, amt] of entries) {
      const a = Number(amt);
      if (!engine.isValidMarketKey(key)) continue; // 理论不达（下注端点已校验），防御跳过
      if (hits.has(key)) {
        const p = round2(a * engine.MARKETS[key].odds);
        yourResult.push({ key, outcome: 'hit', payout: p });
        rawTotalPayout += p;
      } else if (engine.hasPush && pushes.has(key)) {
        yourResult.push({ key, outcome: 'push', payout: a });
        rawTotalPayout += a;
      } else {
        yourResult.push({ key, outcome: 'lose', payout: 0 });
      }
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const settled = await withTransaction(async (client) => {
        // cap 钳制（SQL numeric 定稿，避免 JS 浮点累加误差）
        const capRow = await client.query('SELECT LEAST(round($1::numeric, 2), $2::numeric) AS payout', [String(rawTotalPayout), maxPayout]);
        const totalPayout = capRow.rows[0].payout;
        const win = Number(totalPayout) > 0;

        // 守 pending 翻转：只有把本注从 pending 改成终态成功（rowCount=1）的这一次才继续派彩/分成。
        const flip = await client.query(
          `UPDATE bets SET outcome = $2 WHERE id = $1 AND outcome = 'pending' RETURNING id`,
          [bet.id, win ? 'win' : 'lose'],
        );
        if (flip.rowCount === 0) return null; // 已被结算过（重试/并发），跳过，绝不重复派彩

        let balanceAfter;
        if (win) {
          const cr = await credit(client, {
            playerId,
            amount: totalPayout,
            type: `${gameName}_payout`,
            idempotencyKey: `rgs-${roundId}-${playerId}`,
            roundId,
          });
          balanceAfter = cr.balanceAfter;
        } else {
          // 全输：总注额进入链式分成（与 makeRoundGameHandler 一致）；玩家钱包在下注时已扣，此处不动。
          const pr = await client.query('SELECT agent_id FROM players WHERE id = $1', [playerId]);
          const agentId = pr.rows[0]?.agent_id;
          if (agentId) {
            await distributeLoss(client, { playerId, agentId, roundId, lossAmount: bet.amount });
          }
          const bal = await client.query('SELECT balance FROM wallets WHERE player_id = $1', [playerId]);
          balanceAfter = bal.rows[0]?.balance ?? null;
        }
        return { yourResult, totalPayout, balanceAfter };
      });

      if (settled) perPlayer.set(String(playerId), settled);
    } catch (err) {
      console.error(`[roundHub:${gameName}] 结算玩家 ${playerId} 失败（跳过，靠幂等键下次补结）：`, err.message);
    }
  }

  // 对有注玩家定向下发个人结果 + 余额（一个玩家可能多连接，全发）。
  for (const ws of room.clients) {
    if (!ws.playerId) continue;
    const r = perPlayer.get(String(ws.playerId));
    if (r) {
      sendJSON(ws, {
        type: 'result',
        roundNo: room.roundNo,
        roundId,
        yourResult: r.yourResult,
        totalPayout: r.totalPayout,
        balanceAfter: r.balanceAfter,
      });
    }
  }
}

// —— idle：结算完到下一期的停顿（5s）——
function runIdle(room) {
  room.phase = 'idle';
  room.endsAt = Date.now() + IDLE_MS;
  broadcast(room, {
    type: 'phase',
    phase: 'idle',
    roundNo: room.roundNo,
    roundId: room.roundId,
    endsAt: room.endsAt,
    durationMs: IDLE_MS,
  });
  room.timer = setTimeout(() => {
    room.nonce += 1;
    runBetting(room).catch(logLoopErr(room.gameName));
  }, IDLE_MS);
}

function logLoopErr(gameName) {
  return (err) => console.error(`[roundHub:${gameName}] 相位循环异常：`, err.message);
}

// 当前局公开快照（新连接/主动 sync）。严守：betting/locked 不带 serverSeed；drawn/settled/idle 已 reveal 可带。
function buildSnapshot(room) {
  const snap = {
    type: 'snapshot',
    phase: room.phase,
    roundNo: room.roundNo,
    roundId: room.roundId,
    clientSeed: room.clientSeed,
    serverSeedHash: room.serverSeedHash,
    nonce: room.nonce,
  };
  if (room.phase === 'betting' || room.phase === 'locked' || room.phase === 'idle') {
    snap.endsAt = room.endsAt;
    snap.remainingMs = Math.max(0, (room.endsAt || 0) - Date.now());
  }
  if (room.phase === 'drawn' || room.phase === 'settled' || room.phase === 'idle') {
    snap.result = room.drawResult;
    snap.serverSeed = room.serverSeed; // 已 reveal
  }
  return snap;
}

async function fetchPlayerBalance(playerId) {
  try {
    const r = await query('SELECT balance FROM wallets WHERE player_id = $1', [playerId]);
    return r.rows[0]?.balance ?? null;
  } catch (err) {
    console.error('[roundHub] 查询玩家余额失败：', err.message);
    return null;
  }
}

/**
 * 供 round.js 下注端点读当前房间相位（判 409 round_locked + 拿当期 roundId/roundNo）。
 * @param {string} gameName
 * @returns {{phase:string, roundNo:string|null, roundId:number|null, endsAt:number|null}|null}
 */
export function getRoomState(gameName) {
  const room = rooms.get(gameName);
  if (!room) return null;
  return { phase: room.phase, roundNo: room.roundNo, roundId: room.roundId, endsAt: room.endsAt };
}

/**
 * 启动轮次排期器：建 speedgrid 房间、恢复当日期号、挂新连接快照、起相位循环。
 * 模块级单例，重复调用忽略（避免起两个并行循环）。
 * @param {import('ws').WebSocketServer} wss - /ws/rounds 的 WSS
 */
export function startRoundHub(wss) {
  if (started) {
    console.error('[roundHub] startRoundHub 被重复调用，已忽略');
    return;
  }
  started = true;

  // 目前只开 speedgrid 一个房间；未来多房间可按 ?room= 分派，这里默认全部并入 speedgrid。
  const room = makeRoom('speedgrid');
  rooms.set('speedgrid', room);

  wss.on('connection', (ws) => {
    // 未认证的连接已被 index.js 握手 handler close，ws.playerId 不会挂上；显式跳过。
    if (!ws.playerId) return;

    room.clients.add(ws);
    ws.on('close', () => room.clients.delete(ws));

    fetchPlayerBalance(ws.playerId).then((balance) => {
      sendJSON(ws, { type: 'hello', phase: room.phase, balance });
      sendJSON(ws, buildSnapshot(room));
    }).catch((err) => console.error('[roundHub] 连接初始化异常：', err.message));

    ws.on('message', (raw) => {
      if (!ws.playerId || ws.readyState !== 1) return;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'sync') sendJSON(ws, buildSnapshot(room)); // 断线重连/中途加入补当前快照
    });
  });

  // 恢复当日期号序号后再起循环（防重启撞号）。
  recoverSeq('speedgrid', room.engine.prefix, dateKeyNow()).then((mx) => {
    room.dateKey = dateKeyNow();
    room.seq = mx; // 首个 runBetting 会 +1
    console.log(`[roundHub:speedgrid] 排期器启动，当日已用序号 ${mx}，下一期 ${mx + 1}`);
    runBetting(room).catch(logLoopErr('speedgrid'));
  });
}
