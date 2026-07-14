// #41 单3：DominoDuel 引擎常量块（ODDS/MARKETS/hitsOf 等纯数据纯函数，零 React 依赖）——
// 从 src/games/DominoDuel.jsx 顶部机械剪切至此（赔率单一数据源，多桌 UI 直读本文件的 MARKETS[key].odds）。
// 原 .jsx import 回用 + re-export 保外部引用；window.__XX 对账钩子随本模块加载挂载。数值/逻辑零改。
export const round2 = x => Math.round(x * 100) / 100

// ---------- 引擎（纯函数区，禁副作用）----------
// 标准 28 张多米诺（0-0 到 6-6）
const DOMINOES = (() => { const t = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push([a, b]); return t })()

// 无放回抽 4：前 2 张主队、后 2 张客队；rng 可注入
export function rollTiles(rng = Math.random) {
  const p = DOMINOES.slice()
  for (let k = 0; k < 4; k++) { const j = k + Math.floor(rng() * (p.length - k));[p[k], p[j]] = [p[j], p[k]] }
  return [p[0], p[1], p[2], p[3]]
}
// 结算派生：主客各 2 张 → 得分(和 mod10) + 合计进球
export function deriveRound(tiles) {
  const s = t => t[0] + t[1]
  const hs = (s(tiles[0]) + s(tiles[1])) % 10
  const as = (s(tiles[2]) + s(tiles[3])) % 10
  return { tiles, homeTiles: [tiles[0], tiles[1]], awayTiles: [tiles[2], tiles[3]], hs, as, gTotal: hs + as }
}

// ---------- 赔率（1e6 模拟 + 122850 等概枚举双验，anchor 0.955，全键 94-97.5%）----------
// 普通盘 odds = round2(0.955 / P)；push 盘（主胜/客胜）odds = round2((0.955 − P_push) / P_win)。
//   P 来源（精确枚举 C(28,2)×C(26,2)=122850 等概分派）：
//   主胜/客胜 P_win=0.44908 P_push(平)=0.10185 → (0.955-0.10185)/0.44908 = 1.90（EV 95.51%）
//   平局 P=0.10185 → 9.38；全场大 P=0.54737→1.74 / 小 0.45263→2.11 / 单 0.50012→1.91 / 双 0.49988→1.91
//   主客总分 大 0.49735→1.92 / 小 0.50265→1.90 / 单 0.50794→1.88 / 双 0.49206→1.94
//   波胆 P：1-0/0-1=0.01009→94.69, 2-1/1-2=0.01035→92.23, 3-1/1-3=0.01057→90.32,
//          0-0=0.00975→97.93, 1-1=0.01084→88.08, 2-2=0.01031→92.67
export const ODDS = {
  main: 1.90, draw: 9.38,
  gBig: 1.74, gSmall: 2.11, gOdd: 1.91, gEven: 1.91,
  tBig: 1.92, tSmall: 1.90, tOdd: 1.88, tEven: 1.94,
}
const CS_ODDS = { '1-0': 94.69, '2-1': 92.23, '3-1': 90.32, '0-0': 97.93, '1-1': 88.08, '2-2': 92.67, '0-1': 94.69, '1-2': 92.23, '1-3': 90.32 }

// 盘区判定表 — 数据驱动（hit = 赢；push = 退注，仅主胜/客胜盘平局）
export const MARKETS = {
  'home-win': { odds: ODDS.main, hit: r => r.hs > r.as, push: r => r.hs === r.as },
  'away-win': { odds: ODDS.main, hit: r => r.as > r.hs, push: r => r.hs === r.as },
  'draw':     { odds: ODDS.draw, hit: r => r.hs === r.as },
  'g-big':    { odds: ODDS.gBig,   hit: r => r.gTotal >= 9 },
  'g-small':  { odds: ODDS.gSmall, hit: r => r.gTotal <= 8 },
  'g-odd':    { odds: ODDS.gOdd,   hit: r => r.gTotal % 2 === 1 },
  'g-even':   { odds: ODDS.gEven,  hit: r => r.gTotal % 2 === 0 },
  'h-big':    { odds: ODDS.tBig,   hit: r => r.hs >= 5 },
  'h-small':  { odds: ODDS.tSmall, hit: r => r.hs <= 4 },
  'h-odd':    { odds: ODDS.tOdd,   hit: r => r.hs % 2 === 1 },
  'h-even':   { odds: ODDS.tEven,  hit: r => r.hs % 2 === 0 },
  'a-big':    { odds: ODDS.tBig,   hit: r => r.as >= 5 },
  'a-small':  { odds: ODDS.tSmall, hit: r => r.as <= 4 },
  'a-odd':    { odds: ODDS.tOdd,   hit: r => r.as % 2 === 1 },
  'a-even':   { odds: ODDS.tEven,  hit: r => r.as % 2 === 0 },
}
// 波胆 9 键：cs-H-A hit if hs===H && as===A
Object.entries(CS_ODDS).forEach(([sc, o]) => {
  const [H, A] = sc.split('-').map(Number)
  MARKETS[`cs-${sc}`] = { odds: o, hit: r => r.hs === H && r.as === A }
})
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))
export const pushesOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].push?.(r)))

// dev 钩子：RTP 模拟/对账从浏览器直接调（__DD 已被 Derby Day 占用 → 本卡用 __DOM）；
// __DOM_FORCE 注入固定 4 张骨牌（一次性消费）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__DOM = { rollTiles, deriveRound, hitsOf, pushesOf, MARKETS, ODDS, DOMINOES }
}
