// #41 单3：LineUp 引擎常量块（ODDS/MARKETS/hitsOf 等纯数据纯函数，零 React 依赖）——
// 从 src/games/LineUp.jsx 顶部机械剪切至此（赔率单一数据源，多桌 UI 直读本文件的 MARKETS[key].odds）。
// 原 .jsx import 回用 + re-export 保外部引用；window.__XX 对账钩子随本模块加载挂载。数值/逻辑零改。
// ---------- 引擎（纯函数区，禁副作用）----------
// 归类表（参考原文映射）：红牌 = Red(0,2,6,7,8)；黄牌 = Black(1,3,4,5,9)；高 = 5-9 / 低 = 0-4
// （键名沿用 away=红/home=黄 的 X1 命名，显示层 X6 起走红黄牌皮）
export const AWAY_DIGITS = new Set([0, 2, 6, 7, 8])
export const HIGH_DIGITS = new Set([5, 6, 7, 8, 9])

// 开奖：25 个独立均匀 0-9（可重复），rng 可注入
export function drawGrid(rng = Math.random) {
  return Array.from({ length: 25 }, () => Math.floor(rng() * 10))
}

// 派生：行切分/行和/总和/红黄牌计数/高低计数（全部结算判定只读这一份）
const sumOf = a => a.reduce((x, y) => x + y, 0)
export function deriveRound(cells) {
  const rows = [0, 1, 2, 3, 4].map(i => cells.slice(i * 5, i * 5 + 5))
  const rowSums = rows.map(sumOf)
  const rowAway = rows.map(r => r.filter(n => AWAY_DIGITS.has(n)).length)
  const total = sumOf(cells)
  const awayCount = cells.filter(n => AWAY_DIGITS.has(n)).length
  const highCount = cells.filter(n => HIGH_DIGITS.has(n)).length
  return {
    cells, rows, rowSums, rowAway, total,
    awayCount, homeCount: 25 - awayCount,
    highCount, lowCount: 25 - highCount,
  }
}

// 赔率常量表 — 集中一处（推导注释，BigInt 精确枚举对账 scratchpad/lineup-exact.mjs）：
//   二元盘（大小/单双/红黄牌/高低 + 行式全部）：真实概率精确 = 0.5 ——
//     和值分布关于 112.5（行 22.5）对称且 225/45 为奇数无中点质量；
//     计数盘每格恰好 5/5 数字二分、25/5 为奇数无平局 ⇒ 1.95 × 0.5 = 97.5%（带上沿）。
//   段位盘（单据定稿 2026-07-05）：精确概率 降级/夺冠 0.118991、中游/欧战 0.381009；
//     参考原版 7.50/2.30 → RTP 89.24%/87.63% 出带，按单调整为 8.00/2.50 →
//     RTP 95.19% / 95.25%，进 94-97.5% 带。
export const ODDS = { main: 1.95, edge: 8.0, mid: 2.5 }

// 盘区判定表 — 数据驱动生成（12 普通盘键 + 5×6 行式键）；hit = 赢，无 push 项
export const MARKETS = {
  big: { odds: ODDS.main, hit: r => r.total >= 113 },
  small: { odds: ODDS.main, hit: r => r.total <= 112 },
  odd: { odds: ODDS.main, hit: r => r.total % 2 === 1 },
  even: { odds: ODDS.main, hit: r => r.total % 2 === 0 },
  'home-more': { odds: ODDS.main, hit: r => r.homeCount >= 13 },
  'away-more': { odds: ODDS.main, hit: r => r.awayCount >= 13 },
  high: { odds: ODDS.main, hit: r => r.highCount >= 13 },
  low: { odds: ODDS.main, hit: r => r.lowCount >= 13 },
  'zone-releg': { odds: ODDS.edge, hit: r => r.total <= 95 },
  'zone-mid': { odds: ODDS.mid, hit: r => r.total >= 96 && r.total <= 112 },
  'zone-euro': { odds: ODDS.mid, hit: r => r.total >= 113 && r.total <= 129 },
  'zone-champ': { odds: ODDS.edge, hit: r => r.total >= 130 },
}
for (let i = 0; i < 5; i++) {
  MARKETS[`L${i + 1}-big`] = { odds: ODDS.main, hit: r => r.rowSums[i] >= 23 }
  MARKETS[`L${i + 1}-small`] = { odds: ODDS.main, hit: r => r.rowSums[i] <= 22 }
  MARKETS[`L${i + 1}-odd`] = { odds: ODDS.main, hit: r => r.rowSums[i] % 2 === 1 }
  MARKETS[`L${i + 1}-even`] = { odds: ODDS.main, hit: r => r.rowSums[i] % 2 === 0 }
  MARKETS[`L${i + 1}-home`] = { odds: ODDS.main, hit: r => r.rowAway[i] <= 2 }
  MARKETS[`L${i + 1}-away`] = { odds: ODDS.main, hit: r => r.rowAway[i] >= 3 }
}
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

export const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器直接调引擎；__LU_FORCE 注入固定局
// （下一期开奖直接用注入的 25 数，一次性消费；生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__LU = { drawGrid, deriveRound, hitsOf, MARKETS, ODDS }
}
