// #41 单3：GoldenBoot 引擎常量块（ODDS/MARKETS/hitsOf 等纯数据纯函数，零 React 依赖）——
// 从 src/games/GoldenBoot.jsx 顶部机械剪切至此（赔率单一数据源，多桌 UI 直读本文件的 MARKETS[key].odds）。
// 原 .jsx import 回用 + re-export 保外部引用；window.__XX 对账钩子随本模块加载挂载。数值/逻辑零改。
// ---------- 引擎（纯函数区，禁副作用）----------
// Fisher-Yates 全洗 1–10，返回按名次排的球员号（order[0] = 冠军）；rng 可注入
export function drawRace(rng = Math.random) {
  const order = Array.from({ length: 10 }, (_, i) => i + 1)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

// 派生：冠军 / 亚军 / 冠亚和 / 名次映射
export function deriveRace(order) {
  const winner = order[0]
  const runnerUp = order[1]
  const sprintSum = winner + runnerUp
  const rank = {}
  order.forEach((n, i) => { rank[n] = i + 1 })
  return { order, winner, runnerUp, sprintSum, rank }
}

// 赔率配置表（推导注记；1e6 模拟实测见单3 报告，出带列只报不改）：
//   WINNER：P = 1/10 精确 → 9.60 × 0.1 = 96.0%
//   SUM 直选：90 个有序 (冠,亚) 对等概率；和值 s 的无序对数 n(s)：
//     3,4,18,19→1 · 5,6,16,17→2 · 7,8,14,15→3 · 9,10,12,13→4 · 11→5
//     P(s) = n(s)/45；赔率 = 0.955 × 45 / n(s)（构造性 RTP≈95.5%）
//   BIG 12–19：n 合计 20/45 → 2.15 × .4444 = 95.6%；SMALL 3–11：25/45 → 1.72 × .5556 = 95.6%
//   ODD 和为单（一奇一偶 50/90 = 25/45）→ 1.72 → 95.6%；EVEN 20/45 → 2.15 → 95.6%
export const SUM_N = { 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3, 9: 4, 10: 4, 11: 5, 12: 4, 13: 4, 14: 3, 15: 3, 16: 2, 17: 2, 18: 1, 19: 1 }
const sumOdds = s => Math.round((0.955 * 45 / SUM_N[s]) * 100) / 100   // 42.98/21.49/14.33/10.74/8.60
export const ODDS = {
  winner: 9.6,
  sum: Object.fromEntries(Object.keys(SUM_N).map(s => [s, sumOdds(+s)])),
  big: 2.15, small: 1.72, odd: 1.72, even: 2.15,
}

// 盘区判定表 — 数据驱动生成（settle/珠盘路/RTP 模拟共用），零散落 if
export const MARKETS = (() => {
  const m = {}
  for (let n = 1; n <= 10; n++) m[`w-${n}`] = { odds: ODDS.winner, hit: r => r.winner === n }
  for (const s of Object.keys(SUM_N).map(Number)) m[`sum-${s}`] = { odds: ODDS.sum[s], hit: r => r.sprintSum === s }
  m['s-big']   = { odds: ODDS.big,   hit: r => r.sprintSum >= 12 }
  m['s-small'] = { odds: ODDS.small, hit: r => r.sprintSum <= 11 }
  m['s-odd']   = { odds: ODDS.odd,   hit: r => r.sprintSum % 2 === 1 }
  m['s-even']  = { odds: ODDS.even,  hit: r => r.sprintSum % 2 === 0 }
  return m
})()
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

export const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器直接调引擎（生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__GB = { drawRace, deriveRace, hitsOf, MARKETS, ODDS }
}
