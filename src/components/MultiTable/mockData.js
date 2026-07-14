// #41 多桌专区 —— 全部假数据集中此文件（期号 / 倒计时 / 相位 / 开奖大数字 / 迷你路珠 /
// 盘口全量分组 / 在线人数 / 筹码档）。单3 换真数据只动这里，UI 组件零改。
//
// 铁律：本文件零请求零逻辑，纯静态常量。游戏名/场馆/backendId 一律从 GAME_REGISTRY 读，禁手抄。
// 盘口分组的「组名 / 键名」严格抄各 games/*.jsx 真实 MARKETS 的 key 分组，赔率用假值（静态）。
import { GAME_BY_ID } from '../../gameRegistry'

// —— 左栏分组（款序照 #41 指定：竞速PK 2 + 轮次彩 5 + 对决 2 = 9 款；不含 RollingBall）——
export const RAIL_GROUPS = [
  { key: 'pk',    label: '竞速PK', ids: ['GoldenBoot', 'SpeedGrid'] },
  { key: 'lotto', label: '轮次彩', ids: ['HalfTime', 'NumberUp', 'HatTrick', 'WuXing', 'LineUp'] },
  { key: 'duel',  label: '对决',   ids: ['DerbyDay', 'DominoDuel'] },
]

// 「我的最爱」占位：假收藏 2 款（★），静态不做折叠；日后接大厅收藏
export const FAV_IDS = ['WuXing', 'DerbyDay']

export const ALL_TABLE_IDS = RAIL_GROUPS.flatMap(g => g.ids)     // 9 款全集
export const CATALOG = ALL_TABLE_IDS                             // #2.3 目录 = 9 款
export const DEFAULT_TABLES = CATALOG.slice(0, 4)               // 默认前 4 款上桌
export const CHIP_VALUES = [1, 5, 10, 50]
export const ONLINE_COUNT = 914

// 名字/场馆/后端 id 单一出处：读 GAME_REGISTRY，禁在本文件手抄
export const nameOf   = (id) => GAME_BY_ID[id]?.displayName ?? id
export const venueOf  = (id) => GAME_BY_ID[id]?.venue ?? ''
export const backendOf = (id) => GAME_BY_ID[id]?.backendId ?? id

// 期号（假）：<BACKEND大写>-20260714-NNNN（末段 4 位供 #NNNN 显示，完整值留 title）
export const mockRoundNo = (id) => `${backendOf(id).toUpperCase()}-20260714-${MOCK[id].seq}`

// 迷你路珠 tone → 语义：up=大/红/主 · down=小/黑/客 · tie=和/豹（颜色在组件里查 MULTI_DARK）
const bead = (t, tone) => ({ t, tone })

// —— 每桌假数据（相位人工铺 betting/locked/drawing 三态混样，验相位色全走通）——
export const MOCK = {
  GoldenBoot: {
    seq: '0342', cd: '0:18', phase: 'betting', draw: '7',
    beads: [bead('大', 'up'), bead('小', 'down'), bead('大', 'up'), bead('单', 'up'), bead('双', 'down'), bead('小', 'down'), bead('大', 'up'), bead('小', 'down')],
  },
  SpeedGrid: {
    seq: '1187', cd: '0:05', phase: 'locked', draw: '14',
    beads: [bead('红', 'up'), bead('黑', 'down'), bead('红', 'up'), bead('红', 'up'), bead('黑', 'down'), bead('黑', 'down'), bead('红', 'up'), bead('黑', 'down')],
  },
  HalfTime: {
    seq: '0908', cd: '—', phase: 'drawing', draw: '827',
    beads: [bead('大', 'up'), bead('大', 'up'), bead('小', 'down'), bead('单', 'up'), bead('小', 'down'), bead('双', 'down'), bead('大', 'up'), bead('大', 'up')],
  },
  NumberUp: {
    seq: '2231', cd: '0:24', phase: 'betting', draw: '37',
    beads: [bead('高', 'up'), bead('低', 'down'), bead('低', 'down'), bead('高', 'up'), bead('单', 'up'), bead('双', 'down'), bead('低', 'down'), bead('高', 'up')],
  },
  HatTrick: {
    seq: '0455', cd: '0:12', phase: 'betting', draw: '11',
    beads: [bead('大', 'up'), bead('小', 'down'), bead('豹', 'tie'), bead('小', 'down'), bead('大', 'up'), bead('单', 'up'), bead('双', 'down'), bead('大', 'up')],
  },
  WuXing: {
    seq: '1620', cd: '0:31', phase: 'betting', draw: '843',
    beads: [bead('龙', 'up'), bead('虎', 'down'), bead('和', 'tie'), bead('龙', 'up'), bead('龙', 'up'), bead('虎', 'down'), bead('虎', 'down'), bead('龙', 'up')],
  },
  LineUp: {
    seq: '0777', cd: '0:09', phase: 'locked', draw: '118',
    beads: [bead('大', 'up'), bead('大', 'up'), bead('小', 'down'), bead('小', 'down'), bead('单', 'up'), bead('大', 'up'), bead('双', 'down'), bead('小', 'down')],
  },
  DerbyDay: {
    seq: '1342', cd: '0:20', phase: 'betting', draw: '2–1',
    beads: [bead('主', 'up'), bead('客', 'down'), bead('和', 'tie'), bead('主', 'up'), bead('主', 'up'), bead('客', 'down'), bead('主', 'up'), bead('和', 'tie')],
  },
  DominoDuel: {
    seq: '0613', cd: '—', phase: 'drawing', draw: '3–2',
    beads: [bead('主', 'up'), bead('主', 'up'), bead('客', 'down'), bead('和', 'tie'), bead('客', 'down'), bead('主', 'up'), bead('客', 'down'), bead('主', 'up')],
  },
}

