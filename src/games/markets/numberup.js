// #41 单3：NumberUp 引擎常量块（ODDS/MARKETS/hitsOf 等纯数据纯函数，零 React 依赖）——
// 从 src/games/NumberUp.jsx 顶部机械剪切至此（赔率单一数据源，多桌 UI 直读本文件的 MARKETS[key].odds）。
// 原 .jsx import 回用 + re-export 保外部引用；window.__XX 对账钩子随本模块加载挂载。数值/逻辑零改。
export const pad2 = n => String(n).padStart(2, '0')

// ---------- 引擎（纯函数区，禁副作用）----------
// 0–49 均匀抽一个；rng 可注入（对账/模拟用）
export function drawNumber(rng = Math.random) {
  return Math.floor(rng() * 50)
}

// 派生：头位(0–4) / 尾位(0–9) / 大小(分界 25：LOW 00–24 / HIGH 25–49) / 单双(num 奇偶)
export function deriveNum(num) {
  return { num, first: Math.floor(num / 10), last: num % 10, high: num >= 25, odd: num % 2 === 1 }
}

// 赔率配置表（0–49 均匀分布，全部精确可算 + 1e6 蒙特卡洛双验，全键 94–97.5%）：
//   直选   47.50 × P=1/50 → RTP 95.0% 精确（池 00–49 共 50 值）
//   首位   4.75  × P=1/5  → RTP 95.0% 精确（首位 0–4 共 5 值，各覆盖 10 号）
//   尾位   9.50  × P=1/10 → RTP 95.0% 精确（尾位 0–9 共 10 值，各覆盖 5 号）
//   HIGH/LOW/ODD/EVEN 1.91 × P=1/2 → RTP 95.5% 精确（各 25 值均分）
export const ODDS = { pick: 47.5, firstDigit: 4.75, lastDigit: 9.5, side: 1.91 }

// 盘区判定表 — 数据驱动生成（69 键：直选 50 + 首位 5 + 尾位 10 + 大小单双 4），settle/珠盘路/RTP 模拟共用
export const MARKETS = (() => {
  const m = {}
  for (let n = 0; n < 50; n++) m[`n-${pad2(n)}`] = { odds: ODDS.pick, hit: r => r.num === n }
  for (let d = 0; d <= 4; d++) m[`fd-${d}`] = { odds: ODDS.firstDigit, hit: r => r.first === d }   // 首位 0–4
  for (let d = 0; d <= 9; d++) m[`ld-${d}`] = { odds: ODDS.lastDigit, hit: r => r.last === d }      // 尾位 0–9
  m['s-high'] = { odds: ODDS.side, hit: r => r.high }
  m['s-low']  = { odds: ODDS.side, hit: r => !r.high }
  m['s-odd']  = { odds: ODDS.side, hit: r => r.odd }
  m['s-even'] = { odds: ODDS.side, hit: r => !r.odd }
  return m
})()
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

export const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器直接调引擎（生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__NU = { drawNumber, deriveNum, hitsOf, MARKETS, ODDS }
}
