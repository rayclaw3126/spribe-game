// #41 单15：HalfTime 盘面数据（纯常量，零 React）——从 HalfTime.jsx 机械切片。
// HalfTimeMarkets.jsx（渲染）+ HalfTime.jsx（手机手风琴 selCount 的 SEC_KEYS）共用，single source。
// 赔率一律读 markets/halftime 的 MARKETS[key].odds（禁二份表），此处仅名称/区间/分组。

// ---- 盘面（名称/区间展示）----
export const ROW1 = [
  { key: 'over',  name: '大', range: '811–1410' },
  { key: 'under', name: '小', range: '210–810' },
  { key: 'odd',   name: '单', range: '和值为单' },
  { key: 'even',  name: '双', range: '和值为双' },
]
export const PARLAY = [
  { key: 'p-oo', name: '大单' },
  { key: 'p-oe', name: '大双' },
  { key: 'p-uo', name: '小单' },
  { key: 'p-ue', name: '小双' },
]
export const ZONES = [
  { key: 'og', name: '乌龙', range: '210–695' },
  { key: 'df', name: '后防', range: '696–763' },
  { key: 'mf', name: '中场', range: '764–855' },
  { key: 'at', name: '前锋', range: '856–923' },
  { key: 'gl', name: '破门', range: '924–1410' },
]
export const ROW3 = [
  { key: 'h1',   name: '上半场', range: '1-40 多' },
  { key: 'draw', name: '平',     range: '10:10' },
  { key: 'h2',   name: '下半场', range: '41-80 多' },
]
// 三段分组（原页手机手风琴 m1/m2/m3 = 桌面 行①②③）+ 中文组名（照手机手风琴标题，禁造英文）
export const GROUPS = [
  { id: 'm1', title: '大小 · 单双 · 过关' },
  { id: 'm2', title: '球场五段' },
  { id: 'm3', title: '半场' },
]
// 段位 key 集（原页手机手风琴 selCount 用；单一出处）
export const SEC_KEYS = {
  m1: new Set([...ROW1, ...PARLAY].map(m => m.key)),
  m2: new Set(ZONES.map(m => m.key)),
  m3: new Set(ROW3.map(m => m.key)),
}
