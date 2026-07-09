// Half Time（快乐8和值盘 · 足球皮）可验证公平引擎（纯函数，便于单测/对拍）。
// 原子轮次局：押盘口（大小/单双/二串/五行带/半场计数）→ 1–80 无重复抽 20 球 → 逐盘口结算。
//
// ⚠️ 埋尸点铁律：drawRound / deriveRound / ODDS / MARKETS(含 over/under 边界 811/810、
//    五行带 og/df/mf/at/gl 和值边界、半场计数 h1/draw/h2) 逐位照抄前端 src/games/HalfTime.jsx，
//    改一处必须改两处，一个数都别动别重算。
//
// draw（低区恰 10）铁律：draw 是【独立市场】（押 lowCount===10，赔率 4.7），【非 push】——
//    不退注、判 hit/lose 两态。h1/draw/h2 三者对 lowCount 互补覆盖。
//
// 开奖不信前端：drawRound(rng) 用注入的 seededRng（HMAC 派生 [0,1)），Fisher-Yates 洗 80 取 20
//    多次调用 rng，seededRng 的 counter 续熵支持。52-bit uniform floor 偏差 ≈ 1e-14，无需拒绝采样。
import crypto from 'crypto';

// 开奖：Fisher-Yates 洗满 1–80 池取前 20，保留开出顺序。rng 由 makeSeededRng 注入。
export function drawRound(rng) {
  const pool = Array.from({ length: 80 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 20);
}

// 派生：总和 + 半场计数（20 球中落在 1–40 区间的个数）。逐位照抄前端。
//   lowCount >10 → 1ST HALF，<10 → 2ND HALF，=10 → DRAW。
export function deriveRound(balls) {
  const sum = balls.reduce((a, b) => a + b, 0);
  const lowCount = balls.filter((n) => n <= 40).length;
  return { balls, sum, lowCount };
}

export const halfOf = (r) => (r.lowCount > 10 ? 'F' : r.lowCount < 10 ? 'S' : 'D');

// 赔率配置表（逐位照抄前端）。
export const ODDS = {
  over: 1.95, under: 1.90,
  odd: 1.95, even: 1.95,
  'p-oo': 3.8, 'p-oe': 3.8, 'p-uo': 3.8, 'p-ue': 3.8,
  og: 9.25, df: 4.7, mf: 2.46, at: 4.7, gl: 9.25,
  h1: 2.4, draw: 4.7, h2: 2.4,
};

// 盘区判定表（逐位照抄前端）：18 键 = 大小 + 单双 + 二串 p-* + 五行带 og/df/mf/at/gl + 半场 h1/draw/h2。
export const MARKETS = {
  over: { odds: ODDS.over, hit: (r) => r.sum >= 811 },
  under: { odds: ODDS.under, hit: (r) => r.sum <= 810 },
  odd: { odds: ODDS.odd, hit: (r) => r.sum % 2 === 1 },
  even: { odds: ODDS.even, hit: (r) => r.sum % 2 === 0 },
  'p-oo': { odds: ODDS['p-oo'], hit: (r) => r.sum >= 811 && r.sum % 2 === 1 },
  'p-oe': { odds: ODDS['p-oe'], hit: (r) => r.sum >= 811 && r.sum % 2 === 0 },
  'p-uo': { odds: ODDS['p-uo'], hit: (r) => r.sum <= 810 && r.sum % 2 === 1 },
  'p-ue': { odds: ODDS['p-ue'], hit: (r) => r.sum <= 810 && r.sum % 2 === 0 },
  og: { odds: ODDS.og, hit: (r) => r.sum <= 695 },
  df: { odds: ODDS.df, hit: (r) => r.sum >= 696 && r.sum <= 763 },
  mf: { odds: ODDS.mf, hit: (r) => r.sum >= 764 && r.sum <= 855 },
  at: { odds: ODDS.at, hit: (r) => r.sum >= 856 && r.sum <= 923 },
  gl: { odds: ODDS.gl, hit: (r) => r.sum >= 924 },
  h1: { odds: ODDS.h1, hit: (r) => r.lowCount > 10 },    // 1–40 区多
  draw: { odds: ODDS.draw, hit: (r) => r.lowCount === 10 },  // 恰 10 / 10
  h2: { odds: ODDS.h2, hit: (r) => r.lowCount < 10 },    // 41–80 区多
};
const MARKET_KEYS = Object.keys(MARKETS);

/** 给定派生结果 r，返回命中的盘口 key 集合。 */
export function hitsOf(r) {
  return new Set(MARKET_KEYS.filter((k) => MARKETS[k].hit(r)));
}

/** 合法盘口 key 校验。 */
export function isValidMarketKey(key) {
  return Object.prototype.hasOwnProperty.call(MARKETS, key);
}

// HalfTime 无 push 项（draw 是独立 hit/lose 市场，非退注；各组划分对结果空间无退注条款）。
export const HAS_PUSH = false;

/** 通用轮次 handler 接口：开奖 + 派生 + 命中。返回 { drawResult, hits:Set, pushes:Set }。 */
export function spin(rng) {
  const balls = drawRound(rng);
  const r = deriveRound(balls);
  return { drawResult: { balls, sum: r.sum, lowCount: r.lowCount }, hits: hitsOf(r), pushes: new Set() };
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
