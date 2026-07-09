// 五行 WuXing（KENO 20 球快开五项皮 · 80 池无放回抽 20 比总和）可验证公平引擎（纯函数，便于单测/对拍）。
// 原子轮次局：押盘口（大小/单双/龙虎/上下/过关/五行带）→ 1–80 无重复抽 20 球 → 逐盘口结算。
//
// ⚠️ 埋尸点铁律：drawKeno / deriveRound(含 dragon=⌊sum/10⌋%10、tiger=sum%10) / ODDS / MARKETS
//    (含五行带 wx-gold/wood/water/fire/earth 和值边界) 逐位照抄前端 src/games/WuXing.jsx，
//    改一处必须改两处，一个数都别动别重算。
//
// ⚠️ 与 HalfTime 差异（同款 80→20 抽球但引擎不同）：
//    1. drawKeno 用【部分 FY】(k=0..19，20 次 rng)，非 HalfTime 全洗(79 次)——rng 消耗序不同，务必照抄。
//    2. deriveRound 多 dragon/tiger（和值十位/个位）；balls 排序输出。
//    3. small 1.92 / 五行带 odds 与 HalfTime 不同（边界同 695/763/855/923，定价不同）。
//    4. 龙虎/上下是【三向盘】：dragon>tiger / tiger>dragon / 相等(和局)。
//
// 和局（平局）铁律：龙/虎/上/下遇「和」【判输不退】（官方无退注条款）——非 push，判 hit/lose 两态；
//    和局本身是【独立市场】dt-tie / ud-tie（有赔率，押中即赢）。
//
// 开奖不信前端：drawKeno(rng) 用注入的 seededRng（HMAC 派生 [0,1)），部分 FY 多次调用 rng，
//    seededRng 的 counter 续熵支持。52-bit uniform floor 偏差 ≈ 1e-14，无需拒绝采样。
import crypto from 'crypto';

// 开奖：80 池部分 Fisher-Yates 无放回抽 20（k=0..19）。rng 由 makeSeededRng 注入。逐位照抄前端。
export function drawKeno(rng) {
  const pool = Array.from({ length: 80 }, (_, i) => i + 1);
  for (let k = 0; k < 20; k++) {
    const j = k + Math.floor(rng() * (80 - k));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  return pool.slice(0, 20);
}

// 派生：总和 / 上盘计数(≤40) / 龙(和值十位=⌊sum/10⌋%10) / 虎(和值个位=sum%10)。逐位照抄前端。
export function deriveRound(balls) {
  const sum = balls.reduce((x, y) => x + y, 0);
  return {
    balls: [...balls].sort((a, b) => a - b),
    sum,
    up: balls.filter((n) => n <= 40).length,
    dragon: Math.floor(sum / 10) % 10,
    tiger: sum % 10,
  };
}

// 赔率配置表（逐位照抄前端；单据定稿 2026-07-06）。
export const ODDS = {
  main: 1.95, small: 1.92, dt: 2.13, dtTie: 9.55, ud: 2.4, udTie: 4.7, parlay: 3.82,
  wxGold: 9.35, wxMid: 4.72, wxWater: 2.46, wxEarth: 9.1,
};

// 盘区判定表（逐位照抄前端）：19 键；hit = 赢，无 push 项（三向盘和局判输不退）。
export const MARKETS = {
  big: { odds: ODDS.main, hit: (r) => r.sum >= 811 },
  small: { odds: ODDS.small, hit: (r) => r.sum <= 810 },
  odd: { odds: ODDS.main, hit: (r) => r.sum % 2 === 1 },
  even: { odds: ODDS.main, hit: (r) => r.sum % 2 === 0 },
  dragon: { odds: ODDS.dt, hit: (r) => r.dragon > r.tiger },
  'dt-tie': { odds: ODDS.dtTie, hit: (r) => r.dragon === r.tiger },
  tiger: { odds: ODDS.dt, hit: (r) => r.tiger > r.dragon },
  up: { odds: ODDS.ud, hit: (r) => r.up > 10 },
  'ud-tie': { odds: ODDS.udTie, hit: (r) => r.up === 10 },
  down: { odds: ODDS.ud, hit: (r) => r.up < 10 },
  'big-odd': { odds: ODDS.parlay, hit: (r) => r.sum >= 811 && r.sum % 2 === 1 },
  'small-odd': { odds: ODDS.parlay, hit: (r) => r.sum <= 810 && r.sum % 2 === 1 },
  'big-even': { odds: ODDS.parlay, hit: (r) => r.sum >= 811 && r.sum % 2 === 0 },
  'small-even': { odds: ODDS.parlay, hit: (r) => r.sum <= 810 && r.sum % 2 === 0 },
  'wx-gold': { odds: ODDS.wxGold, hit: (r) => r.sum <= 695 },
  'wx-wood': { odds: ODDS.wxMid, hit: (r) => r.sum >= 696 && r.sum <= 763 },
  'wx-water': { odds: ODDS.wxWater, hit: (r) => r.sum >= 764 && r.sum <= 855 },
  'wx-fire': { odds: ODDS.wxMid, hit: (r) => r.sum >= 856 && r.sum <= 923 },
  'wx-earth': { odds: ODDS.wxEarth, hit: (r) => r.sum >= 924 },
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

// WuXing 无 push 项（龙/虎/上/下遇和判输不退，非退注；和局 dt-tie/ud-tie 是独立 hit 市场）。
export const HAS_PUSH = false;

/** 通用轮次 handler 接口：开奖 + 派生 + 命中。返回 { drawResult, hits:Set, pushes:Set }。 */
export function spin(rng) {
  const balls = drawKeno(rng);
  const r = deriveRound(balls);
  return { drawResult: { balls, sum: r.sum, dragon: r.dragon, tiger: r.tiger }, hits: hitsOf(r), pushes: new Set() };
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
