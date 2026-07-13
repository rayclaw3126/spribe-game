// 游戏注册表 —— 全站单一数据源（single source of truth）。
// 一款游戏 = 一条配置。名字/封面/分类/后端 id 从此处收口，禁再散落到各文件。
//
// 字段说明：
//   id          FE 组件 key（App.jsx GAMES{} 的键、Lobby onSelect 的值），PascalCase
//   backendId   下注/风控/公平请求用的后端 id（lowercase）。⚠️ 与 id 非纯大小写映射：
//               StreakRoll→streak、MiniRoulette→roulette 显式写死，禁用 id.toLowerCase() 推
//   name        大厅卡片显示名（沿用 Lobby 原 name，中英混排照抄）
//   displayName 顶栏显示名（默认=name，即游戏本名；venue 另存架空场馆名，两者分字段）
//   venue       架空场馆名（仅部分游戏有，来自各 games/*.jsx 的 const VENUE；无则 null）
//   desc/color/bg/cover/cat  卡片副文案 / 主题色 / 卡片渐变 / 封面图 / 分类
//   cat         crash | pk | lotto | arcade（五大类先按此分，日后可调；Lobby tab 见下方映射）
//   rooms       预留：多房间配置（暂空数组）
//
// 数据来源：Lobby.jsx GAMES 数组 + 各 games/*.jsx 的 const VENUE + SeedFairness/WS 现发 game id。
// 全部机械抄录，未改任何值。

// —— 封面 import（从 Lobby.jsx 原样挪来，文件名不改；路径 ../→./ 因本文件在 src/ 根）——
import coverBreakaway from './assets/covers/cover-breakaway.webp'
import coverDribble from './assets/covers/cover-dribble.webp'
import coverFreeKick from './assets/covers/cover-free-kick.webp'
import coverGoal from './assets/covers/cover-goal.webp'
import coverRatingHiLo from './assets/covers/cover-rating-hi-lo.webp'
import coverTeamKeno from './assets/covers/cover-team-keno.webp'
import coverTotalGoals from './assets/covers/cover-total-goals.webp'
import coverOddsClimb from './assets/covers/cover-odds-climb.webp'
import coverStreakRoll from './assets/covers/cover-streak-roll.webp'
import coverTeamRoulette from './assets/covers/cover_miniroulette.png'
import coverMomentum from './assets/covers/cover_momentum.png'
import coverHalfTime from './assets/covers/cover_halftime.png'
import coverPk10 from './assets/covers/cover-pk10.webp'
import coverNumberUp from './assets/covers/cover_numberup.png'
import coverDerbyDay from './assets/covers/cover_derbyday.png'
import coverLineUp from './assets/covers/cover_lineup.webp'
import coverSpeedGrid from './assets/covers/cover_speedgrid.webp'
import coverWuXing from './assets/covers/cover_wuxing.webp'
import coverRollingBall from './assets/covers/cover_rollingball.webp'
import coverDominoDuel from './assets/covers/cover-dominoduel.webp'

const INSTANT_BG = 'linear-gradient(135deg,#0f2a1e,#123a2a)'   // 绿系卡片渐变（多数游戏共用）

