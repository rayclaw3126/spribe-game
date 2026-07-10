// Domino Duel（骨牌版主客对决 · 主蓝客红）可验证公平引擎（纯函数，便于单测/对拍）。
// 原子轮次局：押盘口（主客胜负/大小单双/波胆比分）→ 28 张骨牌无放回抽 4（主 2 客 2）→ 逐盘口结算（含 push 退注）。
//
// ⚠️ 埋尸点铁律：DOMINOES / rollTiles / deriveRound / ODDS / CS_ODDS / MARKETS 逐位照抄前端
//    src/games/DominoDuel.jsx，改一处必须改两处，一个数都别动别重算。
//
// ⚠️ 波胆 CS_ODDS（高赔低频，最易错）：9 个热门比分逐位照抄，别自己算赔率。
// ⚠️ 得分派生：hs = (主 2 张端点和) mod 10、as = (客 2 张端点和) mod 10（0-9）；gTotal = hs+as（0-18 非 mod）。
//
// push（平局退注）：主胜/客胜盘 hs==as → push（退本金，不算赢不算输），吃通用 handler 已验 push 分支。
//    push 与 hit 互斥（平局时 home-win/away-win hit 必假）。
//
// 开奖不信前端：rollTiles(rng) 用注入的 seededRng（HMAC 派生 [0,1)），部分 FY 28→4（4 次 rng），
//    seededRng 的 counter 续熵支持。52-bit floor 偏差可忽略。
import crypto from 'crypto';

// 标准 28 张多米诺（0-0 到 6-6）。逐位照抄前端。
const DOMINOES = (() => { const t = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push([a, b]); return t; })();

// 无放回抽 4：前 2 张主队、后 2 张客队。rng 由 makeSeededRng 注入。逐位照抄前端。
export function rollTiles(rng) {
  const p = DOMINOES.slice();
  for (let k = 0; k < 4; k++) { const j = k + Math.floor(rng() * (p.length - k)); [p[k], p[j]] = [p[j], p[k]]; }
  return [p[0], p[1], p[2], p[3]];
}

// 结算派生：主客各 2 张 → 得分（端点和 mod10）+ 合计进球。逐位照抄前端。
export function deriveRound(tiles) {
  const s = (t) => t[0] + t[1];
  const hs = (s(tiles[0]) + s(tiles[1])) % 10;
  const as = (s(tiles[2]) + s(tiles[3])) % 10;
  return { tiles, homeTiles: [tiles[0], tiles[1]], awayTiles: [tiles[2], tiles[3]], hs, as, gTotal: hs + as };
}

// 赔率配置表（逐位照抄前端）。
export const ODDS = {
  main: 1.90, draw: 9.38,
  gBig: 1.74, gSmall: 2.11, gOdd: 1.91, gEven: 1.91,
  tBig: 1.92, tSmall: 1.90, tOdd: 1.88, tEven: 1.94,
};
// 波胆 9 键赔率（埋尸点·逐位照抄，高赔低频）。
const CS_ODDS = { '1-0': 94.69, '2-1': 92.23, '3-1': 90.32, '0-0': 97.93, '1-1': 88.08, '2-2': 92.67, '0-1': 94.69, '1-2': 92.23, '1-3': 90.32 };

// 盘区判定表（逐位照抄前端）：16 常规 + 9 波胆 = 25 键。hit = 赢；push = 退注（仅主/客胜盘平局）。
export const MARKETS = {
  'home-win': { odds: ODDS.main, hit: (r) => r.hs > r.as, push: (r) => r.hs === r.as },
  'away-win': { odds: ODDS.main, hit: (r) => r.as > r.hs, push: (r) => r.hs === r.as },
  'draw': { odds: ODDS.draw, hit: (r) => r.hs === r.as },
  'g-big': { odds: ODDS.gBig, hit: (r) => r.gTotal >= 9 },
  'g-small': { odds: ODDS.gSmall, hit: (r) => r.gTotal <= 8 },
  'g-odd': { odds: ODDS.gOdd, hit: (r) => r.gTotal % 2 === 1 },
  'g-even': { odds: ODDS.gEven, hit: (r) => r.gTotal % 2 === 0 },
  'h-big': { odds: ODDS.tBig, hit: (r) => r.hs >= 5 },
  'h-small': { odds: ODDS.tSmall, hit: (r) => r.hs <= 4 },
  'h-odd': { odds: ODDS.tOdd, hit: (r) => r.hs % 2 === 1 },
  'h-even': { odds: ODDS.tEven, hit: (r) => r.hs % 2 === 0 },
  'a-big': { odds: ODDS.tBig, hit: (r) => r.as >= 5 },
  'a-small': { odds: ODDS.tSmall, hit: (r) => r.as <= 4 },
  'a-odd': { odds: ODDS.tOdd, hit: (r) => r.as % 2 === 1 },
  'a-even': { odds: ODDS.tEven, hit: (r) => r.as % 2 === 0 },
};
// 波胆 9 键：cs-H-A hit if hs===H && as===A。逐位照抄前端。
Object.entries(CS_ODDS).forEach(([sc, o]) => {
  const [H, A] = sc.split('-').map(Number);
  MARKETS[`cs-${sc}`] = { odds: o, hit: (r) => r.hs === H && r.as === A };
});
const MARKET_KEYS = Object.keys(MARKETS);

/** 给定派生结果 r，返回命中的盘口 key 集合。 */
export function hitsOf(r) {
  return new Set(MARKET_KEYS.filter((k) => MARKETS[k].hit(r)));
}

/** 给定派生结果 r，返回 push（退注）的盘口 key 集合（仅主/客胜盘平局）。 */
export function pushesOf(r) {
  return new Set(MARKET_KEYS.filter((k) => MARKETS[k].push?.(r)));
}

/** 合法盘口 key 校验。 */
export function isValidMarketKey(key) {
  return Object.prototype.hasOwnProperty.call(MARKETS, key);
}

// DominoDuel 【有 push】：主/客胜盘平局退注。通用 handler push 分支靠此（吃 DerbyDay 已验路径）。
export const HAS_PUSH = true;

/** 通用轮次 handler 接口：开奖 + 派生 + 命中 + 退注。返回 { drawResult, hits:Set, pushes:Set }。 */
export function spin(rng) {
  const tiles = rollTiles(rng);
  const r = deriveRound(tiles);
  return {
    drawResult: { tiles, homeTiles: r.homeTiles, awayTiles: r.awayTiles, hs: r.hs, as: r.as, gTotal: r.gTotal },
    hits: hitsOf(r),
    pushes: pushesOf(r),
  };
}

// 导出 DOMINOES 供对拍全枚举复用（不改判定，只读）。
export { DOMINOES, CS_ODDS };

export function hashSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}
export function newServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}
export function newClientSeed() {
  return crypto.randomBytes(8).toString('hex');
}
