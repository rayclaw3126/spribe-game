// #41 单3：HalfTime 引擎常量块（ODDS/MARKETS/hitsOf 等纯数据纯函数，零 React 依赖）——
// 从 src/games/HalfTime.jsx 顶部机械剪切至此（赔率单一数据源，多桌 UI 直读本文件的 MARKETS[key].odds）。
// 原 .jsx import 回用 + re-export 保外部引用；window.__XX 对账钩子随本模块加载挂载。数值/逻辑零改。
// ---------- 引擎（纯函数区，禁副作用）----------
// Fisher-Yates 洗满池取前 20，保留开出顺序；rng 可注入（对账/模拟用）
export function drawRound(rng = Math.random) {
  const pool = Array.from({ length: 80 }, (_, i) => i + 1)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, 20)
}

// 派生：总和 + 半场计数。半场盘语义 = 20 球中落在 1–40 区间的个数：
// >10 → 1ST HALF，<10 → 2ND HALF，=10 → DRAW。
// （旧版「前10和 vs 后10和」派生已废弃删除 — 开出顺序仅保留在 balls 展示）
export function deriveRound(balls) {
  const sum = balls.reduce((a, b) => a + b, 0)
  const lowCount = balls.filter(n => n <= 40).length
  return { balls, sum, lowCount }
}

export const halfOf = r => (r.lowCount > 10 ? 'F' : r.lowCount < 10 ? 'S' : 'D')

// 赔率配置表（1e6 期模拟标定，目标带 94–97.5%，实测见修正单 RTP 报告）。
// 推导注记：和值分布对称于 810（x↔81−x 双射），σ≈51.4；
//   over  1.95 × P≈.4979 → 97.1%（≥811）
//   under 1.90 × P≈.5021 → 95.4%（810 中点质量归 under，故比 over 低一档）
//   odd/even 1.95 × P=.500 精确 → 97.5% 压线
//   parlay 3.80 × P≈.25（大小×奇偶近独立）→ ≈95%
//   zone：og/gl 9.25 × P≈.103 → ≈95/96；df/at 4.70 × P≈.202 → ≈95；
//         mf 2.46 × P≈.388 → ≈95.5
//   half：X = 20 球中 1–40 区个数 ~ 超几何(N=80,K=40,n=20)，
//         精确 P(X=10)=0.20324（众数）、P(X>10)=P(X<10)=0.39838；
//         h1/h2 2.40 × .3984 → 95.6%，draw 4.70 × .2032 → 95.5%
export const ODDS = {
  over: 1.95, under: 1.90,
  odd: 1.95, even: 1.95,
  'p-oo': 3.8, 'p-oe': 3.8, 'p-uo': 3.8, 'p-ue': 3.8,
  og: 9.25, df: 4.7, mf: 2.46, at: 4.7, gl: 9.25,
  h1: 2.4, draw: 4.7, h2: 2.4,
}

// 盘区判定表 — 数据驱动，settle/珠盘路/RTP 模拟共用这一份
export const MARKETS = {
  over:  { odds: ODDS.over,   hit: r => r.sum >= 811 },
  under: { odds: ODDS.under,  hit: r => r.sum <= 810 },
  odd:   { odds: ODDS.odd,    hit: r => r.sum % 2 === 1 },
  even:  { odds: ODDS.even,   hit: r => r.sum % 2 === 0 },
  'p-oo': { odds: ODDS['p-oo'], hit: r => r.sum >= 811 && r.sum % 2 === 1 },
  'p-oe': { odds: ODDS['p-oe'], hit: r => r.sum >= 811 && r.sum % 2 === 0 },
  'p-uo': { odds: ODDS['p-uo'], hit: r => r.sum <= 810 && r.sum % 2 === 1 },
  'p-ue': { odds: ODDS['p-ue'], hit: r => r.sum <= 810 && r.sum % 2 === 0 },
  og: { odds: ODDS.og, hit: r => r.sum <= 695 },
  df: { odds: ODDS.df, hit: r => r.sum >= 696 && r.sum <= 763 },
  mf: { odds: ODDS.mf, hit: r => r.sum >= 764 && r.sum <= 855 },
  at: { odds: ODDS.at, hit: r => r.sum >= 856 && r.sum <= 923 },
  gl: { odds: ODDS.gl, hit: r => r.sum >= 924 },
  h1:   { odds: ODDS.h1,   hit: r => r.lowCount > 10 },    // 1–40 区多
  draw: { odds: ODDS.draw, hit: r => r.lowCount === 10 },  // 恰 10 / 10
  h2:   { odds: ODDS.h2,   hit: r => r.lowCount < 10 },    // 41–80 区多
}
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

export const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器里直接调引擎（生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__HT = { drawRound, deriveRound, halfOf, hitsOf, MARKETS, ODDS }
}
