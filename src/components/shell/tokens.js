// Shared shell design tokens — all shell components pull colors/radii/spacing
// from here. No hex literals inside shell component files.

// #39 大厅分类导航专用暗黑色组（风格B·暗黑专业）——Lobby / Header 只从这里取，禁再散落 hex。
export const LOBBY_DARK = {
  bg: '#101216',
  panel: '#15181d',
  card: '#1a1e24',
  line: '#262a31',
  txt: '#f2f4f6',
  txtDim: '#aab1bb',
  txtMute: '#6b727d',
  accent: '#4ade80',
  accentInk: '#0b2415',
  accentBg: '#1a2e22',
  cardHi: '#1f242b',   // 侧栏激活底 / 卡片 hover 的中性提亮面（步骤3 指定 #1f242b；并入本组保持单一出处）
  scrim: 'rgba(10,12,16,0.92)',   // 覆盖式卡片底部遮罩色（#0a0c10·92%），压住封面下半保白字可读
}

export const COLORS = {
  bg: '#0a1119',
  panel: '#101923',
  surface: '#1a2230',
  border: '#232c39',
  borderLight: '#243142',
  text: '#e8edf2',
  textMuted: '#8a97a6',
  textFaint: '#7d8a99',

  green: '#16C784',
  greenSoft: '#5DCAA5',
  greenGlow: 'rgba(22,199,132,0.45)',
  greenTint: 'rgba(93,202,165,0.16)',

  amber: '#F5A623',
  amberDeep: '#c77f0a',
  amberTint: 'rgba(245,166,35,0.18)',
  amberGlow: 'rgba(245,166,35,0.5)',

  redDark: '#a13333',
  redDeep: '#7f2626',

  slate: '#8fa3b8',
  slateTint: 'rgba(125,138,153,0.16)',

  white: '#ffffff',
  shadow: 'rgba(0,0,0,0.35)',

  // Arena backdrop FX (crash games) — radial wedges + parallax star drift
  fxWedgeDim: 'rgba(22,199,132,0.03)',
  fxWedgeBright: 'rgba(22,199,132,0.05)',
  fxStarFar: 'rgba(125,138,153,0.4)',
  fxStarNear: 'rgba(93,202,165,0.55)',
  fxBarTrack: '#1a2230',
  fxBarFill: '#16C784',
  fxWaitText: '#8a97a6',

  // Win toast
  toastBg: 'rgba(13,42,31,0.95)',
  toastBorder: 'rgba(22,199,132,0.55)',

  // Bet feed
  feedLive: '#facc15',
  feedWin: '#86efac',
  feedLose: '#5b6878',
  feedYouBg: 'rgba(22,199,132,0.14)',
  feedYouBorder: 'rgba(22,199,132,0.45)',
}

// Team Roulette — sampled from the Spribe Mini Roulette reference shot
export const ROULETTE = {
  feltCenter: '#1c8f45',  // 仿 Spribe 亮绿毡（径向渐变中心）
  feltEdge: '#0a5526',    // 仿 Spribe 绿（边缘）
  band: '#0b4d23',        // top bar + chip rail dark-green band
  red: '#d6262d',
  black: '#1b1b1b',
  rim: '#0e3d1d',                    // wheel outer dark ring
  line: 'rgba(255,255,255,0.55)',    // white table skeleton
  ball: '#ffb300',                   // golden ball
  orange: '#f28c17',                 // How to Play pill
  hub: '#f6eef0',                    // wheel hub (warm white)
  chipGrey: '#9e9e9e',
  chipRed: '#e53935',
  chipBlue: '#1e88e5',
  chipGreen: '#43a047',
  chipBlack: '#424242',
  chipPurple: '#8e24aa',
}

