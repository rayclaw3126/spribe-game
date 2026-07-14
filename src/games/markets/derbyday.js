// #41 单3：DerbyDay 引擎常量块（ODDS/MARKETS/hitsOf 等纯数据纯函数，零 React 依赖）——
// 从 src/games/DerbyDay.jsx 顶部机械剪切至此（赔率单一数据源，多桌 UI 直读本文件的 MARKETS[key].odds）。
// 原 .jsx import 回用 + re-export 保外部引用；window.__XX 对账钩子随本模块加载挂载。数值/逻辑零改。
// ---------- 引擎（纯函数区，禁副作用）----------
// 主客各自独立 80 池抽 20（部分 Fisher-Yates）；rng 可注入，抽取顺序固定 home 先 away 后
export function drawMatch(rng = Math.random) {
  const draw20 = () => {
    const pool = Array.from({ length: 80 }, (_, i) => i + 1)
    for (let k = 0; k < 20; k++) {
      const j = k + Math.floor(rng() * (80 - k))
      ;[pool[k], pool[j]] = [pool[j], pool[k]]
    }
    return pool.slice(0, 20)
  }
  const home20 = draw20()
  const away20 = draw20()
  return { home20, away20 }
}

// 派生：半场 = 前 10 和；全场 = 20 累计和；大小单双按各盘和值派生
const sumOf = a => a.reduce((x, y) => x + y, 0)
export function deriveMatch({ home20, away20 }) {
  const htHome = sumOf(home20.slice(0, 10))
  const htAway = sumOf(away20.slice(0, 10))
  const ftHome = sumOf(home20)
  const ftAway = sumOf(away20)
  return {
    home20, away20,
    htHome, htAway, htTotal: htHome + htAway,
    ftHome, ftAway, ftTotal: ftHome + ftAway,
  }
}

// 赔率配置表 — 全 1.95 起步（推导注释）：
//   两队 iid 对称 ⇒ 单队 10 抽和值均值 405（分布关于 405 对称：x↔81−x 映射），
//   两队合计均值 810（全场 1620）。
//   大小（中点归属推导）：分布关于均值 810（全场 1620）对称，且中点值本身有
//     质量 P(=810)≈0.006 —— 阈值 BIG ≥811/SMALL ≤810 把中点整格划给 SMALL，
//     故 P(SMALL) = 0.5 + P(=中点)/2 ≈ 0.503、P(BIG) = 0.5 − P(=中点)/2 ≈ 0.497。
//     1.95 下 SMALL 结构性超带（1e6 实测 98.1%），故 SMALL 两键单独降 1.92：
//     EV ≈ 1.92×0.503 = 96.6%（带内）；BIG 维持 1.95 ≈ 96.9%（带内）。
//   单双：合计和值奇偶 ≈ 0.5/0.5（97.5% 压线量级，实测 97.4–97.6%，维持 1.95）。
//   H/A：和值比大小，平局 PUSH 退注 ⇒ EV = 1.95×P(win) + 1×P(tie)，
//     P(tie) = Σ P(s)²（离散巧合，HT≈0.004/FT≈0.003），由 1e6 模拟单列回报。
//   半全场（D3 定价，1e7 联合大样本照引擎复刻——FT 含 HT 段 + 队内无放回，禁拆乘）：
//     p(主/主)=p(客/客)=0.3618、p(主/客)=p(客/主)=0.1347（对称差 < 3σ），
//     push = HT 平或 FT 平 = 0.00717（四键全退注）。
//     EV = odds×p + p(push)：同向 2.65 → 96.58%、反转 7.10 → 96.32%（均入 94-97.5% 带）
export const ODDS = { main: 1.95, side: 1.95, small: 1.92, htftSame: 2.65, htftFlip: 7.1 }
export const HT_BIG = 811, FT_BIG = 1621

// 盘区判定表 — 数据驱动生成（12 键 + 半全场 4 键）：hit = 赢；push = 退注
// （H/A 盘平局；半全场 HT 平或 FT 平四键全 push）
export const MARKETS = {
  'ht-home':  { odds: ODDS.main, hit: r => r.htHome > r.htAway, push: r => r.htHome === r.htAway },
  'ht-away':  { odds: ODDS.main, hit: r => r.htAway > r.htHome, push: r => r.htHome === r.htAway },
  'ft-home':  { odds: ODDS.main, hit: r => r.ftHome > r.ftAway, push: r => r.ftHome === r.ftAway },
  'ft-away':  { odds: ODDS.main, hit: r => r.ftAway > r.ftHome, push: r => r.ftHome === r.ftAway },
  'ht-big':   { odds: ODDS.side, hit: r => r.htTotal >= HT_BIG },
  'ht-small': { odds: ODDS.small, hit: r => r.htTotal < HT_BIG },
  'ht-odd':   { odds: ODDS.side, hit: r => r.htTotal % 2 === 1 },
  'ht-even':  { odds: ODDS.side, hit: r => r.htTotal % 2 === 0 },
  'ft-big':   { odds: ODDS.side, hit: r => r.ftTotal >= FT_BIG },
  'ft-small': { odds: ODDS.small, hit: r => r.ftTotal < FT_BIG },
  'ft-odd':   { odds: ODDS.side, hit: r => r.ftTotal % 2 === 1 },
  'ft-even':  { odds: ODDS.side, hit: r => r.ftTotal % 2 === 0 },
}
// 半全场四键：严格不等判胜（任一段平局 hit 必假），push 四键共用同一判定
const htftPush = r => r.htHome === r.htAway || r.ftHome === r.ftAway
Object.assign(MARKETS, {
  'ht-ft-hh': { odds: ODDS.htftSame, hit: r => r.htHome > r.htAway && r.ftHome > r.ftAway, push: htftPush },
  'ht-ft-ha': { odds: ODDS.htftFlip, hit: r => r.htHome > r.htAway && r.ftAway > r.ftHome, push: htftPush },
  'ht-ft-ah': { odds: ODDS.htftFlip, hit: r => r.htAway > r.htHome && r.ftHome > r.ftAway, push: htftPush },
  'ht-ft-aa': { odds: ODDS.htftSame, hit: r => r.htAway > r.htHome && r.ftAway > r.ftHome, push: htftPush },
})
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))
export const pushesOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].push?.(r)))

export const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器直接调引擎（生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__DD = { drawMatch, deriveMatch, hitsOf, pushesOf, MARKETS, ODDS }
}
