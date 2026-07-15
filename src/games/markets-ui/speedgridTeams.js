// #41 单15：SpeedGrid 4 队涂装表（纯数据/纯函数，零 React 依赖）——
// 从 src/games/SpeedGrid.jsx 机械剪切至此（照 carAssets.js 先例：跨件共享 const 出 .js 保 react-refresh）。
// 页面开奖区(24 车小网格/冠军队标) 与盘口区切件(车队行/直选格底色) 同源，禁二份表。
import { COLORS, DERBY, ROULETTE } from '../../components/shell/tokens'

// 4 队涂装（色值全部 tokens 现组）：蓝=DERBY.home / 红=DERBY.away /
// 金=COLORS.amberDeep / 黑=ROULETTE.black；每队 6 车按号段分组
export const TEAMS = [
  { name: '蓝队', range: '1-6', c: DERBY.home },
  { name: '红队', range: '7-12', c: DERBY.away },
  { name: '金队', range: '13-18', c: COLORS.amberDeep },
  { name: '黑队', range: '19-24', c: ROULETTE.black },
]
export const teamOf = n => TEAMS[Math.floor((n - 1) / 6)]