// ============================================================================
// 盘口全量分组 —— 组名/键名抄各 games/*.jsx 真实 MARKETS，赔率假值（静态）。
//   每组 { group:'组名', grid?:true(直选大阵网格化), keys:[{key,label,odds}] }
//   桌卡默认只展开第一组（主盘），其余收起；grid 组（大阵）默认必收。
// ============================================================================
const k = (key, label, odds) => ({ key, label, odds })
const seqn = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const pad2 = (n) => String(n).padStart(2, '0')

// 各款真实 ODDS 数值（照抄，静态）
const GB_SUM_N = { 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3, 9: 4, 10: 4, 11: 5, 12: 4, 13: 4, 14: 3, 15: 3, 16: 2, 17: 2, 18: 1, 19: 1 }
const gbSum = (s) => (Math.round((0.955 * 45 / GB_SUM_N[s]) * 100) / 100).toFixed(2)
const HT_TOTAL = { 4: 68.76, 5: 34.38, 6: 20.63, 7: 13.75, 8: 9.82, 9: 8.25, 10: 7.64, 11: 7.64, 12: 8.25, 13: 9.82, 14: 13.75, 15: 20.63, 16: 34.38, 17: 68.76 }
const CS_ODDS = { '1-0': 94.69, '2-1': 92.23, '3-1': 90.32, '0-0': 97.93, '1-1': 88.08, '2-2': 92.67, '0-1': 94.69, '1-2': 92.23, '1-3': 90.32 }
const LU_ROW = [['big', '大'], ['small', '小'], ['odd', '单'], ['even', '双'], ['home', '主'], ['away', '客']]