// Team Keno — sampled from the Spribe Keno reference shot
export const KENO = {
  // 背景/chrome 改球场绿（对照 StreakRoll 终态色感），玩法洋红保留：
  bgOuter: '#0d4a20',   // 球场绿（面板边缘，= MINES.bgOuter）
  bgCenter: '#28814a',  // 球场绿（中央，= HOTLINE.bgCenter 终态）
  band: '#0b3d1c',      // 顶栏 / 底部条（= MINES.band，控件底更深档）
  ctrl: '#11582a',      // chrome 控件底（= HOTLINE.band 终态，外框深绿档）
  strip: 'rgba(0,0,0,0.28)',
  pill: '#c81450',      // crimson —— 玩法色：选中球/命中球/标题 accent（不动）
  ballDeep: '#5a0626',  // 选中球渐变外缘（原洋红 bgOuter 值，保玩法色）
  ball: '#211016',      // number ball base (near-black)
  ballRim: 'rgba(214,26,86,0.55)',
  green: '#35d07f',     // PICK NUMBERS FOR START
  blue: '#2e8f4f',      // turbo circle button — 绿版（= HOTLINE.blue 终态，键名保留）
  bet: '#9aa019',       // BET olive gradient top
  betDark: '#6e7513',   // BET olive gradient bottom
  orange: '#f28c17',
  xDark: 'rgba(0,0,0,0.16)',  // giant side chevrons
}

// Number Up — 两位数球衣号码彩：绿系四键取 KENO 终态；球衣绿取 HiLo 球衣实心色
// (#14803c，HiLo Jersey 组件同款)；金/红/蓝取共享。纯新增零删改
export const NUMBERUP = {
  bgOuter: '#0d4a20',   // = KENO.bgOuter（球场绿边缘）
  bgCenter: '#28814a',  // = KENO.bgCenter（球场绿中央）
  band: '#0b3d1c',      // = KENO.band（顶栏/注栏）
  ctrl: '#11582a',      // = KENO.ctrl（chrome 控件底）
  strip: 'rgba(0,0,0,0.32)',
  grey: '#1a2230',      // = DERBY.grey，暗灰格底（下注格底）
  jersey: '#14803c',    // HiLo 球衣实心绿 — 号码卡小图
  gold: '#ffd54f',      // 共享金 — 选中金框/赔率字
  sel: '#35d07f',       // 确认绿（共享）
  selTint: 'rgba(53,208,127,0.16)',
  text: '#e8f5ec',
  dim: 'rgba(255,255,255,0.55)',
  hi: '#e2564a',        // HIGH / 红珠（共享 crash red）
  lo: '#2f6fe0',        // LOW / 蓝珠（共享 blue）
  orange: '#f28c17',
}

// Golden Boot — 10 球员冲刺排名彩：金靴金 + 球场绿。绿系直接取 KENO 终态键值；
// 金系从共享 gold(#ffd54f)/HOTLINE.fire(#ffb300)/orange(#f28c17) 推导，纯新增零删改
export const GOLDENBOOT = {
  bgOuter: '#0d4a20',   // = KENO.bgOuter（球场绿边缘）
  bgCenter: '#28814a',  // = KENO.bgCenter（球场绿中央）
  band: '#0b3d1c',      // = KENO.band（顶栏/注栏）
  ctrl: '#11582a',      // = KENO.ctrl（chrome 控件底）
  strip: 'rgba(0,0,0,0.32)',
  grey: '#1a2230',      // = DERBY.grey，暗灰格底（下注格底）
  gold: '#ffd54f',      // 金靴主金（共享 gold）— 赔率字/选中金框
  fire: '#ffb300',      // 金珠渐变中段（= HOTLINE.fire）
  goldDeep: '#f28c17',  // 金渐变收底（共享 orange）
  sel: '#35d07f',       // 确认绿（共享）
  selTint: 'rgba(53,208,127,0.16)',   // 选中绿罩（共享 selTint）
  text: '#e8f5ec',
  dim: 'rgba(255,255,255,0.55)',
  dragon: '#e2564a',    // DRAGON（共享 crash red）
  tiger: '#2f6fe0',     // TIGER（共享 blue）
  orange: '#f28c17',
}

// Odds Climb — 球场绿 chrome（键值直接取 KENO 终态同款）；力量表/倍率大字/
// 中奖态等玩法色仍留在 Limbo.jsx 局部（COLOR/FILL_TOP/AMBER + canvas 内色）
export const LIMBO = {
  bgOuter: '#0d4a20',   // = KENO.bgOuter（球场绿边缘）
  bgCenter: '#28814a',  // = KENO.bgCenter（球场绿中央）
  band: '#0b3d1c',      // = KENO.band（深档控件底）
  ctrl: '#11582a',      // = KENO.ctrl（浅档控件底）
}

