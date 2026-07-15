// #41 多桌专区 —— 结构/标签数据 + 少量假值。
// 单3 起接活：期号/相位/倒计时/开奖/路珠全走 useRoundRoom + /round/history（见 TableCard/GameRail）；
// 盘口赔率走 markets/<be>.js（见 marketsRegistry）。本文件只留：
//   · 结构：分组/收藏/目录/默认桌/名字场馆映射（读 GAME_REGISTRY）
//   · 盘口「组名 + 键名 + 中文 label」（label 映射留 UI 层；odds 不在此，改读 MARKETS）
//   · 纯假值：CHIP_VALUES（筹码档）/ ONLINE_COUNT（在线数）
import { GAME_BY_ID } from '../../gameRegistry'

// —— 左栏分组（款序照 #41 指定：竞速PK 2 + 轮次彩 5 + 对决 2 = 9 款；不含 RollingBall）——
export const RAIL_GROUPS = [
  { key: 'pk',    label: '竞速PK', ids: ['GoldenBoot', 'SpeedGrid'] },
  { key: 'lotto', label: '轮次彩', ids: ['HalfTime', 'NumberUp', 'HatTrick', 'WuXing', 'LineUp'] },
  { key: 'duel',  label: '对决',   ids: ['DerbyDay', 'DominoDuel'] },
]

// 「我的最爱」：#44 已接大厅真收藏——收藏源由 App 的 favIds 经 props 下发（前端 id），
// GameRail 内取 favIds ∩ ALL_TABLE_IDS 渲染（街机收藏不在多桌 9 款内自动滤掉）；本文件不再存占位。

export const ALL_TABLE_IDS = RAIL_GROUPS.flatMap(g => g.ids)     // 9 款全集
export const CATALOG = ALL_TABLE_IDS                             // 目录 = 9 款
export const DEFAULT_TABLES = CATALOG.slice(0, 4)               // 默认前 4 款上桌
export const CHIP_VALUES = [1, 5, 10, 50]                       // 纯假值：筹码档
export const ONLINE_COUNT = 914                                // 纯假值：在线数

// 名字/场馆/后端 id 单一出处：读 GAME_REGISTRY，禁在本文件手抄
export const nameOf   = (id) => GAME_BY_ID[id]?.displayName ?? id
export const venueOf  = (id) => GAME_BY_ID[id]?.venue ?? ''
export const backendOf = (id) => GAME_BY_ID[id]?.backendId ?? id
export const coverOf  = (id) => GAME_BY_ID[id]?.cover ?? null   // 大厅封面图（战绩卡底图）

// 后端 backendId → 展示名（广播条目按 backendId 下发，前端反查显示名；未知回原值）
const NAME_BY_BACKEND = Object.fromEntries(Object.values(GAME_BY_ID).map(g => [g.backendId, g.displayName]))
export const nameOfBackend = (be) => NAME_BY_BACKEND[be] ?? be

// ============================================================================
// 盘口全量分组 —— 组名/键名严格抄各 games/markets/<be>.js 真实 MARKETS，中文 label 映射留本层。
//   赔率 odds 不在此：改读 marketsRegistry.oddsStr(id, key)（MARKETS[key].odds）。
//   每组 { group:'组名', grid?:true(直选大阵网格化), keys:[{key,label}] }
//   桌卡默认只展开第一组（主盘），其余收起；grid 组（大阵）默认必收。
// ============================================================================
const k = (key, label) => ({ key, label })
const seqn = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const pad2 = (n) => String(n).padStart(2, '0')
const LU_ROW = [['big', '大'], ['small', '小'], ['odd', '单'], ['even', '双'], ['home', '主'], ['away', '客']]
const CS_SCORES = ['1-0', '2-1', '3-1', '0-0', '1-1', '2-2', '0-1', '1-2', '1-3']

