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
import * as numberUpEngine from '../game/numberUp.js';
import * as derbyDayEngine from '../game/derbyDay.js';
import * as dominoDuelEngine from '../game/dominoDuel.js';
import * as hatTrickEngine from '../game/hatTrick.js';
import * as goldenBootEngine from '../game/goldenBoot.js';
import * as halfTimeEngine from '../game/halfTime.js';
import * as wuXingEngine from '../game/wuXing.js';
import * as lineUpEngine from '../game/lineUp.js';
// 单V2：9 款开奖派生 spin 抽到单一出处 roundSpins.js（本 ROOM_ENGINES.spin 回引它）；
// 前端 LocalVerify 同 import 同一份——禁两处手抄。此为 import 等价搬家，结算逻辑零变。
import { ROUND_SPINS } from '../game/roundSpins.js';
// 孤儿注恢复的复算走 settleDerive 单一出处（与 scripts/repair_stuck_bets.mjs 同一份判定）；
// round2 本文件 53 行已有，不重复引入。
import { computeDetail, capPayout, drawOf } from '../game/settleDerive.js';

// 相位时长（ms）。
// 相位时长（ms）——每房独立。betting/locked 统一，idle（开奖后到下一期的停顿）按各款开奖舞台动画长度定制：
// idle 必须 ≥ 前端 DRAW_ANIM_MS，否则下一期 betting 会切断动画。默认 idle 5s（speedgrid 舞台 ~4.6s）。
const DEFAULT_TIMINGS = { bettingMs: 30000, lockedMs: 2000, idleMs: 5000 };
const ROOM_TIMINGS = {
  speedgrid: { idleMs: 5000 },   // 冲线舞台 ~4.6s
  numberup: { idleMs: 8000 },    // 举牌+LED 翻数 ~6s
  dominoduel: { idleMs: 8000 },  // 四张骨牌翻开 ~3.5s + 悬念/结算展示（前端 DRAW_ANIM_MS 6s）
  derbyday: { idleMs: 24000 },   // 半场20珠+定格+全场20珠 两段 ~22s
  hattrick: { idleMs: 8000 },    // 三骰错峰弹入滚动+TOTAL 定格金闪 ~7s
  goldenboot: { idleMs: 9000 },  // 十车起跑+冲刺+撞线定格 ~8s
  halftime: { idleMs: 11000 },   // 20 球连发+SCORE 定格 ~10s
  wuxing: { idleMs: 5500 },      // 开奖舞台 ~4.5s
  lineup: { idleMs: 5500 },      // 开奖舞台 ~4.5s
};
function timingsFor(gameName) {
  return { ...DEFAULT_TIMINGS, ...(ROOM_TIMINGS[gameName] || {}) };
}

const round2 = (x) => Math.round(x * 100) / 100;