export const GAME_REGISTRY = [
  { id: 'Aviator',      backendId: 'aviator',     name: '单刀突袭',    displayName: '单刀突袭',    venue: null,        desc: '抢在被扑倒前兑现！',     color: '#7C3AED', bg: 'linear-gradient(135deg, #EDE9FE, #DDD6FE)', cover: coverBreakaway,    cat: 'crash',  rooms: [] },
  { id: 'Dice',         backendId: 'dice',        name: '总进球',      displayName: '总进球',      venue: null,        desc: '大还是小？押总进球',     color: '#2563EB', bg: 'linear-gradient(135deg, #DBEAFE, #BFDBFE)', cover: coverTotalGoals,   cat: 'arcade', rooms: [] },
  { id: 'Plinko',       backendId: 'plinko',      name: '任意球',      displayName: '任意球',      venue: null,        desc: '弧线球射入死角！',       color: '#D97706', bg: 'linear-gradient(135deg, #FEF3C7, #FDE68A)', cover: coverFreeKick,     cat: 'arcade', rooms: [] },
  { id: 'Goal',         backendId: 'goal',        name: '射门',        displayName: '射门',        venue: null,        desc: '射穿门将！',             color: '#059669', bg: 'linear-gradient(135deg, #D1FAE5, #A7F3D0)', cover: coverGoal,         cat: 'arcade', rooms: [] },
  { id: 'HiLo',         backendId: 'hilo',        name: '评分高低',    displayName: '评分高低',    venue: null,        desc: '评分更高还是更低？',     color: '#DC2626', bg: 'linear-gradient(135deg, #FEE2E2, #FECACA)', cover: coverRatingHiLo,   cat: 'arcade', rooms: [] },
  { id: 'Mines',        backendId: 'mines',       name: '盘带过人',    displayName: '盘带过人',    venue: null,        desc: '盘带过人，避开抢断',     color: '#7C3AED', bg: 'linear-gradient(135deg, #EDE9FE, #DDD6FE)', cover: coverDribble,      cat: 'arcade', rooms: [] },
  { id: 'Keno',         backendId: 'keno',        name: '球队基诺',    displayName: '球队基诺',    venue: null,        desc: '选中获胜球队！',         color: '#DB2777', bg: 'linear-gradient(135deg, #FCE7F3, #FBCFE8)', cover: coverTeamKeno,     cat: 'arcade', rooms: [] },
  { id: 'Limbo',        backendId: 'limbo',       name: '倍数攀升',    displayName: '倍数攀升',    venue: null,        desc: '设定目标赔率，开球攀升！', color: '#16C784', bg: INSTANT_BG,                                 cover: coverOddsClimb,    cat: 'crash',  rooms: [] },
  { id: 'StreakRoll',   backendId: 'streak',      name: '连胜转盘',    displayName: '连胜转盘',    venue: null,        desc: '转动号码带，停在倍数上！', color: '#16C784', bg: INSTANT_BG,                                 cover: coverStreakRoll,   cat: 'arcade', rooms: [] },
  { id: 'MiniRoulette', backendId: 'roulette',    name: '球队轮盘',    displayName: '球队轮盘',    venue: null,        desc: '选定球队，转动轮盘！',   color: '#16C784', bg: INSTANT_BG,                                 cover: coverTeamRoulette, cat: 'arcade', rooms: [] },
  { id: 'Momentum',     backendId: 'momentum',    name: '气势曲线',    displayName: '气势曲线',    venue: null,        desc: '乘势而上，巅峰兑现！',   color: '#16C784', bg: INSTANT_BG,                                 cover: coverMomentum,     cat: 'crash',  rooms: [] },
  { id: 'HalfTime',     backendId: 'halftime',    name: '中场',        displayName: '中场',        venue: '翡翠球场',   desc: '押基诺总和——大/小/区间！', color: '#16C784', bg: INSTANT_BG,                              cover: coverHalfTime,     cat: 'lotto',  rooms: [] },
  { id: 'GoldenBoot',   backendId: 'goldenboot',  name: 'PK10',       displayName: 'PK10',       venue: '红宝石赛道', desc: '十车一线，押名次！',     color: '#ffd54f', bg: INSTANT_BG,                                 cover: coverPk10,         cat: 'pk',     rooms: [] },
  { id: 'NumberUp',     backendId: 'numberup',    name: '号码王',      displayName: '号码王',      venue: '蛋白石球场', desc: '押球衣号码——00 到 99！', color: '#35d07f', bg: INSTANT_BG,                                cover: coverNumberUp,     cat: 'lotto',  rooms: [] },
  // TODO: 换 Codex 专属封面（暂借 Total Goals 封面占位）
  { id: 'HatTrick',     backendId: 'hattrick',    name: '帽子戏法',    displayName: '帽子戏法',    venue: '琥珀穹顶',   desc: '三颗骰子，押总点数！',   color: '#35d07f', bg: INSTANT_BG,                                 cover: coverTotalGoals,   cat: 'lotto',  rooms: [] },
  { id: 'DerbyDay',     backendId: 'derbyday',    name: '德比大战',    displayName: '德比大战',    venue: '翡翠竞技场', desc: '主客对决，押你的一方！', color: '#35d07f', bg: INSTANT_BG,                                 cover: coverDerbyDay,     cat: 'lotto',  rooms: [] },
  { id: 'LineUp',       backendId: 'lineup',      name: '首发阵容',    displayName: '首发阵容',    venue: '蓝宝石球场', desc: '五行 25 号，押各行和！', color: '#35d07f', bg: INSTANT_BG,                                 cover: coverLineUp,       cat: 'lotto',  rooms: [] },
  { id: 'SpeedGrid',    backendId: 'speedgrid',   name: '极速方格',    displayName: '极速方格',    venue: '黄玉赛道',   desc: '24 车争先，一押到底！',  color: '#35d07f', bg: INSTANT_BG,                                 cover: coverSpeedGrid,    cat: 'pk',     rooms: [] },
  { id: 'WuXing',       backendId: 'wuxing',      name: '五行',        displayName: '五行',        venue: '石榴石殿',   desc: '二十球，五行归类！',     color: '#35d07f', bg: INSTANT_BG,                                 cover: coverWuXing,       cat: 'lotto',  rooms: [] },
  { id: 'RollingBall',  backendId: 'rollingball', name: '滚球',        displayName: '滚球',        venue: '尖晶石球场', desc: '三球滚动，逐球押注！',   color: '#35d07f', bg: INSTANT_BG,                                 cover: coverRollingBall,  cat: 'lotto',  rooms: [] },
  { id: 'DominoDuel',   backendId: 'dominoduel',  name: '骨牌对决',    displayName: '骨牌对决',    venue: '玛瑙竞技场', desc: '主客对决，骨牌定胜负！', color: '#35d07f', bg: INSTANT_BG,                                 cover: coverDominoDuel,   cat: 'lotto',  rooms: [] },
]

