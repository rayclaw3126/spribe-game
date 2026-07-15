// #41 单15：HatTrick 纯数据/纯函数共享块（SIDES / 珠盘页签 / beadFor）——
// 从 HatTrick.jsx 机械剪切至此，供原页(mobile 段)与切件(HatTrickMarkets/HatTrickRoad)单一出处引用。
// 判定/珠盘走引擎口径（sumOf/HATTRICK），禁二份表；纯 .js 模块避 react-refresh mixed-export。
import { HATTRICK } from '../../components/shell/tokens'
import { sumOf } from '../markets/hattrick'

// 大小单双四侧注（豹子通杀）——原页 module-level SIDES 逐字节搬
export const SIDES = [
  { key: 's-big',   name: '大', range: '11–17' },
  { key: 's-small', name: '小', range: '4–10' },
  { key: 's-odd',   name: '单', range: '和值单' },
  { key: 's-even',  name: '双', range: '和值双' },
]

// 珠盘页签内部 key（beadFor 判定用，不动）+ 中文显示映射（照 Derby/HalfTime 先例分离）
export const ROAD_TABS = ['TOTAL', 'B-S', 'TRIPLE']
export const ROAD_TAB_LABELS = { TOTAL: '和值', 'B-S': '大小', TRIPLE: '豹子' }
export function beadFor(tab, dice) {
  const s = sumOf(dice)
  const triple = dice[0] === dice[1] && dice[1] === dice[2]
  if (tab === 'TOTAL') return { t: String(s), c: s >= 11 ? HATTRICK.big : HATTRICK.small }
  if (tab === 'B-S') {
    if (triple) return { t: 'T', c: HATTRICK.gold, dark: true }   // 豹子通杀期
    return s >= 11 ? { t: 'B', c: HATTRICK.big } : { t: 'S', c: HATTRICK.small }
  }
  // TRIPLE 页：豹子期金珠，其余灰珠
  return triple
    ? { t: String(dice[0]), c: HATTRICK.gold, dark: true }
    : { t: '', c: 'rgba(255,255,255,0.14)' }
}