// —— 房间引擎表：gameName → { prefix(期号前缀), MARKETS, isValidMarketKey, hasPush, spin(rng) } ——
// 与 round.js 的 ROUND_GAME_REGISTRY 同源（同一 engine），spin 逐位一致；prefix = 期号前缀（各房独立）。
// spin 返回 { drawResult, hits:Set, pushes:Set }；DerbyDay/DominoDuel hasPush=true（push→退本金，settle 已含分支）。
const ROOM_ENGINES = {
  speedgrid: {
    prefix: 'SG',
    MARKETS: speedGridEngine.MARKETS,
    isValidMarketKey: speedGridEngine.isValidMarketKey,
    hasPush: speedGridEngine.HAS_PUSH,
    spin: ROUND_SPINS.speedgrid,   // 单V2：派生单一出处（原内联表达式已搬 roundSpins.js）
  },
  numberup: {
    prefix: 'NU',
    MARKETS: numberUpEngine.MARKETS,
    isValidMarketKey: numberUpEngine.isValidMarketKey,
    hasPush: numberUpEngine.HAS_PUSH,
    spin: ROUND_SPINS.numberup,
  },
  derbyday: {
    prefix: 'DD',
    MARKETS: derbyDayEngine.MARKETS,
    isValidMarketKey: derbyDayEngine.isValidMarketKey,
    hasPush: derbyDayEngine.HAS_PUSH,
    spin: ROUND_SPINS.derbyday,
  },
  dominoduel: {
    prefix: 'DM',
    MARKETS: dominoDuelEngine.MARKETS,
    isValidMarketKey: dominoDuelEngine.isValidMarketKey,
    hasPush: dominoDuelEngine.HAS_PUSH,
    spin: ROUND_SPINS.dominoduel,
  },
  // —— 单3 批次2：HatTrick/GoldenBoot/HalfTime/WuXing/LineUp（均 HAS_PUSH=false；
  //    HalfTime.draw / WuXing.龙虎和局 是独立 hit/lose 市场——和局判【输】不退本金，
  //    通用 settle 的 push 分支因 hasPush=false 天然不触发，draw 未中即 lose，符合埋尸点）——
  hattrick: {
    prefix: 'HT',
    MARKETS: hatTrickEngine.MARKETS,
    isValidMarketKey: hatTrickEngine.isValidMarketKey,
    hasPush: hatTrickEngine.HAS_PUSH,
    spin: ROUND_SPINS.hattrick,
  },
  goldenboot: {
    prefix: 'GB',
    MARKETS: goldenBootEngine.MARKETS,
    isValidMarketKey: goldenBootEngine.isValidMarketKey,
    hasPush: goldenBootEngine.HAS_PUSH,
    spin: ROUND_SPINS.goldenboot,
  },
  halftime: {
    prefix: 'HF',
    MARKETS: halfTimeEngine.MARKETS,
    isValidMarketKey: halfTimeEngine.isValidMarketKey,
    hasPush: halfTimeEngine.HAS_PUSH,
    spin: ROUND_SPINS.halftime,
  },
  wuxing: {
    prefix: 'WX',
    MARKETS: wuXingEngine.MARKETS,
    isValidMarketKey: wuXingEngine.isValidMarketKey,
    hasPush: wuXingEngine.HAS_PUSH,
    spin: ROUND_SPINS.wuxing,
  },
  lineup: {
    prefix: 'LU',
    MARKETS: lineUpEngine.MARKETS,
    isValidMarketKey: lineUpEngine.isValidMarketKey,
    hasPush: lineUpEngine.HAS_PUSH,
    spin: ROUND_SPINS.lineup,
  },
};

// ============ #42 单1：房配置（一款可多房）============
//
// roomKey 与 gameName 解耦：
//   · 标准房 roomKey === gameName（裸 backendId）—— 向后兼容：旧 WS 连接（只带 ?game=）、
//     getRoomState('speedgrid') 等既有调用一律照旧命中，部署后玩家无感。
//   · 附加房 roomKey = `${gameName}:${room}`（如 'speedgrid:15s'）。
//
// room 字段 = 落 rounds.room 的值。标准房也【显式】落值（'30s'）而非 NULL —— 让试点两房在库里
//   都有明确房标识；其余 8 款 room:null → 落 NULL（= 该款标准房，读侧 COALESCE 归一）。
//
// prefix = 期号前缀，【每房独立】。recoverSeq 靠 `round_no LIKE '<prefix>-日期-%'` 发号，
//   前缀不同即天然分房，不依赖 room 列（D 段实证）。⚠ 前缀不能有包含关系陷阱：
//   'SG15-…' 不匹配 'SG-2026…'（第二段被日期占死），故 SG / SG15 安全共存。
//
// timings = 覆盖 DEFAULT_TIMINGS 的字段。⚠ idleMs 两房都保 5000：它是【动画长度约束】
//   （≥ 前端 DRAW_ANIM_MS，否则下一期 betting 会切断开奖动画），砍它会砍出画面 bug；
//   15s 房只砍 betting 段。
const ROOM_CONFIGS = [
  // —— speedgrid 试点：两房 ——
  { key: 'speedgrid', gameName: 'speedgrid', room: '30s', prefix: 'SG', timings: {} },                        // 标准房（key 裸 gameName，向后兼容）
  { key: 'speedgrid:15s', gameName: 'speedgrid', room: '15s', prefix: 'SG15', timings: { bettingMs: 15000 } }, // 快房：只砍 betting，idle 仍 5000
  // —— 其余 8 款：各一标准房，room 落 NULL，prefix/timings 沿用 ROOM_ENGINES/ROOM_TIMINGS ——
  ...['numberup', 'derbyday', 'dominoduel', 'hattrick', 'goldenboot', 'halftime', 'wuxing', 'lineup']
    .map((g) => ({ key: g, gameName: g, room: null, prefix: null, timings: {} })),
];

