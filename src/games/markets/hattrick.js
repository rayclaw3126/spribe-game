// #41 单3：HatTrick 引擎常量块（ODDS/MARKETS/hitsOf 等纯数据纯函数，零 React 依赖）——
// 从 src/games/HatTrick.jsx 顶部机械剪切至此（赔率单一数据源，多桌 UI 直读本文件的 MARKETS[key].odds）。
// 原 .jsx import 回用 + re-export 保外部引用；window.__XX 对账钩子随本模块加载挂载。数值/逻辑零改。
// ---------- 引擎（纯函数区，禁副作用）----------
// 三骰各 1–6 独立均匀；rng 可注入（对账/模拟用），三次调用顺序固定 d1→d2→d3
export function rollDice(rng = Math.random) {
  const d1 = 1 + Math.floor(rng() * 6)
  const d2 = 1 + Math.floor(rng() * 6)
  const d3 = 1 + Math.floor(rng() * 6)
  return [d1, d2, d3]
}

// 派生：和值(3–18) / 豹子 / 豹子面 / 对子面集合 / 大小(11–17 / 4–10) / 单双
// doubles 口径（行业惯例）：某面出现 ≥2 次即算该面对子——豹子含在指定对子内
export function deriveRoll(dice) {
  const total = dice[0] + dice[1] + dice[2]
  const isTriple = dice[0] === dice[1] && dice[1] === dice[2]
  const doubles = new Set()
  for (let v = 1; v <= 6; v++) {
    if ((dice[0] === v) + (dice[1] === v) + (dice[2] === v) >= 2) doubles.add(v)
  }
  return {
    dice, total, isTriple,
    tripleFace: isTriple ? dice[0] : null,
    doubles,
    big: total >= 11 && total <= 17,
    small: total >= 4 && total <= 10,
    odd: total % 2 === 1,
    even: total % 2 === 0,
  }
}

// 赔率配置表 — 216 全排列可数，逐格精确推导（目标带 94–97.5%，锚 95.5%）：
//   和值 s 的排列数 n(s)：4/17→3, 5/16→6, 6/15→10, 7/14→15, 8/13→21, 9/12→25, 10/11→27
//   和值直选 odds = 0.955×216/n(s)（round2）：
//     n=3→68.76 精确 95.50% | n=6→34.38 精确 95.50% | n=10→20.63 → 95.51%
//     n=15→13.75 → 95.49%  | n=21→9.82 → 95.46%    | n=25→8.25 → 95.49%
//     n=27→7.64 精确 95.50%
//   BIG/SMALL：和值 11–17（4–10）共 107 排列，扣本区豹子 2 个（12,15 / 6,9）
//     → P=105/216；ODD/EVEN 同理（单 108−3 豹 / 双 108−3 豹）→ P=105/216
//     odds = 0.955×216/105 = 1.9646 → 1.96 → RTP 1.96×105/216 = 95.28%
//   ANY TRIPLE：P=6/216 → 0.955×216/6 = 34.38 精确 → 95.50%
//   指定豹子：P=1/216 → 0.955×216 = 206.28 精确 → 95.50%
//   指定对子：≥2 个该面 = C(3,2)×5×3/3!·…直接数 15 排列 + 豹子 1 = 16/216
//     （口径：指定对子含该面豹子）→ 0.955×216/16 = 12.8925 → 12.89 → 95.48%
export const ODDS = {
  total: {
    4: 68.76, 5: 34.38, 6: 20.63, 7: 13.75, 8: 9.82, 9: 8.25, 10: 7.64,
    11: 7.64, 12: 8.25, 13: 9.82, 14: 13.75, 15: 20.63, 16: 34.38, 17: 68.76,
  },
  side: 1.96,        // BIG/SMALL/ODD/EVEN（豹子通杀）
  anyTriple: 34.38,
  triple: 206.28,    // 指定三同
  double: 12.89,     // 指定对子（含该面豹子）
}

// 盘区判定表 — 数据驱动生成（31 键：14 和值 + 4 侧注 + 1 任意豹子 + 6 指定豹子
// + 6 指定对子），settle/珠盘路/RTP 模拟共用，零散落 if
export const MARKETS = (() => {
  const m = {}
  for (let s = 4; s <= 17; s++) m[`t-${s}`] = { odds: ODDS.total[s], hit: r => r.total === s }
  m['s-big']   = { odds: ODDS.side, hit: r => r.big && !r.isTriple }
  m['s-small'] = { odds: ODDS.side, hit: r => r.small && !r.isTriple }
  m['s-odd']   = { odds: ODDS.side, hit: r => r.odd && !r.isTriple }
  m['s-even']  = { odds: ODDS.side, hit: r => r.even && !r.isTriple }
  m['tr-any']  = { odds: ODDS.anyTriple, hit: r => r.isTriple }
  for (let v = 1; v <= 6; v++) {
    m[`tr-${v}`] = { odds: ODDS.triple, hit: r => r.tripleFace === v }
    m[`d-${v}`]  = { odds: ODDS.double, hit: r => r.doubles.has(v) }
  }
  return m
})()
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

export const round2 = x => Math.round(x * 100) / 100
export const sumOf = d => d[0] + d[1] + d[2]

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器直接调引擎（生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__HAT = { rollDice, deriveRoll, hitsOf, MARKETS, ODDS }
}