// Streak Roll — sampled from the Spribe Hotline reference shot
export const HOTLINE = {
  // 背景改球场绿 — 取自 MINES.bgOuter/bgCenter (#0d4a20/#2e8f4f)，中央略压暗
  // 以衬宝蓝滚条带；仅 StreakRoll 引用这两键（改前已 grep 全量确认）
  bgOuter: '#0d4a20',    // 球场绿（面板边缘，= MINES.bgOuter）
  bgCenter: '#28814a',   // 球场绿（中央，MINES.bgCenter #2e8f4f 压暗一档）
  // 界面绿两档 — 外框深绿 / 控件底更深，对照 Mines 顶栏注栏同款色感：
  band: '#11582a',       // card-strip band（MINES.bgOuter #0d4a20 提亮一档）
  bar: '#0b3d1c',        // top/bottom bars, pills, track（= MINES.band）
  cardRed: '#f9576d',      // 仿 Spribe 艳粉红（重取样）
  cardRedDeep: '#e63652',
  cardRedDot: '#fb8a99',   // 红卡内浅粉大圆
  cardNavy: '#1d2c47',
  cardNavyDot: '#16233a',
  fire: '#ffb300',
  fireDeep: '#f28c17',
  gold: '#ffd54f',       // selection frame / DEMO pill
  blue: '#2e8f4f',       // round action buttons — 绿版（= MINES.bgCenter，键名保留兼容）
  black: '#0d0d10',      // BLACK bet button
  orange: '#f28c17',
}

// Total Goals — Spribe Dice reskinned purple→green (felt family shared with
// ROULETTE); red lose-band / teal under-win / blue over-win semantics kept.
export const DICE = {
  bgOuter: '#0a5526',    // felt edge
  bgCenter: '#1c8f45',   // felt center
  band: '#0b4d23',       // top/bottom bars
  panel: '#093f1d',      // track + payout panels (darker felt)
  panelDeep: '#072f16',  // payout sub-strip / inset boxes
  red: '#c41836',        // lose segments on both scale bands
  blue: '#25b1f0',       // OVER win segment (top band, right)
  teal: '#2ee08c',       // UNDER win segment (bottom band, left)
  ball: '#ffb300',       // golden landing ball
  gold: '#ffd54f',       // DEMO pill
  orange: '#f28c17',     // How to Play pill
  btnUnder: '#18a54a',   // ROLL UNDER big button
  btnOver: '#1976d2',    // ROLL OVER big button
  circleBlue: '#2f6fe0', // round refresh button
}

// Free Kick — Spribe Plinko reskinned teal→pitch green; sampled from the
// Plinko reference shot (multiplier row colors + button trio kept).
export const PLINKO = {
  bgOuter: '#0c4a24',     // pitch edge
  bgCenter: '#26a055',    // pitch center glow
  band: '#0b4d23',        // top/bottom bars
  line: 'rgba(255,255,255,0.35)',   // center-circle / corner-arc lines
  pin: '#f2f5f7',         // white pearl pins
  dash: 'rgba(255,255,255,0.4)',    // funnel dashed borders
  ball: '#ffffff',        // football base
  rowGreen: '#56a80e', rowGreenDim: '#3f7c0a',
  rowYellow: '#f08c00', rowYellowDim: '#b56400',
  rowRed: '#e8352c', rowRedDim: '#a31f18',
  btnGreen: '#4a9b16',
  btnYellow: '#e0570e',
  btnRed: '#d61932',
  blue: '#2f6fe0',        // round refresh button
  gold: '#ffd54f',
  orange: '#f28c17',
}

// Rating Hi-Lo — Spribe Hi Lo reskinned amber→pitch green; sampled from the
// Hi Lo reference shot (blue LOW / amber HIGH / green mult semantics kept).
export const HILO = {
  bgOuter: '#0d4f26',      // pitch edge
  bgCenter: '#2f9e58',     // pitch center glow
  band: 'rgba(0,0,0,0.28)',    // translucent strips (top rows, bottom bar)
  low: '#2f6fe0',          // LOW OR SAME pill (blue)
  high: '#cf7a10',         // HIGH OR SAME pill (amber)
  green: '#35d07f',        // multiplier boxes
  bet: '#4a9b16',          // big BET button
  back: '#132a4d',         // deck card back navy
  backLine: '#1d3c6e',     // card back pattern lines
  badgeUp: '#e0821a',      // history ↑ badge
  badgeDown: '#2f6fe0',    // history ↓ badge
  outline: 'rgba(0,0,0,0.16)',  // giant corner card line art
  cashout: '#d63b10',      // CASHOUT button (ref red-orange)
  gold: '#ffd54f',
  orange: '#f28c17',
}