// 某款的所有房 key（下注相位闸按 roundId 在该款所有房里定位当期房用）
const roomKeysOfGame = (gameName) => ROOM_CONFIGS.filter((c) => c.gameName === gameName).map((c) => c.key);
// 该款的标准房 key（= 裸 gameName）
const defaultRoomKeyOf = (gameName) => gameName;
// 本轮启动的房 key 列表
const ROOMS_TO_START = ROOM_CONFIGS.map((c) => c.key);
// recoverOrphans 扫描面：按【款】扫（引擎按 game 命中），两房孤儿一起收
const GAMES_TO_RECOVER = [...new Set(ROOM_CONFIGS.map((c) => c.gameName))];

// 模块级房间表：roomKey → room。round.js 的下注端点通过 getRoomState() 读同一活对象判相位。
const rooms = new Map();
let started = false;

// 私密字段（serverSeed）只活在 room 内存里，reveal 前不出现在任何广播/快照/日志。
function makeRoom(cfg) {
  const { key, gameName, room, prefix, timings } = cfg;
  const engine = ROOM_ENGINES[gameName];
  return {
    roomKey: key,
    gameName,
    room,                                   // 落 rounds.room 的值（null = 该款标准房）
    engine: prefix ? { ...engine, prefix } : engine,   // 房级 prefix 覆盖引擎默认（每房独立发号）
    timings: { ...timingsFor(gameName), ...timings },  // 房级节奏覆盖（15s 房砍 bettingMs）
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
  const { engine, gameName, roomKey } = room;

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
    // #42：room 一并落库（null = 该款标准房；试点 speedgrid 两房显式落 '30s'/'15s'）。
    // game 恒为款名不含房——ledger 类型/引擎表/风控/注册表全部按 game 命中，房化对它们无感。
    const ins = await query(
      `INSERT INTO rounds (game, player_id, round_no, client_seed, result_hash, status, room)
       VALUES ($1, NULL, $2, $3, $4, 'betting', $5)
       RETURNING id`,
      [gameName, roundNo, clientSeed, serverSeedHash, room.room],
    );
    room.roundId = ins.rows[0].id;
  } catch (err) {
    // 落库失败：本期无 roundId → 下注端点会因 phase 判定/roundId 缺失兜住；短暂跳到 idle 再重试。
    console.error(`[roundHub:${roomKey}] betting round 落库失败：`, err.message);
    room.phase = 'idle';
    room.endsAt = Date.now() + room.timings.idleMs;
    room.timer = setTimeout(() => { room.nonce += 1; runBetting(room).catch(logLoopErr(roomKey)); }, room.timings.idleMs);
    return;
  }

  room.endsAt = Date.now() + room.timings.bettingMs;
  broadcast(room, {
    type: 'phase',
    phase: 'betting',
    roundNo,
    roundId: room.roundId,
    endsAt: room.endsAt,
    durationMs: room.timings.bettingMs,
    serverSeedHash,
    clientSeed,
    nonce,
  });

  room.timer = setTimeout(() => runLocked(room), room.timings.bettingMs);
}

// —— locked：封盘缓冲（2s），给「betting 末刻刚通过相位判定的 HTTP 下注」留出提交窗口 ——
// 保证任何被接受的下注都在 drawn 的结算 SELECT 之前落库，规避截止边界竞态。
function runLocked(room) {
  room.phase = 'locked';
  room.endsAt = Date.now() + room.timings.lockedMs;
  broadcast(room, {
    type: 'phase',
    phase: 'locked',
    roundNo: room.roundNo,
    roundId: room.roundId,
    endsAt: room.endsAt,
    durationMs: room.timings.lockedMs,
  });
  room.timer = setTimeout(() => { runDrawn(room).catch(logLoopErr(room.roomKey)); }, room.timings.lockedMs);
}

