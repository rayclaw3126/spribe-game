// Number Up（两位数球衣号码彩 00–49）可验证公平引擎（纯函数，便于单测/对拍）。
// 原子轮次局：押盘口（直选/首位/尾位/大小单双）→ 0–49 均匀抽 1 → 逐盘口结算。
//
// ⚠️ 埋尸点铁律：drawNumber / deriveNum / ODDS / MARKETS 逐位照抄前端 src/games/NumberUp.jsx，
//    改一处必须改两处，一个数都别动别重算。
//
// 开奖不信前端：drawNumber(rng) 用注入的 seededRng（HMAC 派生 [0,1)）→ floor(rng()×50)。
// 52-bit uniform 使 floor(U×50) 偏差 ≈ 1e-14（可忽略），无需拒绝采样。
import crypto from 'crypto';

const pad2 = (n) => String(n).padStart(2, '0');

/** 开奖：0–49 均匀抽 1。rng 由 makeSeededRng 注入。 */
export function drawNumber(rng) {
  return Math.floor(rng() * 50);
}

// 派生：头位(0–4) / 尾位(0–9) / 大小(分界 25：LOW 00–24 / HIGH 25–49) / 单双(num 奇偶)。逐位照抄前端。
export function deriveNum(num) {
  return { num, first: Math.floor(num / 10), last: num % 10, high: num >= 25, odd: num % 2 === 1 };
}

// 赔率配置表（逐位照抄前端）：直选 47.50 / 首位 4.75 / 尾位 9.50 / 大小单双 1.91。
export const ODDS = { pick: 47.5, firstDigit: 4.75, lastDigit: 9.5, side: 1.91 };

// 盘区判定表 — 数据驱动生成（69 键：直选 50 + 首位 5 + 尾位 10 + 大小单双 4）。逐位照抄前端。
export const MARKETS = (() => {
  const m = {};
  for (let n = 0; n < 50; n++) m[`n-${pad2(n)}`] = { odds: ODDS.pick, hit: (r) => r.num === n };
  for (let d = 0; d <= 4; d++) m[`fd-${d}`] = { odds: ODDS.firstDigit, hit: (r) => r.first === d };
  for (let d = 0; d <= 9; d++) m[`ld-${d}`] = { odds: ODDS.lastDigit, hit: (r) => r.last === d };
  m['s-high'] = { odds: ODDS.side, hit: (r) => r.high };
  m['s-low'] = { odds: ODDS.side, hit: (r) => !r.high };
  m['s-odd'] = { odds: ODDS.side, hit: (r) => r.odd };
  m['s-even'] = { odds: ODDS.side, hit: (r) => !r.odd };
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

// NumberUp 无 push 项（各组划分对 0–49 无重叠无空隙）。
export const HAS_PUSH = false;

/** 通用轮次 handler 接口：开奖 + 派生 + 命中。返回 { drawResult, hits:Set, pushes:Set }。 */
export function spin(rng) {
  const num = drawNumber(rng);
  const r = deriveNum(num);
  return { drawResult: { num }, hits: hitsOf(r), pushes: new Set() };
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