// Goal — sampled from the Spribe Goal reference shot (bright pitch green,
// light cell grid, orange Next pill).
export const GOAL = {
  bgOuter: '#1c3a06',      // dark olive edges
  bgCenter: '#4a7a1a',     // bright center glow
  band: '#1d4408',         // top/bottom bars
  strip: 'rgba(0,0,0,0.25)',   // second-row strip / RANDOM row capsule
  cellTop: '#d8e9c4',      // cell gradient top
  cellBot: '#aecb8e',      // cell gradient bottom
  cellWhiteTop: '#ffffff', // active-column cell
  cellWhiteBot: '#e9f0da',
  line: 'rgba(0,0,0,0.2)', // giant football / half-pitch line art
  win: '#35d07f',          // +X.XX USD pill
  orange: '#f28c17',       // How to Play / Next pill
  gold: '#ffd54f',
  blue: '#2f6fe0',         // round refresh button
  bet: '#4a9b16',          // big BET button
}

// Dribble — Spribe Mines reskinned blue→pitch green; sampled from the Mines
// reference shot (gold opened-cell semantics kept).
export const MINES = {
  bgOuter: '#0d4a20',      // dark pitch edges
  bgCenter: '#2e8f4f',     // bright center
  band: '#0b3d1c',         // top/bottom bars
  strip: 'rgba(0,0,0,0.3)',    // second-row strip / RANDOM capsule
  cellTop: '#1b3d26',      // unopened cell gradient
  cellBot: '#0f2416',
  cellBorder: 'rgba(255,255,255,0.14)',
  dot: 'rgba(255,255,255,0.16)',   // unopened center dot
  goldTop: '#ffc93c',      // opened-safe cell (语义保留)
  goldBot: '#f28c17',
  red: '#d61932',          // exploded tackle cell
  tackleDark: '#0d1f13',   // revealed-but-not-hit tackle cell
  next: '#ffc93c',         // Next pill (gold, dark text)
  progress: '#35d07f',
  progressTrack: 'rgba(0,0,0,0.4)',
  cash: '#f5a623',         // gold CASH OUT button
  blue: '#2f6fe0',
  orange: '#f28c17',
  gold: '#ffd54f',
}

// Momentum — Spribe Trader reskinned dark-purple→midnight pitch; sampled
// from the Trader how-to-play shots (purple accents → green).
export const MOMENTUM = {
  bgTop: '#12301d',        // midnight pitch gradient top
  bgBot: '#07130c',        // …bottom
  grid: 'rgba(53,208,127,0.09)',   // turf grid lines
  green: '#35d07f',        // big multiplier + rising bars
  barTop: '#5ee8a0',       // bar gradient head
  red: '#e04b3a',          // sub-1x history pills
  greyPill: 'rgba(255,255,255,0.35)',   // 0.00x busted pill
  text: '#e8f5ec',
  dim: 'rgba(255,255,255,0.55)',
  badgeBg: 'rgba(0,0,0,0.35)',
}

// Half Time — 快乐8和值盘 midnight-pitch palette. Derived, no invented hues:
// bg pair = MOMENTUM.bgTop/bgBot family darkened one step; band/cell from
// MINES.band/cellTop darkened; accents reuse shared greens/gold/red/blue.
export const HALFTIME = {
  bgOuter: '#07130c',      // = MOMENTUM.bgBot (midnight pitch edge)
  bgCenter: '#123424',     // MOMENTUM.bgTop #12301d nudged toward MINES green
  band: '#08240f',         // MINES.band #0b3d1c darkened (top/bottom bars)
  strip: 'rgba(0,0,0,0.32)',   // round bar / bead-road backing
  cellTop: '#12351f',      // bet cell gradient — MINES.cellTop family, darker
  cellBot: '#0a1f12',
  grey: '#1a2230',         // = DERBY.grey，暗灰格底（下注格底）
  cellBorder: 'rgba(255,255,255,0.16)',
  sel: '#35d07f',          // selected outline (shared green)
  selTint: 'rgba(53,208,127,0.16)',
  odds: '#ffd54f',         // odds gold (shared)
  over: '#e2564a',         // O beads / over accents (shared crash red)
  under: '#2f6fe0',        // U beads / under accents (shared blue)
  draw: '#f28c17',         // draw / neutral accent (shared orange)
  text: '#e8f5ec',         // = MOMENTUM.text
  dim: 'rgba(255,255,255,0.55)',
  gold: '#ffd54f',
  orange: '#f28c17',
}