const MK = {
  GoldenBoot: [
    { group: '冠亚和·大小单双', keys: [k('s-big', '大', '2.15'), k('s-small', '小', '1.72'), k('s-odd', '单', '1.72'), k('s-even', '双', '2.15')] },
    { group: '冠军名次', grid: true, keys: seqn(1, 10).map(n => k(`w-${n}`, `${n}号`, '9.60')) },
    { group: '冠亚和值', grid: true, keys: Object.keys(GB_SUM_N).map(Number).map(s => k(`sum-${s}`, `${s}`, gbSum(s))) },
  ],
  SpeedGrid: [
    { group: '大小单双红黑', keys: [k('big', '大', '1.95'), k('small', '小', '1.95'), k('odd', '单', '1.95'), k('even', '双', '1.95'), k('red', '红', '1.95'), k('black', '黑', '1.95')] },
    { group: '三段', keys: [k('grid-front', '头排', '2.90'), k('grid-mid', '中段', '2.90'), k('grid-rear', '尾排', '2.90')] },
    { group: '车队', keys: seqn(1, 4).map(t => k(`team-${t}`, `${['一', '二', '三', '四'][t - 1]}队`, '3.85')) },
    { group: '车号直选', grid: true, keys: seqn(1, 24).map(n => k(`car-${n}`, `${n}`, '22.85')) },
  ],
  HalfTime: [
    { group: '大小单双', keys: [k('over', '大', '1.95'), k('under', '小', '1.92'), k('odd', '单', '1.95'), k('even', '双', '1.95')] },
    { group: '过关', keys: [k('p-oo', '大单', '3.80'), k('p-oe', '大双', '3.80'), k('p-uo', '小单', '3.80'), k('p-ue', '小双', '3.80')] },
    { group: '段位', keys: [k('og', '乌龙', '9.25'), k('df', '后防', '4.70'), k('mf', '中场', '2.46'), k('at', '前锋', '4.70'), k('gl', '破门', '9.25')] },
    { group: '半场', keys: [k('h1', '上半', '2.40'), k('draw', '半场平', '4.70'), k('h2', '下半', '2.40')] },
  ],
  NumberUp: [
    { group: '大小单双高低', keys: [k('s-high', '高', '1.91'), k('s-low', '低', '1.91'), k('s-odd', '单', '1.91'), k('s-even', '双', '1.91')] },
    { group: '首位', keys: seqn(0, 4).map(d => k(`fd-${d}`, `首${d}`, '4.75')) },
    { group: '尾位', grid: true, keys: seqn(0, 9).map(d => k(`ld-${d}`, `尾${d}`, '9.50')) },
    { group: '直选', grid: true, keys: seqn(0, 49).map(n => k(`n-${pad2(n)}`, pad2(n), '47.50')) },
  ],
  HatTrick: [
    { group: '大小单双', keys: [k('s-big', '大', '1.96'), k('s-small', '小', '1.96'), k('s-odd', '单', '1.96'), k('s-even', '双', '1.96')] },
    { group: '和值', grid: true, keys: seqn(4, 17).map(s => k(`t-${s}`, `${s}`, HT_TOTAL[s].toFixed(2))) },
    { group: '豹子', grid: true, keys: [k('tr-any', '任意豹', '34.38'), ...seqn(1, 6).map(v => k(`tr-${v}`, `三${v}`, '206.28'))] },
    { group: '对子', grid: true, keys: seqn(1, 6).map(v => k(`d-${v}`, `对${v}`, '12.89')) },
  ],
  WuXing: [
    { group: '大小单双', keys: [k('big', '大', '1.95'), k('small', '小', '1.92'), k('odd', '单', '1.95'), k('even', '双', '1.95')] },
    { group: '龙虎', keys: [k('dragon', '龙', '2.13'), k('dt-tie', '龙虎和', '9.55'), k('tiger', '虎', '2.13')] },
    { group: '上下', keys: [k('up', '上', '2.40'), k('ud-tie', '上下和', '4.70'), k('down', '下', '2.40')] },
    { group: '过关', keys: [k('big-odd', '大单', '3.82'), k('small-odd', '小单', '3.82'), k('big-even', '大双', '3.82'), k('small-even', '小双', '3.82')] },
    { group: '五行段位', keys: [k('wx-gold', '金', '9.35'), k('wx-wood', '木', '4.72'), k('wx-water', '水', '2.46'), k('wx-fire', '火', '4.72'), k('wx-earth', '土', '9.10')] },
  ],
  LineUp: [
    { group: '总盘·大小单双', keys: [k('big', '大', '1.95'), k('small', '小', '1.95'), k('odd', '单', '1.95'), k('even', '双', '1.95')] },
    { group: '红黄·高低', keys: [k('home-more', '红牌多', '1.95'), k('away-more', '黄牌多', '1.95'), k('high', '高', '1.95'), k('low', '低', '1.95')] },
    { group: '段位', keys: [k('zone-releg', '降级区', '8.00'), k('zone-mid', '中游', '2.50'), k('zone-euro', '欧战区', '2.50'), k('zone-champ', '夺冠', '8.00')] },
    { group: '行式盘', grid: true, keys: seqn(1, 5).flatMap(i => LU_ROW.map(([sfx, lab]) => k(`L${i}-${sfx}`, `L${i}${lab}`, '1.95'))) },
  ],
  DerbyDay: [
    { group: '胜负', keys: [k('ht-home', '半主胜', '1.95'), k('ht-away', '半客胜', '1.95'), k('ft-home', '全主胜', '1.95'), k('ft-away', '全客胜', '1.95')] },
    { group: '半场大小单双', keys: [k('ht-big', '半大', '1.95'), k('ht-small', '半小', '1.92'), k('ht-odd', '半单', '1.95'), k('ht-even', '半双', '1.95')] },
    { group: '全场大小单双', keys: [k('ft-big', '全大', '1.95'), k('ft-small', '全小', '1.92'), k('ft-odd', '全单', '1.95'), k('ft-even', '全双', '1.95')] },
    { group: '半全场', keys: [k('ht-ft-hh', '主主', '2.65'), k('ht-ft-ha', '主客', '7.10'), k('ht-ft-ah', '客主', '7.10'), k('ht-ft-aa', '客客', '2.65')] },
  ],
  DominoDuel: [
    { group: '主客走势', keys: [k('home-win', '主胜', '1.90'), k('draw', '平局', '9.38'), k('away-win', '客胜', '1.90')] },
    { group: '总进球', keys: [k('g-big', '进球大', '1.74'), k('g-small', '进球小', '2.11'), k('g-odd', '进球单', '1.91'), k('g-even', '进球双', '1.91')] },
    { group: '主队总分', keys: [k('h-big', '主大', '1.92'), k('h-small', '主小', '1.90'), k('h-odd', '主单', '1.88'), k('h-even', '主双', '1.94')] },
    { group: '客队总分', keys: [k('a-big', '客大', '1.92'), k('a-small', '客小', '1.90'), k('a-odd', '客单', '1.88'), k('a-even', '客双', '1.94')] },
    { group: '正确比分·波胆', grid: true, keys: Object.entries(CS_ODDS).map(([sc, o]) => k(`cs-${sc}`, sc, o.toFixed(2))) },
  ],
}

// 盘口分组挂回 MOCK（单一构造出处）
Object.keys(MK).forEach((id) => { if (MOCK[id]) MOCK[id].markets = MK[id] })
