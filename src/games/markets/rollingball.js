// #公期化 单4 (a)：RollingBall 引擎块（RED/GROUPS/COMBO/COMBO_C/R_* + drawThree/hitOf/oddsFor/isValidKey
// 等纯数据纯函数，零 React 依赖）—— 从 src/games/RollingBall.jsx 顶部【机械剪切】至此，数值/逻辑零改。
//
// 为什么必须搬：多桌（marketsUiRegistry / RollingBallMarkets / RollingBallRoad）要用 hitOf/oddsFor
//   判死键与路珠归类；若从 games/RollingBall.jsx 取，打包器会把整页 40KB chunk 拖进多桌包，
//   破坏 code-split（其余 9 款一律从 src/games/markets/*.js 取，本文件对齐同一约定）。
// 原 .jsx import 回用 + re-export 保外部引用（实测全仓零外部 import，re-export 只作保守兜底）；
//   window.__RB 对账钩子随本模块加载挂载，行为不变。
//
// ⚠ 埋尸点铁律（原页注释原样保留）：GROUPS / COMBO / COMBO_C / R 锚值 / oddsFor 公式 / hitOf
//   与后端 server/src/game/rollingBall.js 逐位同源，改一处必须改两处，一个数都别动别重算。
import { DERBY } from '../../components/shell/tokens'
import { ROLLINGBALL_LABEL as RL } from '../../lib/betKeyLabels'   // 档位中文名单一出处

// 组合四键元数据（ROAD_VIEWS 的 combo 视角与原页 comboBoard 共用；随引擎一并搬家，禁二份）
export const COMBO_META = [
  { slot: 'big-odd', name: RL['big-odd'] }, { slot: 'small-odd', name: RL['small-odd'] },
  { slot: 'big-even', name: RL['big-even'] }, { slot: 'small-even', name: RL['small-even'] },
]

// ---------- 引擎（纯函数区，禁副作用）----------
const RED = new Set(Array.from({ length: 75 }, (_, i) => i + 1).filter(n => ((n - 1) % 4) < 2))
const isRed = n => RED.has(n)
const round2 = x => Math.round(x * 100) / 100

// 开奖：1-75 无放回抽 3（同局不重复）；rng 可注入
export function drawThree(rng = Math.random) {
  const pool = Array.from({ length: 75 }, (_, i) => i + 1)
  for (let k = 0; k < 3; k++) {
    const j = k + Math.floor(rng() * (75 - k))
    ;[pool[k], pool[j]] = [pool[j], pool[k]]
  }
  return pool.slice(0, 3)
}

// 组盘（固定 R）：初始计数 c、命中函数、R
// 行注三档 hit 区块为占位假设（规则页登录墙后无源）：t1=1-5 / t3=6-20 / t5=21-45，
// 计数 5/15/25 与官方一致 → RTP 计数驱动正确；具体命中号待规则页核（X3）。
const R_BS = 0.972   // 大小/单双/红蓝统一 R（37 计数侧 1.98→1.97，溢出修掉）
const GROUPS = {
  big: { c: 38, R: R_BS, hit: n => n >= 38 },
  small: { c: 37, R: R_BS, hit: n => n <= 37 },
  odd: { c: 38, R: R_BS, hit: n => n % 2 === 1 },
  even: { c: 37, R: R_BS, hit: n => n % 2 === 0 },
  red: { c: 38, R: R_BS, hit: isRed },
  blue: { c: 37, R: R_BS, hit: n => !isRed(n) },
  'row-t1': { c: 5, R: 14.28 * 5 / 75, hit: n => n >= 1 && n <= 5 },
  'row-t3': { c: 15, R: 4.76 * 15 / 75, hit: n => n >= 6 && n <= 20 },
  'row-t5': { c: 25, R: 2.85 * 25 / 75, hit: n => n >= 21 && n <= 45 },
}
for (let col = 1; col <= 5; col++) {
  GROUPS[`col-${col}`] = { c: 15, R: 4.76 * 15 / 75, hit: n => (n - 1) % 5 === col - 1 }
}
// 组合：独立 R（弃候选A乘积）。c_combo = 剩余池里同时满足两侧的号数
const COMBO = {
  'big-odd': ['big', 'odd'], 'small-odd': ['small', 'odd'],
  'big-even': ['big', 'even'], 'small-even': ['small', 'even'],
}
const R_COMBO = 0.955
const comboHit = (key, n) => COMBO[key].every(s => GROUPS[s].hit(n))
// 组合初始计数（大单/小单/大双=19，小双=18：38 为偶数落大侧）
const COMBO_C = Object.fromEntries(Object.keys(COMBO).map(k =>
  [k, Array.from({ length: 75 }, (_, i) => i + 1).filter(n => comboHit(k, n)).length]))
const R_SINGLE = 0.9523