// —— drawn：一次 spin 开奖 → reveal（广播 serverSeed + UPDATE 落 result/server_seed）→ 结算全员 → settled ——
async function runDrawn(room) {
  const { engine, roomKey } = room;
  room.phase = 'drawn';

  const rng = makeSeededRng(room.serverSeed, room.clientSeed, room.nonce);
  const { drawResult, hits, pushes } = engine.spin(rng);
  room.drawResult = drawResult;

  // reveal 落库：此刻才写 server_seed 明文 + result。
  // 单V1：nonce 随 result JSONB 落库（照即时游戏 Dice 先例 round.js:356），补齐本地重算三要素
  // （serverSeed+clientSeed+nonce）——历史局可查。room.nonce 即本期 RNG 派生序（276 行已用），
  // 只落已有值，开奖推导/RNG/reveal 顺序一行不改。
  try {
    await query(
      `UPDATE rounds SET result = $1::jsonb, server_seed = $2, status = 'drawn' WHERE id = $3`,
      [JSON.stringify({ drawResult, nonce: room.nonce }), room.serverSeed, room.roundId],
    );
  } catch (err) {
    console.error(`[roundHub:${roomKey}] drawn 落库失败：`, err.message);
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
    console.error(`[roundHub:${roomKey}] settled 落库失败：`, err.message);
  }
  room.phase = 'settled';
  broadcast(room, { type: 'phase', phase: 'settled', roundNo: room.roundNo, roundId: room.roundId });

  runIdle(room);
}