// Hat Trick — 快3三骰彩：绿系四键取 KENO 终态；骰面白取共享 COLORS.white、
// 骰点近黑取共享 COLORS.panel；金/绿/红/蓝/橙取共享。纯新增零删改
export const HATTRICK = {
  bgOuter: '#0d4a20',   // = KENO.bgOuter（球场绿边缘）
  bgCenter: '#28814a',  // = KENO.bgCenter（球场绿中央）
  band: '#0b3d1c',      // = KENO.band（顶栏/注栏）
  ctrl: '#11582a',      // = KENO.ctrl（chrome 控件底）
  strip: 'rgba(0,0,0,0.32)',
  grey: '#1a2230',      // = DERBY.grey，暗灰格底（下注格底）
  face: '#ffffff',      // 骰面白（= COLORS.white）
  pip: '#101923',       // 骰点近黑（= COLORS.panel）
  gold: '#ffd54f',      // 共享金 — 选中金框/赔率字
  sel: '#35d07f',       // 确认绿（共享）
  selTint: 'rgba(53,208,127,0.16)',
  text: '#e8f5ec',
  dim: 'rgba(255,255,255,0.55)',
  big: '#e2564a',       // BIG/大珠（共享 crash red）
  small: '#2f6fe0',     // SMALL/小珠（共享 blue）
  orange: '#f28c17',
}

// Derby Day — 主客对抗 Keno：绿 chrome 四键取 KENO 终态；主队蓝按单据定
// #2563c9 系；客队红取共享 crash red（=NUMBERUP.hi/HATTRICK.big 同源）；
// 深灰格底取共享 COLORS.surface；金/绿/橙取共享。纯新增零删改
export const DERBY = {
  bgOuter: '#0d4a20',   // = KENO.bgOuter（球场绿边缘）
  bgCenter: '#28814a',  // = KENO.bgCenter（球场绿中央）
  band: '#0b3d1c',      // = KENO.band（顶栏/注栏）
  ctrl: '#11582a',      // = KENO.ctrl（chrome 控件底）
  strip: 'rgba(0,0,0,0.32)',
  home: '#2563c9',      // 主队蓝（单据定 #2563c9 系）
  away: '#e2564a',      // 客队红（共享 crash red）
  grey: '#1a2230',      // 深灰格底（= COLORS.surface）
  gold: '#ffd54f',      // 共享金 — 选中金框/赔率字/TOTAL 胶囊
  sel: '#35d07f',       // 确认绿（共享）
  selTint: 'rgba(53,208,127,0.16)',
  text: '#e8f5ec',
  dim: 'rgba(255,255,255,0.55)',
  orange: '#f28c17',
}

// Avatar chips pick a stable color by username hash.
export const AVATAR_COLORS = [
  '#7C3AED', '#2563EB', '#0891B2', '#16A34A',
  '#CA8A04', '#EA580C', '#DC2626', '#DB2777',
]

export const RADIUS = {
  pill: 999,
  btn: 12,
  chip: 12,
  panel: 16,
  input: 10,
}

export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
}

// Spribe-parity desktop skeleton (1440×900 basis, ≥1024 breakpoint)
export const LAYOUT = {
  breakpoint: 1024,
  siteHeaderH: 0,    // 全屏游戏视图不挂站点顶栏，游戏区不再为它扣高度
  headerH: 40,       // in-game top bar (name left, balance right)
  feedW: 400,        // bet feed sidebar, full height, edge-flush
  historyH: 34,      // round-history strip row
  canvasRadius: 16,  // arena card corner radius
  bottomH: 185,      // bottom bet-bay section (min height)
  bayW: 500,         // single centered bet bay width
}