// cols：非 grid 组的成对排位列数。2=二元对立盘(大|小 / 单|双 / 红|黑 / 高|低)成对同排；
// 3=三向盘(主|和|客 / 龙|和|虎 / 上|和|下)一排；key 序即左→右，已按对子相邻排好。grid 组无 cols（走大阵网格）。
export const MARKET_GROUPS = {
  GoldenBoot: [
    { group: '冠亚和·大小单双', cols: 2, keys: [k('s-big', '大'), k('s-small', '小'), k('s-odd', '单'), k('s-even', '双')] },
    { group: '冠军名次', grid: true, keys: seqn(1, 10).map(n => k(`w-${n}`, `${n}号`)) },
    { group: '冠亚和值', grid: true, keys: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(s => k(`sum-${s}`, `${s}`)) },
  ],
  SpeedGrid: [
    { group: '大小单双红黑', cols: 2, keys: [k('big', '大'), k('small', '小'), k('odd', '单'), k('even', '双'), k('red', '红'), k('black', '黑')] },
    { group: '三段', cols: 3, keys: [k('grid-front', '头排'), k('grid-mid', '中段'), k('grid-rear', '尾排')] },
    { group: '车队', cols: 2, keys: seqn(1, 4).map(t => k(`team-${t}`, `${['蓝', '红', '金', '黑'][t - 1]}队`)) },
    { group: '车号直选', grid: true, keys: seqn(1, 24).map(n => k(`car-${n}`, `${n}`)) },
  ],
  HalfTime: [
    { group: '大小单双', cols: 2, keys: [k('over', '大'), k('under', '小'), k('odd', '单'), k('even', '双')] },
    { group: '过关', cols: 2, keys: [k('p-oo', '大单'), k('p-oe', '大双'), k('p-uo', '小单'), k('p-ue', '小双')] },
    { group: '段位', cols: 3, keys: [k('og', '乌龙'), k('df', '后防'), k('mf', '中场'), k('at', '前锋'), k('gl', '破门')] },
    { group: '半场', cols: 3, keys: [k('h1', '上半'), k('draw', '半场平'), k('h2', '下半')] },
  ],
  NumberUp: [
    { group: '大小单双', cols: 2, keys: [k('s-high', '大'), k('s-low', '小'), k('s-odd', '单'), k('s-even', '双')] },
    { group: '首位', cols: 3, keys: seqn(0, 4).map(d => k(`fd-${d}`, `首${d}`)) },
    { group: '尾位', grid: true, keys: seqn(0, 9).map(d => k(`ld-${d}`, `尾${d}`)) },
    { group: '直选', grid: true, keys: seqn(0, 49).map(n => k(`n-${pad2(n)}`, pad2(n))) },
  ],
  HatTrick: [
    { group: '大小单双', cols: 2, keys: [k('s-big', '大'), k('s-small', '小'), k('s-odd', '单'), k('s-even', '双')] },
    { group: '和值', grid: true, keys: seqn(4, 17).map(s => k(`t-${s}`, `${s}`)) },
    { group: '豹子', grid: true, keys: [k('tr-any', '任意豹'), ...seqn(1, 6).map(v => k(`tr-${v}`, `三${v}`))] },
    { group: '对子', grid: true, keys: seqn(1, 6).map(v => k(`d-${v}`, `对${v}`)) },
  ],
  WuXing: [
    { group: '大小单双', cols: 2, keys: [k('big', '大'), k('small', '小'), k('odd', '单'), k('even', '双')] },
    { group: '龙虎', cols: 3, keys: [k('dragon', '龙'), k('dt-tie', '龙虎和'), k('tiger', '虎')] },
    { group: '上下', cols: 3, keys: [k('up', '上'), k('ud-tie', '上下和'), k('down', '下')] },
    { group: '过关', cols: 2, keys: [k('big-odd', '大单'), k('big-even', '大双'), k('small-odd', '小单'), k('small-even', '小双')] },
    { group: '五行段位', cols: 3, keys: [k('wx-gold', '金'), k('wx-wood', '木'), k('wx-water', '水'), k('wx-fire', '火'), k('wx-earth', '土')] },
  ],
  LineUp: [
    { group: '总盘·大小单双', cols: 2, keys: [k('big', '大'), k('small', '小'), k('odd', '单'), k('even', '双')] },
    { group: '红黄·高低', cols: 2, keys: [k('home-more', '黄牌多'), k('away-more', '红牌多'), k('high', '高'), k('low', '低')] },
    { group: '段位', cols: 2, keys: [k('zone-releg', '降级区'), k('zone-champ', '夺冠'), k('zone-mid', '中游'), k('zone-euro', '欧战区')] },
    { group: '行式盘', grid: true, keys: seqn(1, 5).flatMap(i => LU_ROW.map(([sfx, lab]) => k(`L${i}-${sfx}`, `L${i}${lab}`))) },
  ],
  DerbyDay: [
    { group: '胜负', cols: 2, keys: [k('ht-home', '半主胜'), k('ht-away', '半客胜'), k('ft-home', '全主胜'), k('ft-away', '全客胜')] },
    { group: '半场大小单双', cols: 2, keys: [k('ht-big', '半大'), k('ht-small', '半小'), k('ht-odd', '半单'), k('ht-even', '半双')] },
    { group: '全场大小单双', cols: 2, keys: [k('ft-big', '全大'), k('ft-small', '全小'), k('ft-odd', '全单'), k('ft-even', '全双')] },
    { group: '半全场', cols: 2, keys: [k('ht-ft-hh', '主主'), k('ht-ft-aa', '客客'), k('ht-ft-ha', '主客'), k('ht-ft-ah', '客主')] },
  ],
  DominoDuel: [
    { group: '主客走势', cols: 3, keys: [k('home-win', '主胜'), k('draw', '平局'), k('away-win', '客胜')] },
    { group: '总进球', cols: 2, keys: [k('g-big', '进球大'), k('g-small', '进球小'), k('g-odd', '进球单'), k('g-even', '进球双')] },
    { group: '主队总分', cols: 2, keys: [k('h-big', '主大'), k('h-small', '主小'), k('h-odd', '主单'), k('h-even', '主双')] },
    { group: '客队总分', cols: 2, keys: [k('a-big', '客大'), k('a-small', '客小'), k('a-odd', '客单'), k('a-even', '客双')] },
    { group: '正确比分·波胆', grid: true, keys: CS_SCORES.map(sc => k(`cs-${sc}`, sc.replace('-', ':'))) },
  ],
}
