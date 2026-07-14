// #41 单3：SpeedGrid 引擎常量块（ODDS/MARKETS/hitsOf 等纯数据纯函数，零 React 依赖）——
// 从 src/games/SpeedGrid.jsx 顶部机械剪切至此（赔率单一数据源，多桌 UI 直读本文件的 MARKETS[key].odds）。
// 原 .jsx import 回用 + re-export 保外部引用；window.__XX 对账钩子随本模块加载挂载。数值/逻辑零改。
// ---------- 引擎（纯函数区，禁副作用）----------
// 红黑归类（DD24 官方规则页转录）：
//   红 = {1,3,6,8,9,11,14,16,17,19,22,24}（12 个）；黑 = 其余 12 个
export const RED = new Set([1, 3, 6, 8, 9, 11, 14, 16, 17, 19, 22, 24])

// 开奖：1-24 均匀抽 1（单随机数）；rng 可注入
export function drawCar(rng = Math.random) {
  return 1 + Math.floor(rng() * 24)
}

// 赔率常量表 — 集中一处（24 局全空间精确枚举，见 scratchpad/sg-exact.mjs）：
//   大小/单双/红黑：p = 12/24 = 0.5 → 1.95 × 0.5 = 97.50%（带上沿）
//   三段（第1/2/3个8）：p = 8/24 = 1/3 → 2.90 / 3 = 96.67%
//   车号直选：p = 1/24 → 22.85 / 24 = 95.21%
//   车队（每队 6 车）：p = 6/24 = 0.25 → 3.85 × 0.25 = 96.25%（同 DD12 四色盘定价）
export const ODDS = { main: 1.95, section: 2.9, pick: 22.85, team: 3.85 }

// 盘区判定表 — 数据驱动生成（13 盘口键 + 24 直选键）；hit = 赢，无 push 项
export const MARKETS = {
  big: { odds: ODDS.main, hit: n => n >= 13 },
  small: { odds: ODDS.main, hit: n => n <= 12 },
  odd: { odds: ODDS.main, hit: n => n % 2 === 1 },
  even: { odds: ODDS.main, hit: n => n % 2 === 0 },
  red: { odds: ODDS.main, hit: n => RED.has(n) },
  black: { odds: ODDS.main, hit: n => !RED.has(n) },
  'grid-front': { odds: ODDS.section, hit: n => n <= 8 },
  'grid-mid': { odds: ODDS.section, hit: n => n >= 9 && n <= 16 },
  'grid-rear': { odds: ODDS.section, hit: n => n >= 17 },
}
for (let t = 1; t <= 4; t++) {
  MARKETS[`team-${t}`] = { odds: ODDS.team, hit: n => Math.ceil(n / 6) === t }
}
for (let c = 1; c <= 24; c++) {
  MARKETS[`car-${c}`] = { odds: ODDS.pick, hit: n => n === c }
}
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = n => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(n)))

export const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账/RTP 模拟从浏览器直接调引擎；__SG_FORCE 注入固定局
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__SG = { drawCar, hitsOf, MARKETS, ODDS, RED }
}
