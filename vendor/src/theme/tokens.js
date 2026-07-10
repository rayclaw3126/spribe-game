// 后台设计 token —— 颜色全部取自游戏前端 src/components/shell/tokens.js
// （深色专业风，禁止自造 hex）。圆角/间距按后台"克制、Linear/Stripe 风"单独收紧，
// 不沿用游戏侧的大圆角(12-16px)。

export const COLORS = {
  bg: '#0a1119',        // = 游戏 COLORS.bg
  panel: '#101923',     // = 游戏 COLORS.panel
  surface: '#1a2230',   // = 游戏 COLORS.surface
  border: '#232c39',    // = 游戏 COLORS.border
  borderLight: '#243142', // = 游戏 COLORS.borderLight
  text: '#e8edf2',       // = 游戏 COLORS.text
  textMuted: '#8a97a6',  // = 游戏 COLORS.textMuted
  textFaint: '#7d8a99',  // = 游戏 COLORS.textFaint

  primary: '#2f6fe0',        // = 游戏内多处共享的 round-button 蓝(HOTLINE.blue 等家族)
  primarySoft: 'rgba(47,111,224,0.16)',
  primaryBorder: 'rgba(47,111,224,0.45)',

  success: '#16C784',        // = 游戏 COLORS.green
  successTint: 'rgba(93,202,165,0.16)', // = 游戏 COLORS.greenTint

  warning: '#F5A623',        // = 游戏 COLORS.amber
  warningTint: 'rgba(245,166,35,0.18)', // = 游戏 COLORS.amberTint

  danger: '#e2564a',         // = 游戏共享 "crash red"（NUMBERUP.hi 等）
  dangerTint: 'rgba(226,86,74,0.16)',

  slate: '#8fa3b8',           // = 游戏 COLORS.slate
  white: '#ffffff',
}

export const RADIUS = {
  sm: 6,
  md: 8,
  lg: 10,
  pill: 999,
}

export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
}

export const LAYOUT = {
  sidebarW: 232,
  headerH: 56,
  breakpoint: 900,
}
