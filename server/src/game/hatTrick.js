// Hat Trick（快3三骰彩：和值 + 豹子 + 对子 + 大小单双）可验证公平引擎（纯函数，便于单测/对拍）。
// 原子轮次局：押盘口 → 三骰各 1–6 独立均匀抽 → 逐盘口结算。
//
// ⚠️ 埋尸点铁律：rollDice / deriveRoll / ODDS(含 total[4..17] 和值表) / MARKETS 逐位照抄前端
//    src/games/HatTrick.jsx，改一处必须改两处，一个数都别动别重算。
//
// 通杀（豹子 void）铁律：开出豹子时 BIG/SMALL/ODD/EVEN 四侧【全输不退】（hit 判定含 !isTriple，
//    非 push）；和值盘只开 4–17，开出 3/18（必为豹子）自然无格可中。
//
// 开奖不信前端：rollDice(rng) 用注入的 seededRng（HMAC 派生 [0,1)），三次调用顺序固定 d1→d2→d3。
// 52-bit uniform 使 floor(U×6) 偏差 ≈ 1e-14（可忽略），无需拒绝采样。
import crypto from 'crypto';

// 开奖：三骰各 1–6 独立均匀。rng 由 makeSeededRng 注入，顺序固定 d1→d2→d3。
export function rollDice(rng) {
  const d1 = 1 + Math.floor(rng() * 6);
  const d2 = 1 + Math.floor(rng() * 6);
  const d3 = 1 + Math.floor(rng() * 6);
  return [d1, d2, d3];
}

// 派生：和值(3–18) / 豹子 / 豹子面 / 对子面集合 / 大小(11–17 / 4–10) / 单双。逐位照抄前端。
// doubles 口径（行业惯例）：某面出现 ≥2 次即算该面对子——豹子含在指定对子内。
export function deriveRoll(dice) {
  const total = dice[0] + dice[1] + dice[2];
  const isTriple = dice[0] === dice[1] && dice[1] === dice[2];
  const doubles = new Set();
  for (let v = 1; v <= 6; v++) {
    if ((dice[0] === v) + (dice[1] === v) + (dice[2] === v) >= 2) doubles.add(v);
  }
  return {
    dice, total, isTriple,
    tripleFace: isTriple ? dice[0] : null,
    doubles,
    big: total >= 11 && total <= 17,
    small: total >= 4 && total <= 10,
    odd: total % 2 === 1,
    even: total % 2 === 0,
  };
}

// 赔率配置表（逐位照抄前端）：和值 4–17 表 + 侧注 1.96 + 任意豹 34.38 + 指定豹 206.28 + 指定对 12.89。
export const ODDS = {
  total: {
    4: 68.76, 5: 34.38, 6: 20.63, 7: 13.75, 8: 9.82, 9: 8.25, 10: 7.64,
    11: 7.64, 12: 8.25, 13: 9.82, 14: 13.75, 15: 20.63, 16: 34.38, 17: 68.76,
  },
  side: 1.96,        // BIG/SMALL/ODD/EVEN（豹子通杀）
  anyTriple: 34.38,
  triple: 206.28,    // 指定三同
  double: 12.89,     // 指定对子（含该面豹子）
};

// 盘区判定表 — 数据驱动生成（31 键：14 和值 + 4 侧注 + 1 任意豹子 + 6 指定豹子 + 6 指定对子）。逐位照抄前端。
export const MARKETS = (() => {
  const m = {};
  for (let s = 4; s <= 17; s++) m[`t-${s}`] = { odds: ODDS.total[s], hit: (r) => r.total === s };
  m['s-big'] = { odds: ODDS.side, hit: (r) => r.big && !r.isTriple };
  m['s-small'] = { odds: ODDS.side, hit: (r) => r.small && !r.isTriple };
  m['s-odd'] = { odds: ODDS.side, hit: (r) => r.odd && !r.isTriple };
  m['s-even'] = { odds: ODDS.side, hit: (r) => r.even && !r.isTriple };
  m['tr-any'] = { odds: ODDS.anyTriple, hit: (r) => r.isTriple };
  for (let v = 1; v <= 6; v++) {
    m[`tr-${v}`] = { odds: ODDS.triple, hit: (r) => r.tripleFace === v };
    m[`d-${v}`] = { odds: ODDS.double, hit: (r) => r.doubles.has(v) };
  }
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

// HatTrick 无 push 项（豹子通杀是判输不退，非退注；其余盘口均为 hit/lose 两态）。
export const HAS_PUSH = false;

/** 通用轮次 handler 接口：开奖 + 派生 + 命中。返回 { drawResult, hits:Set, pushes:Set }。 */
export function spin(rng) {
  const dice = rollDice(rng);
  const r = deriveRoll(dice);
  return { drawResult: { dice, sum: r.total }, hits: hitsOf(r), pushes: new Set() };
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
