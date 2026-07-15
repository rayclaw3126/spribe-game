// #41 单16：WuXing 纯数据/纯函数共享块（五行五段 WUXING / 珠盘 3 视角 ROAD_VIEWS）——
// 从 src/games/WuXing.jsx 机械剪切至此，供原页(mobile 段)与切件(WuXingMarkets/WuXingRoad)单一出处引用。
// 段判定走引擎 WX_BOUNDS + WUXING（禁手写第二份表）；纯 .js 模块避 react-refresh mixed-export。
import { DERBY } from '../../components/shell/tokens'

// 五行五段（格底统一普通盘键色 DERBY.grey，与大小/单双一致；五行字/赔率保留）
export const WUXING = [
  { key: 'wx-gold', name: '金', range: '210-695', odds: '9.35' },
  { key: 'wx-wood', name: '木', range: '696-763', odds: '4.72' },
  { key: 'wx-water', name: '水', range: '764-855', odds: '2.46' },
  { key: 'wx-fire', name: '火', range: '856-923', odds: '4.72' },
  { key: 'wx-earth', name: '土', range: '924-1410', odds: '9.10' },
]

// 珠盘路 3 视角（road 现存整局 sum，从 sum 派生）。段判定走引擎 WX_BOUNDS + WUXING（禁手写第二份表）。
const WX_BOUNDS = [695, 763, 855, 923]   // 五行段分界（±30 慢放判定）
const WX_ROAD_C = [DERBY.gold, DERBY.sel, DERBY.home, DERBY.away, '#c8873a']   // 金木水火土 珠色（仅显示，非判定）
export const ROAD_VIEWS = [
  { key: 'bs', label: '大小', judge: n => n >= 811 ? { t: '大', c: DERBY.away } : { t: '小', c: DERBY.home } },
  { key: 'oe', label: '单双', judge: n => n % 2 ? { t: '单', c: DERBY.away } : { t: '双', c: DERBY.home } },
  { key: 'wx', label: '五行段', judge: n => { const i = WX_BOUNDS.filter(b => n > b).length; return { t: WUXING[i].name, c: WX_ROAD_C[i] } } },
]
