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

  // Bet feed
  feedLive: '#facc15',
  feedWin: '#86efac',
  feedLose: '#5b6878',
  feedYouBg: 'rgba(22,199,132,0.14)',
  feedYouBorder: 'rgba(22,199,132,0.45)',
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