// —— 结算：SELECT 本期全部 pending bets → 逐玩家逐 key 三态 → 赢/push credit、全输 distributeLoss ——
// 幂等/恰好一次：每玩家事务内先「守 pending 翻转 outcome」（rowCount=0 即已结算，跳过），
// 再 credit（幂等键 rgs-<roundId>-<playerId>-<betId>，#P0 后为每注行粒度；ledger 唯一键兜底）。
// 单玩家失败记日志继续结其他人。
async function settleRound(room, hits, pushes) {
  const { engine, gameName, roundId, roomKey } = room;
  const maxPayout = String(maxPayoutFor(gameName));

  let bets;
  try {
    bets = (await query(
      `SELECT id, player_id, amount, selections FROM bets WHERE round_id = $1 AND outcome = 'pending'`,
      [roundId],
    )).rows;
  } catch (err) {
    console.error(`[roundHub:${roomKey}] 读本期 bets 失败：`, err.message);
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
        // #S2：同批追记本行逐 key 三态明细 settle_detail（[{key,outcome,payout}]，纯留痕，不进资金路径）。
        const flip = await client.query(
          `UPDATE bets SET outcome = $2, settle_detail = $3 WHERE id = $1 AND outcome = 'pending' RETURNING id`,
          [bet.id, win ? 'win' : 'lose', JSON.stringify(yourResult)],
        );
        if (flip.rowCount === 0) return null; // 已被结算过（重试/并发），跳过，绝不重复派彩

        let balanceAfter;
        if (win) {
          // #P0：派彩幂等键改「每注行」粒度（附 bet.id）。原每(轮,玩家)一键会让同轮玩家第 2+ 个
          // winning 注行 credit 撞 idx_ledger_idempotency_key → 整事务回滚 → 卡 pending、钱扣未派。
          // 单行局键值语义等价（历史老键已用不会重试）；多行局各注行独立结算，互不撞键。
          // ⚠ 钳制(maxPayout)粒度随之从(轮,玩家)变为(注行)：属本设计有意为之——下注前的敞口闸
          //   已在玩家/轮层兜底封顶，注行级钳制只是各行各自不超单注上限。
          const cr = await credit(client, {
            playerId,
            amount: totalPayout,
            type: `${gameName}_payout`,
            idempotencyKey: `rgs-${roundId}-${playerId}-${bet.id}`,
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

      // #P0 广播合并：同玩家同轮多注行——拼接 yourResult、累加 totalPayout（消灭"全押只见最后一行未中"）。
      // balanceAfter 取本行（最新提交的钱包余额，顺序处理故末行即玩家轮末真余额）。
      if (settled) {
        const prev = perPlayer.get(String(playerId));
        perPlayer.set(String(playerId), prev
          ? {
            yourResult: [...prev.yourResult, ...settled.yourResult],
            totalPayout: round2(Number(prev.totalPayout) + Number(settled.totalPayout)),
            balanceAfter: settled.balanceAfter,
          }
          : settled);
      }
    } catch (err) {
      console.error(`[roundHub:${roomKey}] 结算玩家 ${playerId} 失败（跳过，靠幂等键下次补结）：`, err.message);
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

// —— idle：结算完到下一期的停顿（各房独立，≥ 开奖舞台动画长度，防下一期切断动画）——
function runIdle(room) {
  room.phase = 'idle';
  room.endsAt = Date.now() + room.timings.idleMs;
  broadcast(room, {
    type: 'phase',
    phase: 'idle',
    roundNo: room.roundNo,
    roundId: room.roundId,
    endsAt: room.endsAt,
    durationMs: room.timings.idleMs,
  });
  room.timer = setTimeout(() => {
    room.nonce += 1;
    runBetting(room).catch(logLoopErr(room.roomKey));
  }, room.timings.idleMs);
}

function logLoopErr(roomKey) {
  return (err) => console.error(`[roundHub:${roomKey}] 相位循环异常：`, err.message);
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
// 按 roomKey 取房态。#42：标准房 roomKey === 裸 gameName，故既有调用 getRoomState('speedgrid')
// 一律照旧命中标准房 —— 前端零碰、旧客户端无感。
export function getRoomState(roomKey) {
  const room = rooms.get(roomKey);
  if (!room) return null;
  return { phase: room.phase, roundNo: room.roundNo, roundId: room.roundId, endsAt: room.endsAt, roomKey: room.roomKey };
}

// #42：按 roundId 在【该款所有房】里定位「当期且正在 betting」的那一房。
// 为什么按 roundId 而不是让客户端报房名：roundId 是服务端发的、且必须等于某房【此刻】的当期轮
// —— 客户端谎报房名没用（房名对不上 roundId 就找不到），谎报 roundId 也没用（不是当期就找不到）。
// 找不到 → 调用方走原 round_locked 路径，与旧行为一致。
export function findBettingRoomByRoundId(gameName, roundId) {
  for (const key of roomKeysOfGame(gameName)) {
    const room = rooms.get(key);
    if (room && room.phase === 'betting' && room.roundId != null && String(room.roundId) === String(roundId)) {
      return { phase: room.phase, roundNo: room.roundNo, roundId: room.roundId, endsAt: room.endsAt, roomKey: key };
    }
  }
  return null;
}

// 从 WS 升级请求的 query 解析目标房 key（?game=<backendId>&room=<房段>）。
// 返回 roomKey | null（null = 显式非法，调用方拒绝连接）。
//
// #42 三条口径：
//   1) 缺 room 参 → 该款【标准房】（roomKey = 裸 gameName）。旧客户端只带 ?game= → 原样落标准房，
//      部署后玩家无感（单2 才教前端带 room）。
//   2) 显式 room 但拼不出合法房 → null → 拒绝关闭。【绝不兜底】：旧代码把非法值默默丢进
//      speedgrid，房化后那意味着 15s 房的玩家被塞进 30s 房——他看着别人的局下注，
//      比直接断连恶劣得多。宁可拒。
//   3) game 本身缺省/非法 → 仍兜底 speedgrid（保持旧行为，向后兼容旧连接）。
function roomNameOf(req) {
  let g, r;
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    g = q.get('game');
    r = q.get('room');
  } catch {
    return defaultRoomKeyOf('speedgrid');   // URL 都解不出：按旧行为兜底标准 speedgrid 房
  }
  const gameName = g && ROOM_CONFIGS.some((c) => c.gameName === g) ? g : 'speedgrid';
  if (r == null || r === '') return defaultRoomKeyOf(gameName);   // 缺 room → 标准房
  const key = `${gameName}:${r}`;
  if (rooms.has(key)) return key;
  // 显式带了 room 却拼不出房：可能是 ?room=30s（标准房的房段名）——也放行，语义等价
  const std = ROOM_CONFIGS.find((c) => c.gameName === gameName && c.room === r);
  if (std) return std.key;
  return null;   // 显式非法 → 拒
}

// ============ 孤儿注恢复（启动时一次性，早于任何新开局）============
//
// 病因：进程在 betting/drawn 相位被杀（kill -9/崩溃/重启），相位机是纯内存态、随进程蒸发，DB 里
//   留下「轮没终态 + 注还 pending + 钱在下注时已扣走」的孤儿注——玩家钱没了，局却永远不会结。
//   注：'locked' 只是内存相位，从不落库（见 194/286/306 三处 status 写入），故不在扫描范围。
//
// 两条路径，定调「玩家不吃亏」：
//   a) drawn（result 已落库、开奖已公开）：按已公开的 draw 复算补结算。幂等键沿用正常结算的原键
//      rgs-<roundId>-<playerId>-<betId>——若 settleRound 其实已派过，这里撞 idx_ledger_idempotency_key
//      即被 ledger 唯一键挡下，绝不重复派彩（双保险：外层还有守 pending 翻转）。
//   b) betting（未开奖、无 result，本期结果永不存在）：全额退本金 + 轮置 void。
//      ⚠ 禁在此处补 spin 造结果：serverSeed 明文只活在内存、随进程蒸发（commit-reveal 铁律），
//        任何「补开」都是新造的一局，不是玩家当时下注面对的那一局——只能退钱。
//
// 复算走 settleDerive 单一出处（与 scripts/repair_stuck_bets.mjs 同一份），禁手写第二份判定。
// 韧性：整体 try/catch 兜底，单轮失败记日志继续下一轮，恢复失败绝不阻断排期器启动
//   （失败的轮下次启动会再被扫到——幂等键保证重试安全）。
async function recoverOrphans() {
  let orphans;
  try {
    orphans = (await query(
      `SELECT id, game, round_no, status, result FROM rounds
        WHERE game = ANY($1) AND status IN ('betting', 'drawn')
        ORDER BY id`,
      // #42：按【款】扫，不是按房 key —— ROOMS_TO_START 现在装的是 roomKey（含 'speedgrid:15s'），
      //   拿它查 rounds.game 一条都扫不到（game 列恒为裸款名）。GAMES_TO_RECOVER 是去重后的款名，
      //   两房的孤儿一起收；复算走 settleDerive 按 game 命中引擎，房维度对恢复天然无感。
      [GAMES_TO_RECOVER],
    )).rows;
  } catch (err) {
    console.error('[roundHub:recover] 扫孤儿轮失败（跳过恢复，不阻断启动）：', err.message);
    return;
  }
  if (orphans.length === 0) {
    console.log('[roundHub:recover] 无孤儿轮，跳过');
    return;
  }

  const stat = { settled: 0, payout: 0, refund: 0, refundSum: 0, voidEmpty: 0, err: 0 };
  for (const round of orphans) {
    try {
      const bets = (await query(
        `SELECT id, player_id, amount, selections FROM bets WHERE round_id = $1 AND outcome = 'pending'`,
        [round.id],
      )).rows;
      if (round.status === 'drawn') await recoverDrawnRound(round, bets, stat);
      else await recoverBettingRound(round, bets, stat);
    } catch (err) {
      stat.err++;
      console.error(`[roundHub:recover] ❌ round#${round.id} ${round.game} ${round.round_no} (${round.status}) 恢复失败（跳过，下次启动重试）：`, err.message);
    }
  }
  console.log(`[roundHub:recover] 收口：孤儿轮 ${orphans.length} → 补结算 ${stat.settled} 注（派彩 $${round2(stat.payout)}）/ 退款 ${stat.refund} 注（$${round2(stat.refundSum)}）/ 空轮置 void ${stat.voidEmpty} 轮 / 失败 ${stat.err} 轮`);
}

// a) drawn 轮：result 已公开 → settleDerive 复算 → 逐注补结算（与 settleRound 同构：win 走原键 credit，
//    lose 走 distributeLoss 链式分成）→ 轮改 settled。缺 result 即抛（drawOf 铁律，禁默认 0）。
async function recoverDrawnRound(round, bets, stat) {
  const draw = drawOf(round);   // 缺 result/drawResult → 抛 → 上层记错跳过，轮留 drawn 待人工核
  for (const bet of bets) {
    const det = computeDetail(round.game, bet.selections, draw);
    const capped = await capPayout(round.game, det.rawTotalPayout);
    const win = Number(capped) > 0;
    const done = await withTransaction(async (client) => {
      // 守 pending 翻转（与 settleRound 同一护栏）：rowCount=0 即已被正常结算，跳过，绝不重复派彩
      const flip = await client.query(
        `UPDATE bets SET outcome = $2, settle_detail = $3 WHERE id = $1 AND outcome = 'pending' RETURNING id`,
        [bet.id, win ? 'win' : 'lose', JSON.stringify(det.yourResult)],
      );
      if (flip.rowCount === 0) return false;
      if (win) {
        await credit(client, {
          playerId: bet.player_id,
          amount: capped,
          type: `${round.game}_payout`,
          idempotencyKey: `rgs-${round.id}-${bet.player_id}-${bet.id}`,   // 原键：与 settleRound 撞键即证明已派
          roundId: round.id,
        });
      } else {
        // 全输：注额进链式分成（补上这一局本该发生的分成），玩家钱包在下注时已扣，此处不动。
        // 口径：drawn 轮结算从未启动，分成确定为零 → 完整重放含分成
        //   —— 与 repair_stuck_bets（仅解卡）刻意不对称
        const pr = await client.query('SELECT agent_id FROM players WHERE id = $1', [bet.player_id]);
        const agentId = pr.rows[0]?.agent_id;
        if (agentId) await distributeLoss(client, { playerId: bet.player_id, agentId, roundId: round.id, lossAmount: bet.amount });
      }
      return true;
    });
    if (done) {
      stat.settled++;
      stat.payout = round2(stat.payout + Number(capped));
      console.log(`[roundHub:recover] ${win ? '💰' : '·'} 补结算 bet#${bet.id} ${round.game} ${round.round_no} 注$${bet.amount} → ${win ? 'win' : 'lose'} 派$${round2(Number(capped))}`);
    }
  }
  // 全注处理完才置终态；中途抛异常 → 轮留 drawn，下次启动重试（幂等键保证安全）
  await query(`UPDATE rounds SET status = 'settled' WHERE id = $1 AND status = 'drawn'`, [round.id]);
}

// b) betting 轮：本期结果永不存在 → 逐 pending 注全额退本金（outcome='refund'）→ 轮置 void。
//    无注的空轮不打单行日志，只进聚合计数。
async function recoverBettingRound(round, bets, stat) {
  for (const bet of bets) {
    // settle_detail 与正常结算同构（[{key,outcome,payout}]），三态外新增 refund：逐 key 原样退注额。
    // selections 缺失（防御：非排期器格式）→ 空数组，前端 betDetail 回落摘要，退款金额仍按注行本金走。
    const detail = Object.entries(bet.selections || {}).map(([key, amt]) => ({ key, outcome: 'refund', payout: Number(amt) }));
    const done = await withTransaction(async (client) => {
      const flip = await client.query(
        `UPDATE bets SET outcome = 'refund', settle_detail = $2 WHERE id = $1 AND outcome = 'pending' RETURNING id`,
        [bet.id, JSON.stringify(detail)],
      );
      if (flip.rowCount === 0) return false;   // 已被处理过（重复启动/并发），跳过，绝不重复退款
      await credit(client, {
        playerId: bet.player_id,
        amount: bet.amount,
        type: `${round.game}_refund`,
        idempotencyKey: `refund-${bet.id}`,
        roundId: round.id,
      });
      return true;
    });
    if (done) {
      stat.refund++;
      stat.refundSum = round2(stat.refundSum + Number(bet.amount));
      console.log(`[roundHub:recover] ↩ 退注 bet#${bet.id} ${round.game} ${round.round_no} player#${bet.player_id} 退$${bet.amount}`);
    }
  }
  if (bets.length === 0) stat.voidEmpty++;
  await query(`UPDATE rounds SET status = 'void' WHERE id = $1 AND status = 'betting'`, [round.id]);
}

/**
 * 启动轮次排期器：为 ROOMS_TO_START 每款各建一个独立房间（独立相位循环 + 独立期号前缀），
 * 恢复各自当日期号、挂新连接快照（按 ?game= 路由到对应房间）、起各房相位循环。
 * 模块级单例，重复调用忽略（避免起两个并行循环）。
 * 起循环前先 await recoverOrphans()（上次进程被杀留下的孤儿注补结算/退款），确保恢复早于任何新开局。
 * @param {import('ws').WebSocketServer} wss - /ws/rounds 的 WSS
 */
export async function startRoundHub(wss) {
  if (started) {
    console.error('[roundHub] startRoundHub 被重复调用，已忽略');
    return;
  }
  started = true;

  // 建所有房间对象（先 set 进 rooms，roomNameOf 才能识别合法 roomKey）。
  for (const cfg of ROOM_CONFIGS) {
    rooms.set(cfg.key, makeRoom(cfg));
  }

  // 单一 connection handler 按 ?game=&room= 路由到对应房间（各房独立 clients 集合，广播互不串扰）。
  wss.on('connection', (ws, req) => {
    // 未认证的连接已被 index.js 握手 handler close，ws.playerId 不会挂上；显式跳过。
    if (!ws.playerId) return;
    const key = roomNameOf(req);
    // #42：显式非法 room → 拒绝并关闭（不再静默兜底）。旧行为把非法值默默落到 speedgrid，
    // 房化后那等于把 15s 房的玩家丢进 30s 房——错房比断连危险得多（他看的是别人的局）。
    if (key === null) {
      try { ws.close(1008, 'invalid_room'); } catch { /* 连接已异常 */ }
      return;
    }
    const room = rooms.get(key);
    if (!room) return;

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

  // 起任何新局之前，先把上次进程被杀留下的孤儿注收干净（drawn 补结算 / betting 退款置 void）。
  // 位置铁律：必须在 wss.on('connection') 注册【之后】（恢复期间进来的连接不能丢），且在下面
  // runBetting 循环【之前】（新局一开，孤儿轮的 pending 注会混进新一期的结算视野）。
  // recoverOrphans 内部全兜底不抛，故调用方 index.js 维持 fire-and-forget 不需改。
  await recoverOrphans();

  // 每房恢复当日期号序号后各自起循环（防重启撞号）。
  // #42：recoverSeq 签名不动 —— 它按 `game=$1 AND round_no LIKE '<prefix>-日期-%'` 发号，
  //   同款两房 prefix 不同（SG / SG15），LIKE 天然互不匹配 → 各房独立递增，不依赖 room 列。
  for (const key of ROOMS_TO_START) {
    const room = rooms.get(key);
    recoverSeq(room.gameName, room.engine.prefix, dateKeyNow()).then((mx) => {
      room.dateKey = dateKeyNow();
      room.seq = mx; // 首个 runBetting 会 +1
      console.log(`[roundHub:${key}] 排期器启动（前缀 ${room.engine.prefix}-，betting ${room.timings.bettingMs}ms/idle ${room.timings.idleMs}ms），当日已用序号 ${mx}，下一期 ${mx + 1}`);
      runBetting(room).catch(logLoopErr(key));
    });
  }
}
