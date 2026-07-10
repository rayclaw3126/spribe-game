// Line Up（ATOM 5×5 数字彩 · 25 个 0-9 独立均匀随机数排成五行）可验证公平引擎（纯函数，便于单测/对拍）。
// 原子轮次局：押盘口（大小/单双/红黄牌/高低/段位/逐行式）→ 25 位各 0-9 独立抽 → 逐盘口结算。
//
// ⚠️ 埋尸点铁律：drawGrid / deriveRound / ODDS / MARKETS(含行和大小分界 23/22、段位带 total 边界、
//    红黄牌 AWAY_DIGITS、高低 HIGH_DIGITS) 逐位照抄前端 src/games/LineUp.jsx，
//    改一处必须改两处，一个数都别动别重算。
//
// ⚠️ ODDS 埋尸点：段位带用【调整后】odds edge:8.0 / mid:2.5（非注释里参考原版 7.50/2.30），逐位照抄。
//
// 无 push 铁律：25/5 为奇数计数无平局、225/45 为奇数和值无中点格 —— 所有二元盘精确 0.5 互补，无退注项。
//
// 开奖不信前端：drawGrid(rng) 用注入的 seededRng（HMAC 派生 [0,1)），25 次调用 rng，
//    seededRng 的 counter 续熵支持。52-bit uniform floor(U×10) 偏差 ≈ 1e-14，无需拒绝采样。
import crypto from 'crypto';

// 归类表（逐位照抄前端）：红牌 = Red(0,2,6,7,8)；高 = 5-9。（键名沿用 away=红/home=黄）
export const AWAY_DIGITS = new Set([0, 2, 6, 7, 8]);
export const HIGH_DIGITS = new Set([5, 6, 7, 8, 9]);

// 开奖：25 个独立均匀 0-9（可重复）。rng 由 makeSeededRng 注入。逐位照抄前端。
export function drawGrid(rng) {
  return Array.from({ length: 25 }, () => Math.floor(rng() * 10));
}

// 派生：行切分/行和/总和/红黄牌计数/高低计数（结算判定只读这一份）。逐位照抄前端。
const sumOf = (a) => a.reduce((x, y) => x + y, 0);
export function deriveRound(cells) {
  const rows = [0, 1, 2, 3, 4].map((i) => cells.slice(i * 5, i * 5 + 5));
  const rowSums = rows.map(sumOf);
  const rowAway = rows.map((r) => r.filter((n) => AWAY_DIGITS.has(n)).length);
  const total = sumOf(cells);
  const awayCount = cells.filter((n) => AWAY_DIGITS.has(n)).length;
  const highCount = cells.filter((n) => HIGH_DIGITS.has(n)).length;
  return {
    cells, rows, rowSums, rowAway, total,
    awayCount, homeCount: 25 - awayCount,
    highCount, lowCount: 25 - highCount,
  };
}

// 赔率配置表（逐位照抄前端）：二元 1.95 / 段位边 8.0 / 段位中 2.5。
export const ODDS = { main: 1.95, edge: 8.0, mid: 2.5 };

// 盘区判定表（逐位照抄前端）：42 键 = 12 普通盘 + 5×6 行式。hit = 赢，无 push 项。
export const MARKETS = {
  big: { odds: ODDS.main, hit: (r) => r.total >= 113 },
  small: { odds: ODDS.main, hit: (r) => r.total <= 112 },
  odd: { odds: ODDS.main, hit: (r) => r.total % 2 === 1 },
  even: { odds: ODDS.main, hit: (r) => r.total % 2 === 0 },
  'home-more': { odds: ODDS.main, hit: (r) => r.homeCount >= 13 },
  'away-more': { odds: ODDS.main, hit: (r) => r.awayCount >= 13 },
  high: { odds: ODDS.main, hit: (r) => r.highCount >= 13 },
  low: { odds: ODDS.main, hit: (r) => r.lowCount >= 13 },
  'zone-releg': { odds: ODDS.edge, hit: (r) => r.total <= 95 },
  'zone-mid': { odds: ODDS.mid, hit: (r) => r.total >= 96 && r.total <= 112 },
  'zone-euro': { odds: ODDS.mid, hit: (r) => r.total >= 113 && r.total <= 129 },
  'zone-champ': { odds: ODDS.edge, hit: (r) => r.total >= 130 },
};
for (let i = 0; i < 5; i++) {
  MARKETS[`L${i + 1}-big`] = { odds: ODDS.main, hit: (r) => r.rowSums[i] >= 23 };
  MARKETS[`L${i + 1}-small`] = { odds: ODDS.main, hit: (r) => r.rowSums[i] <= 22 };
  MARKETS[`L${i + 1}-odd`] = { odds: ODDS.main, hit: (r) => r.rowSums[i] % 2 === 1 };
  MARKETS[`L${i + 1}-even`] = { odds: ODDS.main, hit: (r) => r.rowSums[i] % 2 === 0 };
  MARKETS[`L${i + 1}-home`] = { odds: ODDS.main, hit: (r) => r.rowAway[i] <= 2 };
  MARKETS[`L${i + 1}-away`] = { odds: ODDS.main, hit: (r) => r.rowAway[i] >= 3 };
}
const MARKET_KEYS = Object.keys(MARKETS);

/** 给定派生结果 r，返回命中的盘口 key 集合。 */
export function hitsOf(r) {
  return new Set(MARKET_KEYS.filter((k) => MARKETS[k].hit(r)));
}

/** 合法盘口 key 校验。 */
export function isValidMarketKey(key) {
  return Object.prototype.hasOwnProperty.call(MARKETS, key);
}

// LineUp 无 push 项（二元盘 25/5 奇数计数无平局、225/45 奇数和值无中点格 → 精确互补）。
export const HAS_PUSH = false;

/** 通用轮次 handler 接口：开奖 + 派生 + 命中。返回 { drawResult, hits:Set, pushes:Set }。 */
export function spin(rng) {
  const cells = drawGrid(rng);
  const r = deriveRound(cells);
  return { drawResult: { grid: cells, rowSums: r.rowSums, total: r.total }, hits: hitsOf(r), pushes: new Set() };
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
