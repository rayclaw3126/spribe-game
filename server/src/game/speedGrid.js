// Speed Grid（极速方格 / DD24 F1 皮）可验证公平引擎（纯函数，便于单测/对拍）。
// 原子轮次局：押盘口/直选 → 1–24 均匀抽 1 开冠军车号 → 逐盘口结算。
//
// ⚠️ 埋尸点铁律：RED / ODDS / MARKETS / drawCar 逐位照抄前端 src/games/SpeedGrid.jsx，
//    改一处必须改两处，一个数都别动别重算。RED 是特定 12 号集合（DD24 官方规则页转录）。
//
// 开奖不信前端：drawCar(rng) 用注入的 seededRng（HMAC 派生 [0,1)）→ 1 + floor(rng()×24)。
// 52-bit uniform 使 floor(U×24) 偏差 ≈ 1e-14（可忽略），无需拒绝采样。
import crypto from 'crypto';

// 红黑归类（DD24 官方规则页转录）：红 = 这 12 号；黑 = 其余 12。逐位照抄前端。
export const RED = new Set([1, 3, 6, 8, 9, 11, 14, 16, 17, 19, 22, 24]);

/**
 * 开奖：1–24 均匀抽 1（单随机数）。rng 由 makeSeededRng 注入。
 * @param {() => number} rng - [0,1)
 * @returns {number} 冠军车号 1–24
 */
export function drawCar(rng) {
  return 1 + Math.floor(rng() * 24);
}

const round2 = (x) => Math.round(x * 100) / 100;

// 赔率常量表（24 局全空间精确枚举定稿）。逐位照抄前端。
export const ODDS = { main: 1.95, section: 2.9, pick: 22.85, team: 3.85 };

// 盘区判定表 — 数据驱动生成（13 盘口 + 24 直选）；hit(n) = 赢，无 push 项。逐位照抄前端。
export const MARKETS = {
  big: { odds: ODDS.main, hit: (n) => n >= 13 },
  small: { odds: ODDS.main, hit: (n) => n <= 12 },
  odd: { odds: ODDS.main, hit: (n) => n % 2 === 1 },
  even: { odds: ODDS.main, hit: (n) => n % 2 === 0 },
  red: { odds: ODDS.main, hit: (n) => RED.has(n) },
  black: { odds: ODDS.main, hit: (n) => !RED.has(n) },
  'grid-front': { odds: ODDS.section, hit: (n) => n <= 8 },
  'grid-mid': { odds: ODDS.section, hit: (n) => n >= 9 && n <= 16 },
  'grid-rear': { odds: ODDS.section, hit: (n) => n >= 17 },
};
for (let t = 1; t <= 4; t++) {
  MARKETS[`team-${t}`] = { odds: ODDS.team, hit: (n) => Math.ceil(n / 6) === t };
}
for (let c = 1; c <= 24; c++) {
  MARKETS[`car-${c}`] = { odds: ODDS.pick, hit: (n) => n === c };
}
const MARKET_KEYS = Object.keys(MARKETS);

/** 给定冠军车号 n，返回命中的盘口 key 集合。 */
export function hitsOf(n) {
  return new Set(MARKET_KEYS.filter((k) => MARKETS[k].hit(n)));
}

/** 合法盘口 key 校验（结算/风控用）。 */
export function isValidMarketKey(key) {
  return Object.prototype.hasOwnProperty.call(MARKETS, key);
}

// SpeedGrid 无 push 项（每组划分对 1–24 无重叠无空隙，命中概率和恰为 1）。
export const HAS_PUSH = false;

export function hashSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}
export function newServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}
export function newClientSeed() {
  return crypto.randomBytes(8).toString('hex');
}

// round2 导出供对拍/结算复用赔付计算口径
export { round2 };
