// #41 单16：DerbyDay 盘面数据（纯常量，零 React）——从 DerbyDay.jsx 机械切片。
// DerbyDayMarkets.jsx（渲染）+ DerbyDay.jsx（手机手风琴 accSection 标题）共用，single source。
// 赔率一律读 markets/derbyday 的 MARKETS[key].odds / ODDS（禁二份表），此处仅键/名称/区间/分组。

// ---- 盘区两组（队色语义格；big/small 区间展示文案照原页）----
export const GROUPS = [
  { key: 'ht', label: '实况 · 半场', big: '811–960', small: '661–810' },
  { key: 'ft', label: '实况 · 全场', big: '1621–1920', small: '1322–1620' },
]

// ---- 半全场组合盘四键（半场胜方 / 全场胜方）----
export const HTFT = [
  { key: 'ht-ft-hh', a: '主', b: '主' },
  { key: 'ht-ft-ha', a: '主', b: '客' },
  { key: 'ht-ft-ah', a: '客', b: '主' },
  { key: 'ht-ft-aa', a: '客', b: '客' },
]