// #39 大厅分类导航：每款的 navCat（与现有 cat 并存，勿动 cat）。单一映射源 attach 回每条 registry，
// 保证「每款都有 navCat 字段」，又不在 21 行里手抄重复。id 未列则 navCat=undefined（只进「全部」）。
const NAV_CAT_BY_ID = {
  Aviator: 'crash', Limbo: 'crash', Momentum: 'crash',
  GoldenBoot: 'pk', SpeedGrid: 'pk',
  HalfTime: 'lotto', NumberUp: 'lotto', HatTrick: 'lotto', WuXing: 'lotto', LineUp: 'lotto', RollingBall: 'lotto',
  DerbyDay: 'duel', DominoDuel: 'duel',
  Dice: 'arcade', Plinko: 'arcade', Goal: 'arcade', HiLo: 'arcade', Mines: 'arcade', Keno: 'arcade', StreakRoll: 'arcade', MiniRoulette: 'arcade',
}
GAME_REGISTRY.forEach(g => { g.navCat = NAV_CAT_BY_ID[g.id] })

// 大厅分类导航 tab（款数一律由 GAMES.filter(navCat).length 派生，禁手写数字）：
export const NAV_CATS = [
  { key: 'all', label: '全部' },
  { key: 'crash', label: '冲天' },
  { key: 'pk', label: '竞速PK' },
  { key: 'lotto', label: '轮次彩' },
  { key: 'duel', label: '对决' },
  { key: 'arcade', label: '即时街机' },
]

// id → 配置 快查
export const GAME_BY_ID = Object.fromEntries(GAME_REGISTRY.map(g => [g.id, g]))
// backendId → 配置 反查（账单 ledger.type 前缀=backendId，用来映射中文 displayName）
export const GAME_BY_BACKEND_ID = GAME_REGISTRY.reduce((m, g) => (m[g.backendId] = g, m), {})

// —— 大厅精选/curation（从 Lobby.jsx 原样挪来，按 id）——
export const TOP_IDS = ['RollingBall', 'WuXing', 'SpeedGrid', 'LineUp', 'DerbyDay']
export const HOT_IDS = ['Aviator', 'DerbyDay', 'HatTrick', 'GoldenBoot', 'Mines', 'Dice']
export const NEW_IDS = ['DominoDuel', 'RollingBall', 'SpeedGrid', 'WuXing']

// 大厅分类 tab → 归入哪些 cat（保持原「即时街机/轮次开奖」两 tab 的收录集合逐款不变）：
//   即时街机(instant) = crash + arcade（= 原 cat:'instant' 的 11 款）
//   轮次开奖(lottery) = pk + lotto（= 原 cat:'lottery' 的 10 款）
export const TAB_CATS = {
  instant: ['crash', 'arcade'],
  lottery: ['pk', 'lotto'],
}
