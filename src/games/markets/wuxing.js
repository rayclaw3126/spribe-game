// #41 单3：WuXing 引擎常量块（ODDS/MARKETS/hitsOf 等纯数据纯函数，零 React 依赖）——
// 从 src/games/WuXing.jsx 顶部机械剪切至此（赔率单一数据源，多桌 UI 直读本文件的 MARKETS[key].odds）。
// 原 .jsx import 回用 + re-export 保外部引用；window.__XX 对账钩子随本模块加载挂载。数值/逻辑零改。
// ---------- 引擎（纯函数区，禁副作用）----------
// 开奖：80 池部分 Fisher-Yates 无放回抽 20；rng 可注入
export function drawKeno(rng = Math.random) {
  const pool = Array.from({ length: 80 }, (_, i) => i + 1)
  for (let k = 0; k < 20; k++) {
    const j = k + Math.floor(rng() * (80 - k))
    ;[pool[k], pool[j]] = [pool[j], pool[k]]
  }
  return pool.slice(0, 20)
}

// 派生：总和/上盘计数/龙（和值十位）/虎（和值个位）——结算判定只读这一份
export function deriveRound(balls) {
  const sum = balls.reduce((x, y) => x + y, 0)
  return {
    balls: [...balls].sort((a, b) => a - b),
    sum,
    up: balls.filter(n => n <= 40).length,
    dragon: Math.floor(sum / 10) % 10,
    tiger: sum % 10,
  }
}

// 赔率常量表 — 集中一处（单据定稿 2026-07-06；概率 = 1e7 大样本 scratchpad/wx-sim.mjs）：
//   大 .4979×1.95=97.09% / 小 .5021×1.92=96.41%（中心 810 归小侧，降档回带）
//   单双 ≈.5000×1.95=97.50% 带沿
//   龙/虎 .4499×2.13=95.83% / 龙虎和 .1001×9.55=95.61%（三向盘和局判输）
//   上/下 .3985×2.40=95.6% / 上下和 .2033×4.70=95.55%
//   过关四键 .248-.252×3.82=94.7-96.2%
//   五行 金 .1022×9.35=95.60% / 木 .2018×4.72=95.25% / 水 .3880×2.46=95.45% /
//        火 .2034×4.72=96.03% / 土 .1045×9.10=95.09% —— 19 键全数入 94-97.5% 带
export const ODDS = {
  main: 1.95, small: 1.92, dt: 2.13, dtTie: 9.55, ud: 2.4, udTie: 4.7, parlay: 3.82,
  wxGold: 9.35, wxMid: 4.72, wxWater: 2.46, wxEarth: 9.1,
}

// 盘区判定表 — 数据驱动生成（19 键）；hit = 赢，无 push 项（三向盘和局判输）
export const MARKETS = {
  big: { odds: ODDS.main, hit: r => r.sum >= 811 },
  small: { odds: ODDS.small, hit: r => r.sum <= 810 },
  odd: { odds: ODDS.main, hit: r => r.sum % 2 === 1 },
  even: { odds: ODDS.main, hit: r => r.sum % 2 === 0 },
  dragon: { odds: ODDS.dt, hit: r => r.dragon > r.tiger },
  'dt-tie': { odds: ODDS.dtTie, hit: r => r.dragon === r.tiger },
  tiger: { odds: ODDS.dt, hit: r => r.tiger > r.dragon },
  up: { odds: ODDS.ud, hit: r => r.up > 10 },
  'ud-tie': { odds: ODDS.udTie, hit: r => r.up === 10 },
  down: { odds: ODDS.ud, hit: r => r.up < 10 },
  'big-odd': { odds: ODDS.parlay, hit: r => r.sum >= 811 && r.sum % 2 === 1 },
  'small-odd': { odds: ODDS.parlay, hit: r => r.sum <= 810 && r.sum % 2 === 1 },
  'big-even': { odds: ODDS.parlay, hit: r => r.sum >= 811 && r.sum % 2 === 0 },
  'small-even': { odds: ODDS.parlay, hit: r => r.sum <= 810 && r.sum % 2 === 0 },
  'wx-gold': { odds: ODDS.wxGold, hit: r => r.sum <= 695 },
  'wx-wood': { odds: ODDS.wxMid, hit: r => r.sum >= 696 && r.sum <= 763 },
  'wx-water': { odds: ODDS.wxWater, hit: r => r.sum >= 764 && r.sum <= 855 },
  'wx-fire': { odds: ODDS.wxMid, hit: r => r.sum >= 856 && r.sum <= 923 },
  'wx-earth': { odds: ODDS.wxEarth, hit: r => r.sum >= 924 },
}
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

export const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账/RTP 模拟从浏览器直接调引擎；__WX_FORCE 注入固定局（20 球数组）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__WX = { drawKeno, deriveRound, hitsOf, MARKETS, ODDS }
}
