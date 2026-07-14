// #41 单3：盘口赔率单一数据源 —— 直读各款引擎 markets/<be>.js 的 MARKETS[key].odds。
// 多桌 UI 不再存假 odds（mockData 只留组名/键名/中文 label）。禁自建第二份赔率表。
import { MARKETS as goldenboot, hitsOf as hits_gb, deriveRace } from '../../games/markets/goldenboot'
import { MARKETS as speedgrid, hitsOf as hits_sg } from '../../games/markets/speedgrid'
import { MARKETS as halftime, hitsOf as hits_ht, deriveRound as derive_ht } from '../../games/markets/halftime'
import { MARKETS as numberup, hitsOf as hits_nu, deriveNum } from '../../games/markets/numberup'
import { MARKETS as hattrick, hitsOf as hits_hat, deriveRoll } from '../../games/markets/hattrick'
import { MARKETS as wuxing, hitsOf as hits_wx, deriveRound as derive_wx } from '../../games/markets/wuxing'
import { MARKETS as lineup, hitsOf as hits_lu, deriveRound as derive_lu } from '../../games/markets/lineup'
import { MARKETS as derbyday, hitsOf as hits_dd } from '../../games/markets/derbyday'
import { MARKETS as dominoduel, hitsOf as hits_dom } from '../../games/markets/dominoduel'

// game id → 该款 MARKETS 表
export const MARKETS_BY_ID = {
  GoldenBoot: goldenboot, SpeedGrid: speedgrid, HalfTime: halftime, NumberUp: numberup,
  HatTrick: hattrick, WuXing: wuxing, LineUp: lineup, DerbyDay: derbyday, DominoDuel: dominoduel,
}

// 取某款某键的赔率字符串（缺键兜 ''，防 UI 崩）
export const oddsStr = (id, key) => {
  const o = MARKETS_BY_ID[id]?.[key]?.odds
  return o == null ? '' : Number(o).toFixed(2)
}

// —— 迷你路珠·每款主视角 ——
// 判定必走引擎：drawResult →（有则 derive 成 round 对象）→ hitsOf → 命中 up/down 键 → tone；
// 都不中 = tie。禁自建第二份大小/主客判定表。tone→色走 tokens.MULTI_DARK 路珠三色（TableCard 里查）。
//   speedgrid/hattrick/halftime/wuxing/lineup=大小 · numberup=高低 ·
//   goldenboot=冠亚和大小 · derbyday/dominoduel=主客和三色
const BEAD = {
  SpeedGrid:  { hits: dr => hits_sg(dr.n),                      up: 'big',      down: 'small',    fu: '大', fd: '小', ft: '和' },
  HatTrick:   { hits: dr => hits_hat(deriveRoll(dr.dice)),      up: 's-big',    down: 's-small',  fu: '大', fd: '小', ft: '豹' },
  HalfTime:   { hits: dr => hits_ht(derive_ht(dr.balls)),       up: 'over',     down: 'under',    fu: '大', fd: '小', ft: '和' },
  WuXing:     { hits: dr => hits_wx(derive_wx(dr.balls)),       up: 'big',      down: 'small',    fu: '大', fd: '小', ft: '和' },
  LineUp:     { hits: dr => hits_lu(derive_lu(dr.grid)),        up: 'big',      down: 'small',    fu: '大', fd: '小', ft: '和' },
  NumberUp:   { hits: dr => hits_nu(deriveNum(dr.num)),         up: 's-high',   down: 's-low',    fu: '高', fd: '低', ft: '和' },
  GoldenBoot: { hits: dr => hits_gb(deriveRace(dr.ranking)),    up: 's-big',    down: 's-small',  fu: '大', fd: '小', ft: '和' },
  DerbyDay:   { hits: dr => hits_dd(dr),                        up: 'ft-home',  down: 'ft-away',  fu: '主', fd: '客', ft: '和' },
  DominoDuel: { hits: dr => hits_dom(dr),                       up: 'home-win', down: 'away-win', fu: '主', fd: '客', ft: '和' },
}

// drawResult → { face:单字, tone:'up'|'down'|'tie' }；缺数据/异常 → null（不落珠）
export function beadOf(id, drawResult) {
  const cfg = BEAD[id]
  if (!cfg || drawResult == null) return null
  try {
    const set = cfg.hits(drawResult)
    if (set.has(cfg.up)) return { face: cfg.fu, tone: 'up' }
    if (set.has(cfg.down)) return { face: cfg.fd, tone: 'down' }
    return { face: cfg.ft, tone: 'tie' }
  } catch { return null }
}
