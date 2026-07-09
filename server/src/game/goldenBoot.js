// Golden Boot（PK10 · 10 车冲刺排名彩）可验证公平引擎（纯函数，便于单测/对拍）。
// 原子轮次局：押盘口（冠军直选/冠亚和/大小单双）→ Fisher-Yates 洗 10 排名次 → 逐盘口结算。
//
// ⚠️ 埋尸点铁律：drawRace / deriveRace / SUM_N(冠亚和频次表) / sumOdds / ODDS / MARKETS 逐位照抄前端
//    src/games/GoldenBoot.jsx，改一处必须改两处，一个数都别动别重算。
//
// ⚠️ SUM_N 冠亚和频次表是最关键埋尸点：冠亚和分布【非均匀】，是两名次无序对的频次
//    （枚举 90 有序对 → 45 无序对，各和值 s 出现次数）。务必照抄别自己重算。
//
// 开奖不信前端：drawRace(rng) 用注入的 seededRng（HMAC 派生 [0,1)），Fisher-Yates 洗 10
//    多次调用 rng，seededRng 的 counter 续熵支持。52-bit uniform floor 偏差 ≈ 1e-14，无需拒绝采样。
import crypto from 'crypto';

// 开奖：Fisher-Yates 全洗 1–10，返回按名次排的车号（order[0] = 冠军）。rng 由 makeSeededRng 注入。
export function drawRace(rng) {
  const order = Array.from({ length: 10 }, (_, i) => i + 1);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// 派生：冠军 / 亚军 / 冠亚和 / 名次映射。逐位照抄前端。
export function deriveRace(order) {
  const winner = order[0];
  const runnerUp = order[1];
  const sprintSum = winner + runnerUp;
  const rank = {};
  order.forEach((n, i) => { rank[n] = i + 1; });
  return { order, winner, runnerUp, sprintSum, rank };
}

// 冠亚和频次表（逐位照抄前端）：90 有序 (冠,亚) 对 → 45 无序对，各和值 s 的无序对数 n(s)。
//   3,4,18,19→1 · 5,6,16,17→2 · 7,8,14,15→3 · 9,10,12,13→4 · 11→5
const SUM_N = { 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3, 9: 4, 10: 4, 11: 5, 12: 4, 13: 4, 14: 3, 15: 3, 16: 2, 17: 2, 18: 1, 19: 1 };
const sumOdds = (s) => Math.round((0.955 * 45 / SUM_N[s]) * 100) / 100;   // 42.98/21.49/14.33/10.74/8.60

// 赔率配置表（逐位照抄前端）：冠军 9.60 / 冠亚和 = sumOdds(s) / 大小单双 2.15·1.72·1.72·2.15。
export const ODDS = {
  winner: 9.6,
  sum: Object.fromEntries(Object.keys(SUM_N).map((s) => [s, sumOdds(+s)])),
  big: 2.15, small: 1.72, odd: 1.72, even: 2.15,
};

// 盘区判定表 — 数据驱动生成（31 键：10 冠军 + 17 冠亚和(3-19) + 4 大小单双）。逐位照抄前端。
export const MARKETS = (() => {
  const m = {};
  for (let n = 1; n <= 10; n++) m[`w-${n}`] = { odds: ODDS.winner, hit: (r) => r.winner === n };
  for (const s of Object.keys(SUM_N).map(Number)) m[`sum-${s}`] = { odds: ODDS.sum[s], hit: (r) => r.sprintSum === s };
  m['s-big'] = { odds: ODDS.big, hit: (r) => r.sprintSum >= 12 };
  m['s-small'] = { odds: ODDS.small, hit: (r) => r.sprintSum <= 11 };
  m['s-odd'] = { odds: ODDS.odd, hit: (r) => r.sprintSum % 2 === 1 };
  m['s-even'] = { odds: ODDS.even, hit: (r) => r.sprintSum % 2 === 0 };
  return m;
})();
const MARKET_KEYS = Object.keys(MARKETS);

/** 给定派生结果 r，返回命中的盘口 key 集合。 */
export function hitsOf(r) {
  return new Set(MARKET_KEYS.filter((k) => MARKETS[k].hit(r)));
}

/** 合法盘口 key 校验。 */
export function isValidMarketKey(key) {
  return Object.prototype.hasOwnProperty.call(MARKETS, key);
}

// GoldenBoot 无 push 项（冠军/冠亚和/大小单双各组划分对结果空间无重叠退注条款）。
export const HAS_PUSH = false;

/** 通用轮次 handler 接口：开奖 + 派生 + 命中。返回 { drawResult, hits:Set, pushes:Set }。 */
export function spin(rng) {
  const order = drawRace(rng);
  const r = deriveRace(order);
  return { drawResult: { ranking: order, champion: r.winner, runnerUp: r.runnerUp, sprintSum: r.sprintSum }, hits: hitsOf(r), pushes: new Set() };
}

export function hashSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}
export function newServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}
export function newClientSeed() {
  return crypto.randomBytes(8).toString('hex');
}
