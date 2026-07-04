// Shared shell design tokens — all shell components pull colors/radii/spacing
// from here. No hex literals inside shell component files.

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
  bgOuter: '#5a0626',   // 仿 Spribe 洋红（面板边缘暗酒红）
  bgCenter: '#a50f47',  // 仿 Spribe 洋红（中央亮）
  band: '#6d0830',      // 顶栏 / 底部条
  strip: 'rgba(0,0,0,0.28)',
  pill: '#c81450',      // crimson pills / RANDOM
  ball: '#211016',      // number ball base (near-black)
  ballRim: 'rgba(214,26,86,0.55)',
  green: '#35d07f',     // PICK NUMBERS FOR START
  blue: '#3b4ed8',      // turbo circle button
  bet: '#9aa019',       // BET olive gradient top
  betDark: '#6e7513',   // BET olive gradient bottom
  orange: '#f28c17',
  xDark: 'rgba(0,0,0,0.16)',  // giant side chevrons
}

// Streak Roll — sampled from the Spribe Hotline reference shot
export const HOTLINE = {
  bgOuter: '#25367f',    // 仿 Spribe 宝蓝（面板边缘）
  bgCenter: '#3a4fa5',   // 仿 Spribe 宝蓝（中央）
  band: '#4157b0',       // card-strip band
  bar: '#1d2b5e',        // top/bottom bars, pills, track
  cardRed: '#f9576d',      // 仿 Spribe 艳粉红（重取样）
  cardRedDeep: '#e63652',
  cardRedDot: '#fb8a99',   // 红卡内浅粉大圆
  cardNavy: '#1d2c47',
  cardNavyDot: '#16233a',
  fire: '#ffb300',
  fireDeep: '#f28c17',
  gold: '#ffd54f',       // selection frame / DEMO pill
  blue: '#2f6fe0',       // round action buttons
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
  siteHeaderH: 60,   // global site header above the game area
  headerH: 40,       // in-game top bar (name left, balance right)
  feedW: 400,        // bet feed sidebar, full height, edge-flush
  historyH: 34,      // round-history strip row
  canvasRadius: 16,  // arena card corner radius
  bottomH: 185,      // bottom bet-bay section (min height)
  bayW: 500,         // single centered bet bay width
  demoBarH: 22,      // golden DEMO MODE strip inside the arena card
}