// 珠盘路视角：从整局 3 球号码派生。判定全走引擎 helper（GROUPS.hit / isRed），禁手写第二份表。
// 每视角 judge(号码) → { t: 单字, red: 是否红色珠 }（珠子红蓝双色 + 单字，沿用现有样式）。
// #47 收官·路珠 8 路（桌手【单一出处】，桌面 pill 与手机 pill 同吃这一份）。
// 判定一律走引擎现成口径：GROUPS / COMBO / isRed / col-N / row-t*，禁在此另写第二份表。
//
// ⚠ 一局落 3 颗（第1/2/3球顺序入列）：本款【不存在整局结算维度】—— 唯一判定入口
//   hitOf(key, n) 只吃单个球号，组合/列注/行注同样是逐球（col-N 是 (n-1)%5、
//   row-t* 是号段 1-5 / 6-20 / 21-45），故 8 条路语义统一，无特例分支。
// ⚠ 行注天生有第 4 态：三档号段只覆盖 1-45，46-75 一档不沾 → 判「无」，
//   按定案给中性灰珠显「无」，【不留空格】（空格会被读成「这局没开过」）。
const ROAD_PAL = ['#e2564a', '#2563c9', '#35d07f', '#f28c17', '#7C3AED', '#0891B2', '#CA8A04', '#DB2777', '#16A34A', '#64748b']
const ROAD_NONE = '#5b6472'   // 中性灰（比空格底色亮，与 DERBY.grey 深底可辨）

// 双色路的公共构造：命中走 away 红、否则 home 蓝（与盘口键配色同源）
const duo = (onKey, onText, offText) => (n) => (
  GROUPS[onKey].hit(n) ? { t: onText, c: DERBY.away } : { t: offText, c: DERBY.home }
)
const ROAD_VIEWS = [
  { key: 'bs', label: '大小', judge: duo('big', '大', '小') },
  { key: 'oe', label: '单双', judge: duo('odd', '单', '双') },
  { key: 'rb', label: '红蓝', judge: (n) => (isRed(n) ? { t: '红', c: DERBY.away } : { t: '蓝', c: DERBY.home }) },
  {
    key: 'combo', label: '组合',
    judge: (n) => {
      // 走 COMBO 表 + hitOf 同款 every 口径；四组互斥必中其一
      const k = COMBO_META.find((m) => COMBO[m.slot].every((g) => GROUPS[g].hit(n)))
      return { t: k ? RL[k.slot] : '—', c: k ? ROAD_PAL[COMBO_META.indexOf(k)] : ROAD_NONE }
    },
  },
  {
    key: 'col', label: '列注',
    judge: (n) => {
      const c = [1, 2, 3, 4, 5].find((i) => GROUPS[`col-${i}`].hit(n))
      return { t: c ? String(c) : '—', c: c ? ROAD_PAL[c - 1] : ROAD_NONE }
    },
  },
  {
    key: 'row', label: '行注',
    judge: (n) => {
      // ⚠ 第 4 态「无」：row-t1/t3/t5 只覆盖 1-45，46-75 全部落此态（约四成球）
      const t = ['row-t1', 'row-t3', 'row-t5'].find((k) => GROUPS[k].hit(n))
      if (!t) return { t: '无', c: ROAD_NONE }
      return { t: t.slice(-1), c: ROAD_PAL[['row-t1', 'row-t3', 'row-t5'].indexOf(t)] }
    },
  },
  { key: 'nhi', label: '首位', judge: (n) => ({ t: String(Math.floor(n / 10)), c: ROAD_PAL[Math.floor(n / 10) % ROAD_PAL.length] }) },
  { key: 'nlo', label: '尾数', judge: (n) => ({ t: String(n % 10), c: ROAD_PAL[(n % 10) % ROAD_PAL.length] }) },
]

// 整局 [b1,b2,b3] 展开成 3 颗珠（顺序入列）；road 全量展开即该视角的珠序列。
// ⚠ 展开必须在【过窗口之前】：roadWindow 是按「珠」算整列滑动的，喂局数会算错相位。
function roadBeadsOf(view, rounds) {
  const out = []
  for (const balls of rounds) {
    if (!Array.isArray(balls)) continue
    for (const n of balls) if (n != null) out.push(view.judge(n))
  }
  return out
}

// 命中判定（单个球号 n）
export function hitOf(key, n) {
  if (key.startsWith('num-')) return n === Number(key.slice(4))
  if (COMBO[key]) return COMBO[key].every(s => GROUPS[s].hit(n))
  return GROUPS[key].hit(n)
}

// 动态赔率：第 ballIdx 球（0-2），revealed = 本球开出前已开号数组
export function oddsFor(key, ballIdx, revealed) {
  const pool = 75 - ballIdx   // 76 − k（k = ballIdx+1）
  if (COMBO[key]) {
    const c = COMBO_C[key] - revealed.filter(n => comboHit(key, n)).length
    if (c <= 0) return null
    return round2(R_COMBO * pool / c)
  }
  if (key.startsWith('num-')) {
    const N = Number(key.slice(4))
    if (revealed.includes(N)) return null   // 已开出 → 该球不可押（无放回）
    return round2(R_SINGLE * pool)
  }
  const g = GROUPS[key]
  const c = g.c - revealed.filter(g.hit).length
  if (c <= 0) return null
  return round2(g.R * pool / c)
}

// dev 钩子：RTP 模拟/对账从浏览器直接调；__RB_FORCE 注入固定 3 球
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__RB = { drawThree, oddsFor, hitOf, GROUPS, COMBO, isRed }
}

// 对外导出面（原页与多桌共用同一份；禁在调用方重算/重抄）
export { RED, isRed, round2, GROUPS, COMBO, COMBO_C, R_BS, R_COMBO, R_SINGLE, comboHit, ROAD_PAL, ROAD_NONE, ROAD_VIEWS, roadBeadsOf }
