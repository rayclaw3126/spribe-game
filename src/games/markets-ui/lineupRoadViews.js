// #41 单16：LineUp 珠盘路 3 视角判定（大小 / 单双 / 段位）——从 LineUp.jsx 机械剪切（纯数据纯函数，
// 零 React 依赖）。珠盘存整局 total（0-225），各视角从 total 派生；段位判定复用引擎 MARKETS zone-* 实值 hit
// （禁手写第二份表）。桌面墙件(LineUpRoad) 与手机内联路珠共用本文件，单一出处。
import { DERBY } from '../../components/shell/tokens'
import { MARKETS } from '../markets/lineup'

const ZONE_KEYS = ['zone-releg', 'zone-mid', 'zone-euro', 'zone-champ']
const ZONE_CHARS = ['降', '中', '欧', '冠']
const ZONE_C = [DERBY.away, DERBY.home, DERBY.sel, DERBY.gold]   // 降红/中蓝/欧绿/冠金（仅显示）
export const ROAD_VIEWS = [
  { key: 'bs', label: '大小', judge: n => n >= 113 ? { t: '大', c: DERBY.away } : { t: '小', c: DERBY.home } },
  { key: 'oe', label: '单双', judge: n => n % 2 ? { t: '单', c: DERBY.away } : { t: '双', c: DERBY.home } },
  { key: 'zone', label: '段位', judge: n => { const i = ZONE_KEYS.findIndex(k => MARKETS[k].hit({ total: n })); return { t: ZONE_CHARS[i] ?? '', c: ZONE_C[i] ?? 'rgba(255,255,255,0.2)' } } },
]
