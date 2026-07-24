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

// 珠盘路 6 视角（#Ray 6 路定案）。road 项从裸 sum 升级为 { sum, up } —— 「上下」是「≤40 的球数」，
//   sum 推不出，必须随珠存 up（引擎 deriveRound(balls).up）。三处记账（live 选中房/后台房/播种）
//   与多桌 roadItem 同步升级，形状单一出处即本文件的 judge 入参约定。
// ⚠ 判定一律照抄引擎 src/games/markets/wuxing.js 的 MARKETS.hit 原式，禁自创分界：
//     big   r.sum >= 811     small r.sum <= 810      odd/even r.sum % 2
//     dragon r.dragon > r.tiger   tiger r.tiger > r.dragon   dt-tie r.dragon === r.tiger
//     up    r.up > 10        down  r.up < 10         ud-tie r.up === 10
//   dragon = floor(sum/10)%10、tiger = sum%10（deriveRound 同式），故龙虎从 sum 可算。
const WX_BOUNDS = [695, 763, 855, 923]   // 五行段分界（±30 慢放判定）
const WX_ROAD_C = [DERBY.gold, DERBY.sel, DERBY.home, DERBY.away, '#c8873a']   // 金木水火土 珠色（仅显示，非判定）
const WX_COMBO_C = [DERBY.away, '#f28c17', DERBY.home, '#0891B2']   // 大单/大双/小单/小双 珠色（仅显示，非判定）
const TIE_C = '#5b6472'                                             // 和局中性灰（与其余款和局同色位）
// judge 入参是【road 项】d = { sum, up }（不是裸 sum）。
export const ROAD_VIEWS = [
  { key: 'bs', label: '大小', judge: d => d.sum >= 811 ? { t: '大', c: DERBY.away } : { t: '小', c: DERBY.home } },
  { key: 'oe', label: '单双', judge: d => d.sum % 2 ? { t: '单', c: DERBY.away } : { t: '双', c: DERBY.home } },
  // 组合：大小×单双 四态（引擎 big/small × odd/even 原式交叉，非新判定）
  { key: 'combo', label: '组合', judge: d => { const big = d.sum >= 811, odd = d.sum % 2 === 1
    const i = big ? (odd ? 0 : 1) : (odd ? 2 : 3)
    return { t: `${big ? '大' : '小'}${odd ? '单' : '双'}`, c: WX_COMBO_C[i] } } },
  // 龙虎：dragon = floor(sum/10)%10 vs tiger = sum%10（deriveRound 同式）；相等即和（引擎 dt-tie）
  { key: 'dt', label: '龙虎', judge: d => { const dr = Math.floor(d.sum / 10) % 10, tg = d.sum % 10
    if (dr === tg) return { t: '和', c: TIE_C }
    return dr > tg ? { t: '龙', c: DERBY.away } : { t: '虎', c: DERBY.home } } },
  { key: 'wx', label: '五行段', judge: d => { const i = WX_BOUNDS.filter(b => d.sum > b).length; return { t: WUXING[i].name, c: WX_ROAD_C[i] } } },
  // 上下：up = ≤40 的球数（引擎 deriveRound(balls).up）；>10 上 / <10 下 / ===10 和（引擎 ud-tie）
  { key: 'ud', label: '上下', judge: d => { if (d.up == null) return { t: '·', c: TIE_C }
    if (d.up === 10) return { t: '和', c: TIE_C }
    return d.up > 10 ? { t: '上', c: DERBY.away } : { t: '下', c: DERBY.home } } },
]
