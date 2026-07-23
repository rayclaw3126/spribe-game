import { useState, useRef, useEffect } from 'react'
import { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import CommitRevealFairness from '../components/CommitRevealFairness'
import HowToPlay from '../components/shell/HowToPlay'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'
// #公期化 单2：滚球标准房改全服公期六段制 —— 相位/期号/倒计时/球号/封盘全读服务端 WS 七帧。
import { useRoundRoom } from '../hooks/useRoundRoom'
import RollingBallPhaseBar, { PoolBadge } from './markets-ui/RollingBallPhaseBar'
import { ballWindowOf, ballKeyOf } from './markets-ui/rollingBallPhase'
import { ROLLINGBALL_LABEL as RL } from '../lib/betKeyLabels'   // #S3 档位中文名单一出处（搬家回引，视觉零变）
import { roadWindow, ROAD_FX_CSS, ROAD_FX_FRESH, ROAD_FX_NEXT , roadAnchorLeft} from './markets-ui/roadWindow'   // #47：列对齐滑动窗口 + 动效（共用）

// Rolling Ball — NUMBER GAME 连开 3 球足球滚球皮（每球 1-75，同局 3 球不重复），第 20 卡。
// X2：连开 3 球引擎 + 剩余池动态赔率 + 六段公期相位（前 19 卡无此结构）。
//   #公期化 单2：本页已从 per-player 三球流改【全服公期六段制】—— 相位/期号/倒计时/球号/封盘
//   全部读服务端 /ws/rounds 的七帧（bet1→draw1→bet2→draw2→bet3→draw3→settle），
//   本地零相位机、零本地开奖；三颗球由服务端建局时一次生成、逐帧揭示（闸1 只发已开球）。
//   动态赔率（逆向报告公式，禁改）：odds_k = round(R_key × (76-k) / c_k, 2)
//     k = 球序 1-3；c_k = 该键剩余池号码数 = 初始计数 − 已开出属该键球数。
//   R 标定（单据定稿 2026-07-06，全键入 94-97.5% 带）：单号 0.9523；
//     大小/单双/红蓝 0.972（37 计数侧 1.98→1.97，进位溢出修掉）；列注/行注 = odds₁×c₁/75；
//     组合独立 R_组合 0.955，odds_k = round(0.955×(76-k)/c_combo, 2)，
//     c_combo = 组合剩余计数（大单 = 剩余池「大且单」数）。第1球四键=3.77，
//     小双计数 18（38 偶数落大侧）→ 3.98；两者 RTP 均 ≈95.5%。
// 算钱路径（#公期化 单2 后）：confirmBets() 唯一扣注入口 —— bet 窗内即时 POST
//   /round/rollingball/bet，后端当场 debit，余额只认响应 balanceAfter；
//   赔付点在 settle 帧的 effect C，三态/派彩/余额【全认服务端 settleInfo】，前端不算钱。

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

// ---------- 轮次常量（心跳 500ms/tick）----------
const TICK_MS = 500
const BET_T = 20       // 10s 每球押注窗
const DRAW_T = 4       // 2s 开球（静态占位，开奖舞台走后续单）
const SETTLE_T = 6     // 3s 结算展示
// #47 终批·刀2：路珠升统一视觉规格 —— 列对齐滑动窗口，右端恒留 2 空列。
// 可用容量 = (30−2)×6 = 168；显示长度 L ≡ N (mod 6) 且 L ≤ 168 → 163–168 浮动。
// ⚠ B 豁免只免「真历史灌满」，不免视觉规格：数据源仍是【本人实玩累积】，珠子随开局变多。
const ROAD_CAP = 168
const DESK_ROAD = { cols: 30, rows: 6 }   // 模块级：进组件内每渲染重建
const BEADS_PER_ROUND = 3                 // #47 收官：一局落 3 颗（第1/2/3球顺序入列）
// 存储只管「局」，窗口只管「珠」：桌面满窗 168 珠 = 56 局，手机 120 珠 = 40 局，存 120 局足够两端。
const ROUND_CAP = 120

// ⚠ 手机段专用容量，钉回原值 120：手机竖版珠格走 road.slice(-CAP)[i] 从【头部】取，
//   CAP 一变手机珠子整体前移。桌面 CAP 改动不得穿到手机。
const MOBILE_ROAD_CAP = 120

// ---------- 静态种子数据 ----------
const G = GAME_BY_ID['RollingBall']

// 玩法说明文案（中文；盘口数字/号码范围照实）
const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '每期连续开出 3 个球，号码 1–75，同一期内不重复。开球前有押注窗口，你可以对多个盘口下注。每个球独立揭示、独立结算，押中即按下注时锁定的赔率赔付。',
  },
  {
    icon: '📊', title: '盘口与赔率',
    body: '· 大 / 小：大[38-75] / 小[1-37]，约 1.9 倍。\n· 单 / 双 / 红 / 蓝：按球号判定，约 1.9 倍。\n· 组合：大单 / 小单 / 大双 / 小双，约 3.8 倍。\n· 单号直选：押中开出的确切号码（1–75），约 70 倍。同一期内已开出的号码不能再押。\n· 行注：>1行[1-5] / >3行[6-20] / >5行[21-45]，押中该区间内任一号即中，赔率随覆盖范围递减（约 14 / 5 / 3 倍）。\n· 列注：按号码所在列押注，约 5 倍。',
  },
  {
    icon: '⚡', title: '动态赔率（本游戏特色）',
    body: '赔率不是固定的，会随每球开出而变化。剩余可开的号码越少，命中盘口的赔率越高。已经开出的号码会从池中移除，其单号盘口锁定不可再押。这让每一球的押注都有新的机会和赔率。',
  },
  {
    icon: '🎬', title: '开奖与结算',
    body: '每球开出后立即结算该球的盘口，赔付按你下注那一刻锁定的赔率计算（不受后续球影响）。3 球全部开完本期结束，每期独立。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '点筹码设每注金额，点盘口格下注，可同时押多个盘口。每个球都有独立的押注窗口，确认后一次扣款。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 想稳押大小单双红蓝，中奖率约一半；想搏大赔押单号或组合。\n· 越到后面的球，剩余池越小、赔率越高，可留意后续球的机会。\n· 本游戏理论返还率约 95%，属娱乐性质，理性游戏。',
  },
]
const SEED_LAST = [21, 44, 7]          // 上局回顾种子（真开奖逐期顶掉）
const EMPTY_BALLS = []                 // #公期化 单2：稳定引用，避免每渲染造新数组触发下游 effect
// 珠盘路种子：整局 3 球号码形态（每局 3 个互不相同的 1-75，符合无放回），首屏各视角即有料。
const SEED_ROAD = [
  [42, 17, 63], [8, 51, 29], [70, 34, 5], [23, 68, 11], [56, 2, 39],
  [14, 47, 72], [61, 26, 9], [33, 50, 18], [7, 44, 65], [40, 21, 58],
  [3, 69, 36], [52, 15, 28], [66, 10, 45], [19, 60, 31], [48, 6, 73],
  [27, 54, 12], [71, 38, 1], [16, 43, 62], [35, 20, 57], [4, 67, 30],
  [59, 22, 46], [13, 49, 74], [64, 37, 25], [41, 24, 55],
]

// 盘面玩法元数据（名/区间/底色；赔率运行时动态取）
const MAIN = [
  { slot: 'big', name: RL.big, range: '38-75', bg: DERBY.grey },
  { slot: 'small', name: RL.small, range: '1-37', bg: DERBY.grey },
]
const OE = [
  { slot: 'odd', name: RL.odd, range: '球号单', bg: DERBY.grey },
  { slot: 'even', name: RL.even, range: '球号双', bg: DERBY.grey },
]
const RB = [
  { slot: 'red', name: RL.red, range: '38 红号', bg: DERBY.away },
  { slot: 'blue', name: RL.blue, range: '37 蓝号', bg: DERBY.home },
]
const COMBO_META = [
  { slot: 'big-odd', name: RL['big-odd'] }, { slot: 'small-odd', name: RL['small-odd'] },
  { slot: 'big-even', name: RL['big-even'] }, { slot: 'small-even', name: RL['small-even'] },
]
const ROWS = [
  { slot: 'row-t1', name: RL['row-t1'], range: '15行×5号' },
  { slot: 'row-t3', name: RL['row-t3'], range: '5行×15号' },
  { slot: 'row-t5', name: RL['row-t5'], range: '3行×25号' },
]

// ---------- 滚球舞台（draw 相位；目标 = 服务端 draw 帧的球号，动画只读不产值）----------
// 1-75 快闪滚号 → 减速定格真值（末球慢放）；canvas 单 rAF，key=期号+球序重挂载；
// StrictMode 双挂载由 cleanup 兜底；prefers-reduced-motion 直出终态帧不发声。
function RollStage({ target, isLast, size, sfx }) {
  const ref = useRef(null)
  const cbRef = useRef(sfx)
  cbRef.current = sfx
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    const LAND = isLast ? 1600 : 1050   // 末球慢放（仍在 DRAW_T=2s 内收尾）
    // 射门入网：球门框(白) + 网格(白半透) + 定格瞬间球飞入网 + 网抖衰减；方形画布不改布局
    const drawScene = (n, landed, t) => {
      const W = canvas.width, H = canvas.height
      ctx.clearRect(0, 0, W, H)
      const gL = W * 0.16, gR = W * 0.84, gT = H * 0.05, gB = H * 0.46
      const shake = landed ? 4 * dpr * Math.exp(-(t - LAND) / 80) * Math.cos((t - LAND) / 26) : 0
      // 网格（先画为背景，横线随抖动位移）
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1 * dpr
      const step = (gR - gL) / 6
      for (let x = gL; x <= gR + 0.5; x += step) { ctx.beginPath(); ctx.moveTo(x, gT); ctx.lineTo(x + shake, gB); ctx.stroke() }
      for (let y = gT; y <= gB + 0.5; y += step) { ctx.beginPath(); ctx.moveTo(gL, y + (y > gT ? shake * 0.6 : 0)); ctx.lineTo(gR, y); ctx.stroke() }
      // 球门框（白）
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2 * dpr
      ctx.beginPath(); ctx.moveTo(gL, gB); ctx.lineTo(gL, gT); ctx.lineTo(gR, gT); ctx.lineTo(gR, gB); ctx.stroke()
      // 球：滚号时在下方，定格后短飞入网（150ms）+ 落网轻弹
      const flight = landed ? Math.min(1, (t - LAND) / 150) : 0
      const cy = H * 0.72 + (H * 0.30 - H * 0.72) * flight
      const r = W * 0.24
      const pop = landed ? 1 + 0.14 * Math.max(0, 1 - (t - LAND) / 160) : 1
      ctx.save(); ctx.translate(W / 2, cy + shake * 0.5); ctx.scale(pop, pop)
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fillStyle = landed ? (isRed(n) ? DERBY.away : DERBY.home) : 'rgba(255,255,255,0.10)'
      ctx.fill()
      ctx.lineWidth = 2 * dpr
      ctx.strokeStyle = landed ? DERBY.gold : 'rgba(255,255,255,0.3)'
      ctx.stroke()
      ctx.fillStyle = landed ? '#ffffff' : 'rgba(255,255,255,0.8)'
      ctx.font = `900 ${Math.round(r * 0.85)}px 'Space Grotesk', sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(n).padStart(2, '0'), 0, 1 * dpr)
      ctx.restore()
    }
    const drawFace = drawScene
    if (reduced) {
      drawFace(target, true, LAND + 200)
      if (import.meta.env.DEV) window.__RB_ANIM_LAST = String(target)
      return
    }
    if (import.meta.env.DEV) window.__RB_RAF_ACTIVE = (window.__RB_RAF_ACTIVE || 0) + 1
    let landed = false, raf = 0
    const t0 = performance.now()
    const loop = now => {
      const t = now - t0
      if (t < LAND) {
        // 快闪滚号：接近 LAND 时换号变慢（减速感），伪序列从 target 派生（零随机数）
        const speed = t < LAND * 0.6 ? 55 : 90 + (t - LAND * 0.6) / (LAND * 0.4) * 170
        const fr = Math.floor(t / speed)
        drawFace(((target * 7 + fr * 13) % 75) + 1, false, t)
      } else {
        drawFace(target, true, t)
        if (!landed) {
          landed = true
          cbRef.current.tick?.()
          if (import.meta.env.DEV) window.__RB_ANIM_LAST = String(target)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      if (import.meta.env.DEV) window.__RB_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} aria-hidden />
}

// ---------- betting 等待区暖场球（号码快跳障眼动效）----------
// setInterval 驱动（非 rAF → __RB_RAF_ACTIVE 不新增环）；伪随机滚号 = 确定性 scramble
// （不碰引擎 RNG，纯展示）；开奖真值在服务端，本球只是暖场障眼。
function BettingBall({ size }) {
  const [n, setN] = useState(37)
  const cntRef = useRef(0)
  useEffect(() => {
    const id = setInterval(() => {
      cntRef.current += 1
      setN(((cntRef.current * 37) % 75) + 1)   // +37 mod 75 全覆盖，跳变似滚号
    }, 80)
    return () => clearInterval(id)
  }, [])
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: 'rgba(255,255,255,0.08)', border: '2px dashed rgba(53,208,127,0.5)',
      color: 'rgba(255,255,255,0.85)', fontSize: size * 0.42, fontWeight: 900,
      fontFamily: "'Space Grotesk', sans-serif",
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      animation: 'rbBetBounce 0.7s ease-in-out infinite',
    }}>{String(n).padStart(2, '0')}</span>
  )
}

export default function RollingBall({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // 单S4c/S9：桌面（≥1024）统一宽度线——drawZone/盘区/珠盘/注栏同一 maxWidth 居中（压缩收留白），
  // 且组合四键 + 行注三档改竖排（名/赔率各占一行永不截断）。
  // 单S9 扩档：原 S4c 只治 ≥1280（有右栏中栏被压那档）；实测 1024–1279 无右栏窄桌面截断更狠（赔率整丢），
  // 遂把门控从 isDesk(≥1280) 放宽到 isDesk(≥1024) 桌面全档。RAIL_MAXW=700 是 maxWidth 语义，
  // 窄档自适应天然安全（宽档才被 700 收）。手机 <1024 一律走原分支逐位不动；≥1280 与放宽前逐位一致。
  // #47 终批·四区对表硬指标：700→800（舞台/盘口/路珠/筹码同一条宽度线）。
  // ⚠ 门控沿用既有 isDesk(≥1024) 语义不改（见上方 S9 说明）：maxWidth 语义下 1024–1279 视口
  //   本就够不着 800，行为与 700 时逐位一致；只有 ≥1415（中栏内容宽 ≥800）才真正吃到 800。
  const RAIL_MAXW = 800

  // #47 三区放大门控：与另九款同档取 hasRail(≥1280)，【不】用 isDesk —— 1024–1279 无右栏窄桌面
  //   中栏实宽仅 664，此档放大必挤爆赔率（S9 当年正是治这档的截断）。手机 <768 永为 false。
  const hasRail = useMediaQuery('(min-width: 1280px)')
  const [acc, setAcc] = useState({ comboRow: true, col: true, num: false })   // 手机手风琴折叠态（默认组合/列注展开、单号收起）；纯 UI，不动任何下注 state
  const [freshCount, setFreshCount] = useState(0)   // #47 动效：本局新落珠数（本款无速度房，单值即可）
  const [roadView, setRoadView] = useState('bs')   // 珠盘路视角（手机 pill 选，默认 1球大小）；纯显示，零请求零 state 污染
  const [bet, setBet] = useState(10)
  const [fairOpen, setFairOpen] = useState(false)   // 可验证公平抽屉
  const [netErr, setNetErr] = useState(null)   // 网络/后端错误提示（不白屏）
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())

  // ============ #公期化 单2：数据源 = 服务端六段房（本地零相位机、零本地开奖）============
  //
  // 退役的东西（原 per-player 三球流）：500ms 本地心跳状态机、phaseRef/cdRef、pendingRef（本地球槽）、
  //   roundIdRef 多步线程、pendingDataRef、transitioningRef、以及「窗口关闭时 POST /rollingball/play
  //   顺带开球」那条钱路。现在球是服务器建局时一次生成、逐帧揭示的，前端只镜像。
  // 保留的东西：舞台/球槽/珠盘路/SFX/手风琴/几何 —— 一个像素不动，只换喂给它们的数据源。
  const room = useRoundRoom(playerToken, G.backendId)

  // 相位派生（全部只读 room，本地不产相位）：
  //   ballIdx = 当前【押注窗】的球序，单一出处 ballWindowOf(revealed) = 已开球数
  //             （与后端 /rollingball/bet 相位闸同源判据，也正是 oddsFor 第二参要的量）
  //   sub     = 'bet' | 'draw' | 'settle'（沿用原页三分法，下游 JSX 一行不改）
  const ph = room.phase
  const revealed = room.revealed || EMPTY_BALLS
  const ballIdx = Math.min(2, ballWindowOf(revealed))
  const isSeg = /^(bet|draw)[123]$/.test(ph) || ph === 'settle'   // 是否已收到六段帧（ready 门闩用）
  const sub = ph === 'settle' ? 'settle' : ph.startsWith('draw') ? 'draw' : 'bet'
  // 封盘（lockedMs 缓冲）判定：服务端【不为锁帧单独发帧】（那会插进七帧序），故 live 路径靠
  //   本地派生 —— bet 帧的 endsAt 就是【下注截止】，倒计时归零即进 2s 缓冲；服务端 betsLocked
  //   只在 snapshot（中途进场）里带，两条一起兜。封盘期一律不可点不可投，与后端 409 同步。
  const isBetSeg = /^bet[123]$/.test(ph)
  const locked = isBetSeg && (room.betsLocked || (room.countdownMs || 0) <= 0)
  const betting = isBetSeg && !locked
  const countdown = Math.ceil((room.countdownMs || 0) / 500)   // 原页以 0.5s tick 计数，此处折算保持下游一致
  const roundNo = room.roundNo

  const [lastRound, setLastRound] = useState(SEED_LAST)   // 上局回顾
  const [road, setRoad] = useState(SEED_ROAD)
  const [result, setResult] = useState(null)              // { idx, ball, hits:Set, win }
  const [toasts, setToasts] = useState([])
  // 本局已投（跨窗保留整局）：Map<复合key `b1:big`, {stake, odds}>；新一局 bet1 清空
  const [stakedByKey, setStakedByKey] = useState(() => new Map())
  const [flying, setFlying] = useState(false)             // 下注 POST 进行中，防连点双投

  const picksRef = useRef(picks)
  const betRef = useRef(bet)
  const balanceRef = useRef(serverBalance)
  const stakedRef = useRef(new Map())
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const roadRecordedRef = useRef(null)                    // 珠盘路整局记账去重：存已记的 roundNo，防 StrictMode 双调用重复入
  const settledRoundRef = useRef(null)                    // settle 结算展示去重
  const clearedRoundRef = useRef(null)                    // 新一局清盘去重

  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const audioRef = useRef({ ctx: null, muted: false })

  useEffect(() => { balanceRef.current = serverBalance }, [serverBalance])
  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  // ---------- SFX（WebAudio 已验配方；muted 门控，短音无持续底噪无掩蔽坑）----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  const probe = name => {
    if (import.meta.env.DEV) console.debug(`[RB-SFX] ${name} fired ctx=${audioRef.current.ctx?.state ?? 'null'} muted=${audioRef.current.muted}`)
  }
  function sfxTick() {   // 落球 tick：短 blip（每球定格一响，canvas 落地帧内触发）
    const ctx = ensureAudio(); probe('tick'); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.05)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.1)
  }
  function sfxHit() {   // 命中提示：上扬三连音（本球有中注时）
    const ctx = ensureAudio(); probe('hit'); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[660, 880, 1170].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.08
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.09, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.26)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.28)
    })
  }
  function sfxFinal() {   // 三球齐终场哨：短哨两响（次响拉长）
    const ctx = ensureAudio(); probe('final'); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[[0, 0.14], [0.2, 0.3]].forEach(([off, len]) => {
      const o = ctx.createOscillator(); o.type = 'square'
      o.frequency.setValueAtTime(2050, t + off); o.frequency.linearRampToValueAtTime(2400, t + off + len)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.04, t + off + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + off + len)
      o.connect(g); g.connect(ctx.destination); o.start(t + off); o.stop(t + off + len + 0.02)
    })
  }
  const stageSfx = { tick: sfxTick }

  // 场馆环境底噪（betting 期持续，观众嗡嗡＝带通白噪，音量压极低）；WebAudio 循环缓冲，
  // 非 rAF（不新增第二环）；draw 瞬间由 effect 切掉。ambientRef 守幂等，muted 门控。
  const ambientRef = useRef(null)
  function stopAmbient() {
    const a = ambientRef.current; if (!a) return
    ambientRef.current = null
    const ctx = audioRef.current.ctx; if (!ctx) return
    const t = ctx.currentTime
    try {
      a.g.gain.cancelScheduledValues(t)
      a.g.gain.setValueAtTime(Math.max(0.0001, a.g.gain.value), t)
      a.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
      a.src.stop(t + 0.2)
    } catch { /* 已停 */ }
    if (import.meta.env.DEV) console.debug('[RB-SFX] ambient stop')
  }
  function startAmbient() {
    stopAmbient()
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 300; f.Q.value = 0.5
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.016, t + 0.6)   // 淡入到极低量
    src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t)
    ambientRef.current = { src, g }
    if (import.meta.env.DEV) console.debug('[RB-SFX] ambient start')
  }
  // 心跳加速序列：末 5s 一次性按 ctx.currentTime 预排渐快 lub-dub（间隔 0.62→0.26s）
  function sfxHeartbeatSeq(cdTicks) {
    const ctx = ensureAudio(); probe('heartbeat'); if (!ctx || audioRef.current.muted) return
    const t0 = ctx.currentTime, secs = cdTicks / 2
    let t = t0, gap = 0.62, n = 0
    while (t < t0 + secs && n < 12) {
      ;[0, 0.13].forEach(off => {   // lub-dub
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(off ? 70 : 92, t + off)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.09, t + off + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.16)
        o.connect(g); g.connect(ctx.destination); o.start(t + off); o.stop(t + off + 0.18)
      })
      n++; t += gap; gap = Math.max(0.26, gap * 0.86)
    }
    if (import.meta.env.DEV) console.debug(`[RB-SFX] heartbeat seq beats=${n}`)
  }

  // betting 期底噪启停（sub/muted 驱动；StrictMode 双挂载由 cleanup + 幂等 start 兜底，
  // 非 rAF 无第二环）；心跳末 5s 一次性预排（hbRef 守单发防双发）
  const hbRef = useRef(false)
  useEffect(() => {
    if (sub === 'bet' && !muted) startAmbient(); else stopAmbient()
    return stopAmbient
    // startAmbient/stopAmbient 走 refs，仅随 sub/muted 变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, muted])
  useEffect(() => { hbRef.current = false }, [ballIdx, sub])   // 每球押注窗重置
  useEffect(() => {
    if (sub === 'bet' && countdown <= 10 && countdown > 0 && !hbRef.current) {
      hbRef.current = true
      sfxHeartbeatSeq(countdown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, sub])

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }


  // ============ 相位驱动 effects（全部只读 room，本地不产相位、不产开奖）============

  // A. 新一局 bet1：清盘（选中/本局已投/上局结算展示），并把上一局三球落进「上局回顾」+ 珠盘路。
  //    去重靠 roundNo（StrictMode 双挂载/重复帧都只生效一次）。
  useEffect(() => {
    if (ph !== 'bet1' || !roundNo || clearedRoundRef.current === roundNo) return
    clearedRoundRef.current = roundNo
    stakedRef.current = new Map(); setStakedByKey(new Map())
    picksRef.current = new Set(); setPicks(new Set())
    setResult(null)
    setBetsPlaced(new Map())
    setFeedBets(makeFeedBots())
    setNetErr(null)
  }, [ph, roundNo])

  // B. 每颗球开出（draw 帧）：舞台定格由 RollStage 自己吃 target，这里只补音效。
  useEffect(() => {
    if (!/^draw[123]$/.test(ph)) return
    // 落球 tick 由 RollStage 内部触发；此处只在第三颗球时留终场哨给 settle（见 C）
  }, [ph])

  // C. settle 帧：唯一结算展示点 —— 三态/派彩/余额【全认服务端 settleInfo】，本地不算钱。
  //    珠盘路整局记一次（3 颗），上局回顾更新。去重靠 roundNo。
  useEffect(() => {
    if (ph !== 'settle' || !roundNo || settledRoundRef.current === roundNo) return
    settledRoundRef.current = roundNo
    const balls = (room.drawResult?.revealed || room.revealed || []).slice(0, 3)
    if (balls.length !== 3) return

    const si = room.settleInfo
    const mine = si && si.roundNo === roundNo ? si : null
    // 盘面格用裸 key，settleInfo 给的是复合 key：只把【第 3 球】（settle 时盘面显示的那颗）
    // 的命中映射回裸键贴到格子上；三颗球的完整三态由 RollingBallPhaseBar 逐球呈现，不混淆。
    const hits = new Set()
    let win = 0
    if (mine) {
      for (const v of mine.yourResult || []) {
        if (v.outcome !== 'lose' && v.key.startsWith('b3:')) hits.add(v.key.slice(3))
      }
      win = Number(mine.totalPayout || 0)
      if (mine.balanceAfter != null) setServerBalance(Number(mine.balanceAfter))   // 余额只认后端
      if (win > 0) { pushToast('本局命中', win); sfxHit() }
    }
    setResult({ idx: 2, ball: balls[2], hits, win })
    setLastRound(balls)
    sfxFinal()   // 三球齐 → 终场哨
    if (roadRecordedRef.current !== roundNo) {
      roadRecordedRef.current = roundNo
      // #47 收官：storage 只截局数；列滑窗口在渲染期按【珠】开（见 deskBeads）
      setRoad(r => [...r, balls].slice(-ROUND_CAP))
      setFreshCount(BEADS_PER_ROUND)   // 本局 3 颗一起弹入
    }
    // room.settleInfo 可能比 settle 帧晚到一拍 → 依赖里带上它，晚到时补跑一次（去重键已置故只补状态）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ph, roundNo, room.settleInfo])

  // C2. settleInfo 晚到补写（settle 帧已消费过去重键时，仍要把三态/派彩/余额补上）
  useEffect(() => {
    const si = room.settleInfo
    if (!si || si.roundNo !== roundNo || ph !== 'settle') return
    const hits = new Set()
    for (const v of si.yourResult || []) if (v.outcome !== 'lose' && v.key.startsWith('b3:')) hits.add(v.key.slice(3))
    const win = Number(si.totalPayout || 0)
    if (si.balanceAfter != null) setServerBalance(Number(si.balanceAfter))
    setResult(r => (r && r.win === win ? r : { idx: 2, ball: (room.drawResult?.revealed || [])[2], hits, win }))   // hits 同上：只含第 3 球裸键
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.settleInfo, roundNo, ph])

  // 窗口一变：盘面格的持注 chip 按【本窗】复合 key 重新派生（整局总表 stakedByKey 不清，
  //   跨窗持注由 RollingBallPhaseBar 的逐球已投额呈现）。
  useEffect(() => {
    const pfx = `b${ballIdx + 1}:`
    setBetsPlaced(new Map([...stakedRef.current].filter(([c]) => c.startsWith(pfx)).map(([c, v]) => [c.slice(3), v])))
  }, [ballIdx, roundNo])

  // ---- 动态赔率表（当前押注球）----
  // 判据与后端逐位同源：oddsFor(裸key, ballIdx, 已开球) —— 返 null = 死键（已开号 / c_k=0），
  // 界面即置灰不可点。禁在此手抄任何「不可押名单」。
  const revealedBefore = revealed.slice(0, ballIdx)
  const oddsAt = key => oddsFor(key, ballIdx, revealedBefore)
  // 本窗复合 key（b1:/b2:/b3:）：前缀由 ballIdx 派生，与后端相位闸同源
  const ckey = key => ballKeyOf(ballIdx, key)

  const toggleSel = key => {
    if (!betting) return
    if (oddsAt(key) == null) return   // 不可押（已开号/池耗尽）
    setPicks(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      picksRef.current = n
      return n
    })
  }

  // 唯一下注入口（#公期化 单2）：bet 窗内【即时 POST】/round/rollingball/bet，后端当场 debit。
  //   · 余额只认响应的 balanceAfter（apiPost 默认自动回写，故这里不手动 setServerBalance）
  //   · 幂等键 uuid（genIdemKey）；服务端自己加 pub- 前缀与老 /play 分域，前端零感知
  //   · 400（跨窗/死键/负注/超限）与 409（round_locked：封盘或非 bet 段）照排期器成例出提示、不扣钱
  async function confirmBets() {
    const amount = betRef.current
    if (amount < 1 || flying || !betting) return
    const keys = [...picksRef.current].filter(k => oddsAt(k) != null)
    if (!keys.length) return
    const bets = Object.fromEntries(keys.map(k => [ckey(k), amount]))
    const oddsSnap = Object.fromEntries(keys.map(k => [ckey(k), oddsAt(k)]))
    setFlying(true)
    setNetErr(null)
    try {
      await api.apiPost('/round/rollingball/bet', { bets, idempotencyKey: api.genIdemKey('rb') })
      // 受理成功 → 记进本局已投（跨窗保留整局，settle 后由新一局 bet1 清）
      const next = new Map(stakedRef.current)
      for (const k of keys) {
        const c = ckey(k)
        const prev = next.get(c)
        next.set(c, { stake: round2((prev?.stake || 0) + amount), odds: oddsSnap[c] })
      }
      stakedRef.current = next
      setStakedByKey(next)
      setBetsPlaced(new Map([...next].filter(([c]) => c.startsWith(`b${ballIdx + 1}:`))
        .map(([c, v]) => [c.slice(3), v])))
      picksRef.current = new Set(); setPicks(new Set())
    } catch (e) {
      setNetErr(e?.data?.error === 'round_locked' ? '本窗已封盘，请等下一个押注窗' : e.message)
    } finally {
      setFlying(false)
    }
  }

  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && !flying && picks.size > 0 && bet >= 1
    && (serverBalance == null || confirmTotal <= round2(serverBalance))
  // draw 段：服务端该帧已把本球放进 revealed，故球序 = revealed.length-1，球号 = 末位
  const drawIdx = Math.max(0, revealed.length - 1)
  const rollTarget = sub === 'draw' ? revealed[drawIdx] : null
  // 当前展示球：draw 段是正在滚的这颗，settle 段是第 3 颗
  const curNum = sub === 'bet' ? null : (sub === 'settle' ? revealed[2] : revealed[ballIdx])

  // ---- 样式件（选中=金框；命中=绿框；已开号不可押=压暗）----
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    const hit = result?.hits?.has(key)
    const staked = betsPlaced.has(key)
    const avail = oddsAt(key) != null
    return {
      flex: 1, minWidth: 0,
      borderRadius: 10, cursor: betting && avail ? 'pointer' : 'not-allowed',
      background: bg,
      border: `1.5px solid ${hit ? DERBY.sel : sel || staked ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit ? '0 0 12px rgba(53,208,127,0.6)'
        : sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      opacity: !avail ? 0.35 : betting || hit || staked ? 1 : 0.7,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      transition: 'filter 0.12s, border-color 0.12s, box-shadow 0.15s, opacity 0.15s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : hasRail ? 15 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : hasRail ? 11 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : hasRail ? 14.5 : 12, fontWeight: 900 }
  const secHead = { color: DERBY.gold, fontSize: hasRail ? 12 : 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: hasRail ? 5 : isDesk ? 3 : 4,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', boxSizing: 'border-box',
  }
  const stakeChip = key => betsPlaced.has(key) && (
    <span style={{
      position: 'absolute', top: 2, right: 3, padding: '1px 5px', borderRadius: RADIUS.pill,
      background: DERBY.sel, color: '#083a1b', fontSize: 8, fontWeight: 900,
    }}>${betsPlaced.get(key).stake}</span>
  )
  const oddsStr = key => { const o = oddsAt(key); return o == null ? '—' : o.toFixed(2) }
  // 行注/列注键：移动竖排堆叠（名/区间小字/赔率分三行，照 Wu Xing 五行先例）防窄键
  // 区间与赔率挤一行被压死（满位如 23.17 五字符真机会盖字）；桌面键宽足 → 横排单行
  // （避免堆叠增高触发桌面盘区内滚）
  const stackCell = (slot, name, range, bg = DERBY.grey, forceStack = false) =>
    (isMobile || forceStack) ? (
      <button key={slot} type="button" className="rbCell" data-key={slot} disabled={!betting || oddsAt(slot) == null}
        onClick={() => toggleSel(slot)}
        style={{ ...cellBase(slot, bg), padding: '4px 2px' }}>
        <span style={{ ...cellName, fontSize: 12 }}>{name}</span>
        {range ? <span style={{ ...cellRange, fontSize: 8 }}>{range}</span> : null}
        <span key={oddsStr(slot)} className="rbOdds" style={cellOdds}>{oddsStr(slot)}</span>
        {stakeChip(slot)}
      </button>
    ) : rowCell(slot, name, range, bg)
  const rowCell = (slot, name, range, bg = DERBY.grey) => (
    <button key={slot} type="button" className="rbCell" data-key={slot} disabled={!betting || oddsAt(slot) == null}
      onClick={() => toggleSel(slot)}
      style={{
        ...cellBase(slot, bg),
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        padding: isMobile ? '6px 8px' : '5px 12px', gap: 6,
      }}>
      <span style={cellName}>{name}</span>
      {range ? <span style={{ ...cellRange, flex: 1, textAlign: 'center' }}>{range}</span> : <span style={{ flex: 1 }} />}
      <span key={oddsStr(slot)} className="rbOdds" style={cellOdds}>{oddsStr(slot)}</span>
      {stakeChip(slot)}
    </button>
  )

  // ---- 顶栏 ----
  // #公期化 单2 (f)：ready 门闩 —— 快照/首帧到货前（connecting、无期号）不画任何相位内容，
  //   否则会先画一帧「bet1 第1球押注中」，快照一到又跳到真实段（如 bet2），就是首帧闪。
  //   门闩键带 roundNo：换局也走同一条路径，不会拿上一局的段号画新局。
  const ready = room.connected && !!roundNo && isSeg
  const lowTime = ready && betting && countdown <= 10   // 末 5s 催注（数字变红放大）
  const secs = String(Math.ceil(countdown / 2)).padStart(2, '0')
  const phaseInfo = !ready
    ? { text: room.roomError === 'invalid_room' ? '房间不可用' : '连接中…', c: DERBY.dim }
    : betting
    ? { text: `⏱ 押注 第${ballIdx + 1}球 00:`, c: lowTime ? DERBY.away : DERBY.sel }
    : sub === 'draw'
      ? { text: `第${ballIdx + 1}球开球中…`, c: DERBY.orange }
      : { text: result ? `第${ballIdx + 1}球 ${String(result.ball).padStart(2, '0')}${result.win > 0 ? ` +$${result.win.toFixed(2)}` : ''}` : '已开', c: DERBY.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: lowTime ? 'rgba(226,86,74,0.18)' : 'rgba(0,0,0,0.35)', border: `1px solid ${phaseInfo.c}`,
      color: phaseInfo.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>
      {phaseInfo.text}
      {ready && betting && (
        <span data-cd style={lowTime ? {
          display: 'inline-block', color: DERBY.away, fontSize: 15,
          fontFamily: "'Space Grotesk', sans-serif",
          animation: 'rbPulse 0.5s ease-in-out infinite',
        } : { fontFamily: "'Space Grotesk', sans-serif" }}>{secs}</span>
      )}
    </span>
  )
  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0} venue={G.venue ?? G.displayName}
        roundId={roundNo || '连接中…'}
        phaseChip={phaseChipNode} onBack={onBack} onHowTo={() => setRulesOpen(true)} onFairness={() => setFairOpen(true)} />
      <CommitRevealFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName}
        round={room.commit ? { ...room.commit, commitHash: room.commit.serverSeedHash } : null}
        game={G.backendId} drawResult={room.drawResult} />
      {netErr && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,10,14,0.95)', border: '1px solid rgba(196,24,54,0.5)', borderRadius: 10,
          padding: '8px 16px', color: '#ff8a9a', fontSize: 13, fontWeight: 800,
        }} onClick={() => setNetErr(null)}>{netErr}</div>
      )}
    </>
  )

  // ---- ① 开奖区：当前球大字 + 3 球槽 + 上局回顾 ----
  const slotSz = isMobile ? 40 : hasRail ? 53 : 44   // #47 放大：×1.2（drawZone 双挂 gameCard/mobileCard，靠此门控隔离手机）
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      ...(isDesk ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}),
      margin: isMobile ? '8px 12px 0' : isDesk ? '6px 0 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : isDesk ? '6px 12px 6px' : '8px 12px 8px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: isMobile ? 10 : 18, boxSizing: 'border-box', flexWrap: 'wrap',
    }}>
      {/* 当前球大字 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: '0 0 auto' }}>
        <span style={{ color: sub === 'draw' ? DERBY.orange : DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>
          {betting ? `押注 · 第${ballIdx + 1}球` : sub === 'draw' ? '开球中' : `第${ballIdx + 1}球已开`}
        </span>
        {sub === 'draw' && rollTarget != null ? (
          // draw 相位：canvas 滚球定格（1-75 快闪 → 真值），末球慢放
          // #公期化 单2：target 换成【服务端 draw 帧的球号】，动画停后端球，前端零本地开奖
          <RollStage key={`${roundNo}-roll-${drawIdx}`} target={rollTarget}
            isLast={drawIdx === 2} size={isMobile ? 56 : 66} sfx={stageSfx} />
        ) : betting ? (
          // betting 期：暖场号码快跳（障眼动效，非 rAF；真值在服务端，本地永不产球）
          <BettingBall size={isMobile ? 56 : 66} />
        ) : (
          <span style={{
            width: isMobile ? 56 : 66, height: isMobile ? 56 : 66, borderRadius: '50%',
            background: curNum != null ? (isRed(curNum) ? DERBY.away : DERBY.home) : 'rgba(255,255,255,0.08)',
            border: `2px ${curNum != null ? 'solid' : 'dashed'} ${curNum != null ? DERBY.gold : 'rgba(255,255,255,0.3)'}`,
            boxShadow: curNum != null ? '0 0 14px rgba(255,213,79,0.45), inset 0 2px 3px rgba(255,255,255,0.28)' : 'none',
            color: curNum != null ? COLORS.white : DERBY.dim, fontSize: isMobile ? 26 : 30, fontWeight: 900,
            fontFamily: "'Space Grotesk', sans-serif",
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{curNum != null ? String(curNum).padStart(2, '0') : '?'}</span>
        )}
        <span style={{ color: DERBY.gold, fontSize: 10, fontWeight: 900, minHeight: 13 }}>
          {/* 滚号中不剧透属性，定格（settle）后才显示 */}
          {sub === 'settle' && curNum != null ? `${isRed(curNum) ? '红' : '蓝'} · ${curNum >= 38 ? '大' : '小'} · ${curNum % 2 ? '单' : '双'}` : ''}
        </span>
      </div>
      {/* 属性亮牌：定格后弹出该球 大小/红蓝 牌（scale 弹簧 + 1.5s 淡出，CSS 无 rAF） */}
      {sub === 'settle' && curNum != null && (
        <div key={`card-${roundNo}-${ballIdx}`} style={{
          position: 'absolute', top: 2, left: '50%', zIndex: 3,
          display: 'flex', gap: 4, animation: 'rbCardPop 1.5s ease-out forwards', pointerEvents: 'none',
        }}>
          {[
            { t: curNum >= 38 ? '大' : '小', c: DERBY.grey },
            { t: isRed(curNum) ? '红' : '蓝', c: isRed(curNum) ? DERBY.away : DERBY.home },
          ].map((b, i) => (
            <span key={i} style={{
              padding: '3px 12px', borderRadius: RADIUS.pill,
              background: b.c, border: `1.5px solid ${DERBY.gold}`,
              color: COLORS.white, fontSize: 13, fontWeight: 900,
              boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
            }}>{b.t}</span>
          ))}
        </div>
      )}
      {/* 3 球槽（本局逐球揭示） */}
      <div style={{ display: 'flex', gap: isMobile ? 8 : 14, alignItems: 'flex-start' }}>
        {[0, 1, 2].map(i => {
          // 球槽定格才亮：当前球 draw 相位滚号未定 → 槽仍暗，settle 时点亮
          const lit = i < ballIdx || (i === ballIdx && sub === 'settle')
          const n = revealed[i]
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: '0 0 auto' }}>
              <span style={{ color: i === ballIdx ? DERBY.gold : DERBY.dim, fontSize: 9, fontWeight: 900 }}>第 {i + 1} 球</span>
              <span data-slot={i} key={lit ? 'lit' : 'dim'} style={{
                width: slotSz, height: slotSz, borderRadius: '50%',
                background: lit ? (isRed(n) ? DERBY.away : DERBY.home) : 'rgba(255,255,255,0.08)',
                border: lit ? `2px solid ${DERBY.gold}` : `1px dashed ${i === ballIdx ? DERBY.sel : 'rgba(255,255,255,0.3)'}`,
                boxShadow: lit ? '0 0 10px rgba(255,213,79,0.35), inset 0 2px 3px rgba(255,255,255,0.25)' : 'none',
                color: lit ? COLORS.white : DERBY.dim, fontSize: slotSz * 0.38, fontWeight: 900,
                fontFamily: "'Space Grotesk', sans-serif",
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                animation: lit ? 'rbSlotIn 0.35s ease-out' : 'none',   // 已开号飞入微动效
              }}>{lit ? String(n).padStart(2, '0') : '?'}</span>
            </div>
          )
        })}
      </div>
      {/* 上局回顾 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, flex: '0 0 auto' }}>
        <span style={{ color: DERBY.dim, fontSize: 9, fontWeight: 900 }}>上局回顾</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {lastRound.map((n, i) => (
            <span key={i} style={{
              width: isMobile ? 22 : 24, height: isMobile ? 22 : 24, borderRadius: '50%',
              background: isRed(n) ? DERBY.away : DERBY.home, border: '1px solid rgba(0,0,0,0.35)',
              color: COLORS.white, fontSize: isMobile ? 9 : 10, fontWeight: 900,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
            }}>{String(n).padStart(2, '0')}</span>
          ))}
        </div>
      </div>
    </div>
  )

  // ---- ② 盘区：球位指示 + 9 类玩法 ----
  // #公期化 单2：球次条整块换成共用件 RollingBallPhaseBar（四态 + 跨窗持注 + settle 逐球三态/派彩）。
  //   桌面/手机两分支引的都是这一个 ballSwitch 变量 → 共用件单一出处；单3 多桌 TableCard 直接
  //   import 同一件传 compact 即可，禁二写。容器/内边距/字号/圆角/配色在件内逐字节照搬原实现。
  const ballSwitch = (
    <RollingBallPhaseBar
      phase={ready ? ph : 'connecting'} revealed={ready ? revealed : EMPTY_BALLS}
      betsLocked={locked} countdownMs={ready ? room.countdownMs : 0}
      stakedByKey={new Map([...stakedByKey].map(([k, v]) => [k, v.stake]))}
      settleResult={room.settleInfo?.roundNo === roundNo ? room.settleInfo?.yourResult : null}
      totalPayout={room.settleInfo?.roundNo === roundNo ? room.settleInfo?.totalPayout : 0}
      isMobile={isMobile} hasRail={hasRail}
    />
  )
  // #47 刀1：剩余池徽标（桌面放大档随组头走）
  const poolBadge = <PoolBadge cur={ballIdx} />   // 共用件同一份实现（禁二写）
  // 组头行：桌面放大档把徽标并到组头右端；手机/窄桌面走原纯组头（逐位不动）
  const headRow = (text, badge = null) => (
    hasRail
      ? <div style={{ ...secHead, display: 'flex', alignItems: 'center', gap: 8 }}>{text}{badge}</div>
      : <div style={secHead}>{text}</div>
  )

  const mainBoard = (
    <div style={secBox}>
      {headRow(<span>主盘 · 押第 {ballIdx + 1} 球</span>, poolBadge)}
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {MAIN.map(m => rowCell(m.slot, m.name, m.range, m.bg))}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {OE.map(m => rowCell(m.slot, m.name, m.range, m.bg))}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {RB.map(m => rowCell(m.slot, m.name, m.range, m.bg))}
      </div>
    </div>
  )
  // #47 刀1：原「组合 ｜ 行注三档」合卡（挤在主盘右侧半宽）拆成两张独立全宽卡。
  //   ⚠ 仅 gameCard 引用；手机走独立的 comboBody（手风琴内），故拆分对手机零影响。
  const comboBoard = (
    <div style={secBox}>
      {headRow('组合 · 大小×单双')}
      <div style={{
        display: isMobile ? 'grid' : 'grid',
        gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
        gap: isMobile ? 5 : 8,
      }}>
        {/* 大小×单双四键：手机横排；桌面全档(≥1024, 单S9) → 竖排（名/赔率两行），赔率永不被裁。 */}
        {COMBO_META.map(m => stackCell(m.slot, m.name, '', DERBY.grey, isDesk))}
      </div>
    </div>
  )
  const rowBetBoard = (
    <div style={secBox}>
      {headRow('行注三档')}
      {/* 行注三档：竖排堆叠（>N行 / 区间小字 / 赔率），满位赔率不挤。
          手机默认横排；桌面全档(≥1024, 单S9 扩档) 强制竖排，赔率独占一行永不被裁。 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: isMobile ? 5 : 8 }}>
        {ROWS.map(m => stackCell(m.slot, m.name, m.range, DERBY.grey, isDesk))}
      </div>
    </div>
  )
  const colBoard = (
    <div style={secBox}>
      <div style={secHead}>列注 · 1-75 按 5 分列（各 15 号）</div>
      {/* 列注五键：grid 等宽竖排堆叠（列N / 赔率），照 Wu Xing 五行横排先例 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: isMobile ? 4 : 8 }}>
        {[1, 2, 3, 4, 5].map(c => stackCell(`col-${c}`, RL[`col-${c}`], ''))}
      </div>
    </div>
  )
  // #47 终批·刀1 裁定 (a) 收现状：顶区改纵排后，中栏定高滚动区把单号盘推出首屏，需下滚才见。
  // ⚠ 禁为「让它进首屏」而重排本盘（如改 25×3）—— 单号盘 15×5 的【行】与列注区【列1-5】
  //   是玩法语义映射（一行 = 一列的 15 个号），重排即切断语义，与骨牌 3×3 判例同理。
  //   代价明确接受：下半盘靠滚。滚动层只有中栏一个（已探针核过，无滚中滚）。
  const numCols = isDesk ? 15 : 5
  const numBoard = (
    <div style={secBox}>
      <div style={secHead}>单号直选 · {numCols}×{75 / numCols}（<span key={oddsStr(`num-1`)} className="rbOdds">{oddsStr(`num-1`)}</span>）</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${numCols}, 1fr)`, gap: isMobile ? 3 : 4 }}>
        {Array.from({ length: 75 }, (_, i) => {
          const n = i + 1
          const key = `num-${n}`
          return (
            <button key={n} type="button" className="rbCell" data-key={key} disabled={!betting || oddsAt(key) == null}
              onClick={() => toggleSel(key)}
              style={{ ...cellBase(key, isRed(n) ? DERBY.away : DERBY.home), padding: isMobile ? '3px 0' : hasRail ? '6px 0' : '4px 0', minHeight: isMobile ? 30 : hasRail ? 32 : 26 }}>
              <span style={{ ...cellName, fontSize: isMobile ? 12 : hasRail ? 15 : 12.5, fontFamily: "'Space Grotesk', sans-serif" }}>{String(n).padStart(2, '0')}</span>
              {stakeChip(key)}
            </button>
          )
        })}
      </div>
    </div>
  )

  // ---- ③ 珠盘路（第1球大小单轨，抄 Line Up）----
  // #47 双端一致·A 案：手机路珠列数升到与桌面同标 30（本款 per-player 本地流，两端喂同一份 road ref → 天然一致）
  const ROAD_COLS = 30
  // #47 刀2：原 roadBead(桌面 14) 已被 deskBead 取代；手机竖版珠格自带写死 14px，不引用本变量，故删。
  const deskBead = 24                        // 桌面统一珠径：30×24 + 29×2 = 778 ≤ 786 可用宽
  const curView = ROAD_VIEWS.find(v => v.key === roadView) || ROAD_VIEWS[0]   // 当前视角（桌手同一份 ROAD_VIEWS）
  // #47 收官：road 存整局 [b1,b2,b3]；先按当前视角展开成【珠】，再各自取窗口。
  //   ⚠ 展开在过窗口之前 —— 窗口按珠算整列滑动，喂局数会算错相位。
  const viewBeads = roadBeadsOf(curView, road)
  // #47 专单：手机竖版同吃列滑窗口（20×2 → 可用 36 珠）。本款 3 颗/局，N 每局 +3、mod 2 交替，
  //   故 35/36 会逐局翻转 —— 全场最快的滑动节奏，相位错在此最先暴露（轨迹见交活）。
  const beads = roadWindow(viewBeads, { cols: ROAD_COLS, rows: 6 })
  const roadScrollRef = useRef(null)
  useEffect(() => { roadAnchorLeft(roadScrollRef.current, beads.length, 18 + 2) }, [beads.length])
  const mobFreshFrom = freshCount > 0 ? beads.length - freshCount : -1   // #47 专单：手机面自己的新珠区间
  const deskBeads = roadWindow(viewBeads, DESK_ROAD)   // 桌面：列对齐滑动窗口（163–168 浮动，右恒空 2 列）
  const freshFrom = freshCount > 0 ? deskBeads.length - freshCount : -1   // 本局新珠区间起点
  const beadRoad = (
    <div style={{ flex: '0 0 auto', position: 'relative', zIndex: 1, margin: isMobile ? '0 12px 8px' : isDesk ? '0 0 8px' : '0 18px 8px', ...(isDesk ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }}>
      {/* #47 收官：桌面原为写死「第1球大小」的静态 span（零 tab）→ 换 8 路 pill，照五行同款 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        {ROAD_VIEWS.map(v => {
          const on = roadView === v.key
          return (
            <button key={v.key} type="button" onClick={() => setRoadView(v.key)} style={{
              flex: '0 0 auto', whiteSpace: 'nowrap', cursor: 'pointer',
              padding: '3px 12px', borderRadius: RADIUS.pill,
              background: on ? DERBY.sel : 'rgba(0,0,0,0.35)', color: on ? '#083a1b' : DERBY.dim,
              border: `1px solid ${on ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
              fontSize: hasRail ? 12 : 10, fontWeight: 900, letterSpacing: 0.5,
            }}>{v.label}</button>
          )
        })}
      </div>
      <style>{ROAD_FX_CSS}</style>
      <div style={{ overflowX: 'auto', borderRadius: 10, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6 }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(${DESK_ROAD.rows}, ${deskBead}px)`, gridTemplateColumns: `repeat(${DESK_ROAD.cols}, ${deskBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: DESK_ROAD.cols * DESK_ROAD.rows }).map((_, i) => {
            // #47 收官：珠面直接取 roadBeadsOf 派生好的 {t,c}（引擎口径，禁在此重算）
            const d = deskBeads[i] || null
            // #47 动效：新珠弹入 / 下一空格呼吸游标（只此一格）
            const cls = (freshFrom >= 0 && i >= freshFrom && i < deskBeads.length) ? ROAD_FX_FRESH
              : (d == null && i === deskBeads.length ? ROAD_FX_NEXT : undefined)
            return (
              <span key={i} className={cls} style={{
                width: deskBead, height: deskBead, borderRadius: '50%',
                background: d ? d.c : 'rgba(255,255,255,0.05)',
                border: d ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: deskBead / 2, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
              }}>{d ? d.t : ''}</span>
            )
          })}
        </div>
      </div>
    </div>
  )

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`
        .rbCell:hover:not(:disabled) { filter: brightness(1.2); }
        /* 属性亮牌：scale 弹簧入 → 停留 → 1.5s 后淡出（单次，CSS 无 rAF） */
        @keyframes rbCardPop {
          0% { transform: translateX(-50%) scale(0.3); opacity: 0; }
          14% { transform: translateX(-50%) scale(1.18); opacity: 1; }
          24% { transform: translateX(-50%) scale(1); opacity: 1; }
          80% { transform: translateX(-50%) scale(1); opacity: 1; }
          100% { transform: translateX(-50%) scale(0.96); opacity: 0; }
        }
        /* 剩余池数字跳动 */
        @keyframes rbPoolBump { 0% { transform: scale(1.4); color: ${DERBY.gold}; } 100% { transform: scale(1); } }
        /* 下球赔率黄闪一下再落定 */
        @keyframes rbOddsFlash { 0%, 35% { filter: brightness(2); text-shadow: 0 0 6px currentColor; } 100% { filter: none; text-shadow: none; } }
        .rbOdds { display: inline-block; animation: rbOddsFlash 0.6s ease-out; }
        /* 已开号飞走微动效（当前球定格后本球槽一跳） */
        @keyframes rbSlotIn { 0% { transform: translateY(-8px) scale(0.7); opacity: 0.3; } 100% { transform: none; opacity: 1; } }
        /* 末 5s 倒计时数字放大脉冲催注 */
        @keyframes rbPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
        /* betting 暖场球轻晃 */
        @keyframes rbBetBounce { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-3px) scale(1.04); } }
      `}</style>
      {topBar}
      {drawZone}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : isDesk ? '4px 0' : '4px 18px', boxSizing: 'border-box', gap: 4, overflowY: 'auto',
        ...(isDesk ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}),
      }}>
        <WinToast toasts={toasts} />
        {ballSwitch}
        {/* #47 刀1：顶区改纵排 —— 主盘/组合/行注三档 各独占全宽一行，不再左右挤半宽 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: isDesk ? 8 : 4 }}>
          {mainBoard}
          {comboBoard}
          {rowBetBoard}
        </div>
        {colBoard}
        {numBoard}
      </div>
      <div style={{ flex: '1 0 auto' }} />
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（照 Line Up 定案）---- */}
      <div style={{
        flex: '0 0 auto', padding: '6px 12px', background: DERBY.band,
        borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1,
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: `minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) ${hasRail ? 110 : 92}px`,
          gridTemplateRows: `repeat(2, ${hasRail ? 34 : 28}px)`, gap: 6, maxWidth: isDesk ? RAIL_MAXW : 480, margin: '0 auto',
        }}>
          {[
            { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
            { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
          ].map(({ v, col, row }) => (
            <button key={v} type="button" className="rbChip" disabled={!betting} onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row, width: '100%', height: '100%', borderRadius: 8,
              fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
              background: bet === v ? DERBY.selTint : 'rgba(0,0,0,0.35)',
              border: `1px solid ${bet === v ? DERBY.sel : 'rgba(255,255,255,0.35)'}`,
              cursor: betting ? 'pointer' : 'not-allowed', opacity: betting ? 1 : 0.6, boxSizing: 'border-box',
            }}>{v}</button>
          ))}
          <div style={{
            gridColumn: 3, gridRow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            borderRadius: 8, padding: '0 6px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            opacity: betting ? 1 : 0.6, boxSizing: 'border-box', minWidth: 0,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>投注额</span>
            <input value={bet} disabled={!betting} onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ width: 40, minWidth: 0, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none', color: COLORS.white, fontSize: 14, fontWeight: 900 }} />
          </div>
          <div style={{
            gridColumn: 3, gridRow: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.15)',
            color: DERBY.dim, fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap', boxSizing: 'border-box', overflow: 'hidden',
          }}>连开 3 球 · 逐球结算</div>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={betting ? `下注 ${picks.size} 格` : sub === 'draw' ? '开球中' : '本球已结'}
              sub={betting ? `$${confirmTotal.toFixed(0)}` : undefined}
              onClick={confirmBets} disabled={!confirmOk} stretch
            />
          </div>
        </div>
      </div>
      <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)}
        venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />
    </Panel>
  )

  // ============ 手机三段式 v2（<1024）：锁顶(顶栏+舞台+主盘) / 中间滚(三折叠盘区) / 锁底(珠盘路+注栏) ============
  // 折叠纯 UI（acc 状态），不动任何下注 state（picks/betsPlaced/bet 组件级持有，收起也保留）；钱路(confirmBets/结算/odds)一行未动。
  const COMBO_ROW_KEYS = new Set([...COMBO_META.map(m => m.slot), ...ROWS.map(m => m.slot)])
  const selCount = (section) => {
    let n = 0
    new Set([...picks, ...betsPlaced.keys()]).forEach(k => {
      const belong = section === 'num' ? k.startsWith('num-')
        : section === 'col' ? k.startsWith('col-')
          : COMBO_ROW_KEYS.has(k)
      if (belong) n++
    })
    return n
  }
  const accSection = (key, title, body) => {
    const open = acc[key]
    const cnt = selCount(key)
    return (
      <div style={{ ...secBox, padding: 0, overflow: 'hidden', marginBottom: 6 }}>
        <button type="button" onClick={() => setAcc(a => ({ ...a, [key]: !a[key] }))} style={{
          width: '100%', height: 36, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '0 10px', background: 'transparent', border: 'none', cursor: 'pointer',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ color: DERBY.gold, fontSize: 11, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
            {cnt > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flex: '0 0 auto', color: DERBY.sel, fontSize: 10, fontWeight: 900 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: DERBY.sel, display: 'inline-block' }} />{cnt}
              </span>
            )}
          </span>
          <span style={{ color: COLORS.white, fontSize: 12, fontWeight: 900, flex: '0 0 auto' }}>{open ? '˄' : '˅'}</span>
        </button>
        <div style={{ maxHeight: open ? 1400 : 0, overflow: 'hidden', transition: 'max-height 0.2s ease' }}>
          <div style={{ padding: '0 6px 6px' }}>{body}</div>
        </div>
      </div>
    )
  }
  const comboBody = (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 5 }}>
        {COMBO_META.map(m => rowCell(m.slot, m.name, ''))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
        {ROWS.map(m => stackCell(m.slot, m.name, m.range))}
      </div>
    </>
  )
  const colBody = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(c => stackCell(`col-${c}`, `列${c}`, ''))}
    </div>
  )
  const numBody = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3 }}>
      {Array.from({ length: 75 }, (_, i) => {
        const n = i + 1
        const key = `num-${n}`
        return (
          <button key={n} type="button" className="rbCell" data-key={key} disabled={!betting || oddsAt(key) == null}
            onClick={() => toggleSel(key)}
            style={{ ...cellBase(key, isRed(n) ? DERBY.away : DERBY.home), padding: '3px 0', minHeight: 30 }}>
            <span style={{ ...cellName, fontSize: 12, fontFamily: "'Space Grotesk', sans-serif" }}>{String(n).padStart(2, '0')}</span>
            {stakeChip(key)}
          </button>
        )
      })}
    </div>
  )
  const mobileCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
    }}>
      <style>{`
        .rbCell:hover:not(:disabled) { filter: brightness(1.2); }
        @keyframes rbCardPop { 0% { transform: translateX(-50%) scale(0.3); opacity: 0; } 14% { transform: translateX(-50%) scale(1.18); opacity: 1; } 24% { transform: translateX(-50%) scale(1); opacity: 1; } 80% { transform: translateX(-50%) scale(1); opacity: 1; } 100% { transform: translateX(-50%) scale(0.96); opacity: 0; } }
        @keyframes rbPoolBump { 0% { transform: scale(1.4); color: ${DERBY.gold}; } 100% { transform: scale(1); } }
        @keyframes rbOddsFlash { 0%, 35% { filter: brightness(2); text-shadow: 0 0 6px currentColor; } 100% { filter: none; text-shadow: none; } }
        .rbOdds { display: inline-block; animation: rbOddsFlash 0.6s ease-out; }
        @keyframes rbSlotIn { 0% { transform: translateY(-8px) scale(0.7); opacity: 0.3; } 100% { transform: none; opacity: 1; } }
        @keyframes rbPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
        @keyframes rbBetBounce { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-3px) scale(1.04); } }
      `}</style>

      {/* ① 锁顶 flex:0 0 auto：顶栏 + 开奖舞台(逐球流程常驻) + 主盘6键 */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
        {topBar}
        {drawZone}
        <div style={{ padding: '4px 12px 6px', position: 'relative', zIndex: 1 }}>
          {ballSwitch}
          {mainBoard}
        </div>
      </div>

      {/* ② 中间滚 flex:1 overflow-y:auto：三个折叠盘区（展开收起互不影响，可同时全开） */}
      <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 12px', position: 'relative', zIndex: 1 }}>
        <WinToast toasts={toasts} />
        {accSection('comboRow', '组合·大小×单双', comboBody)}
        {accSection('col', '列注·1-75', colBody)}
        {accSection('num', '单号直选·5×15', numBody)}
      </div>

      {/* ③ 锁底 flex:0 0 auto：珠盘路(压缩~64px 横滑) + 注栏，均钉死不随滚动 */}
      <div style={{ flex: '0 0 auto' }}>
        {/* 珠盘路 ~64px（锁底不变）：5 视角 pill 横滑 + 珠子网格(2 行)，按 curView 从整局 3 球派生重画 */}
        <div style={{ padding: '3px 12px 0', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', gap: 5, overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', marginBottom: 3 }}>
            {ROAD_VIEWS.map(v => {
              const on = roadView === v.key
              return (
                <button key={v.key} type="button" onClick={() => setRoadView(v.key)} style={{
                  flex: '0 0 auto', whiteSpace: 'nowrap',
                  background: on ? DERBY.sel : 'rgba(0,0,0,0.35)', color: on ? '#083a1b' : DERBY.dim,
                  border: `1px solid ${on ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
                  borderRadius: RADIUS.pill, padding: '3px 10px', fontSize: 10, fontWeight: 900, cursor: 'pointer',
                }}>{v.label}</button>
              )
            })}
          </div>
          {/* #47 A 案：30×6 珠18，598 > 390 → 横滑，右端锚定最新珠 */}
          <div ref={roadScrollRef} style={{ overflowX: 'auto', borderRadius: 8, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 3 }}>
            <style>{ROAD_FX_CSS}</style>{/* #47 专单：手机动效同一份 CSS */}
            <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(6, 18px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 18px)`, gap: 2, width: 'max-content' }}>
              {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
                const d = beads[i] || null   // #47 收官：与桌面同一份 roadBeadsOf 派生（单一出处）
                // #47 专单：手机也上弹入/游标动效；本款 3 颗/局，故整段新珠区间齐弹
                const cls = (mobFreshFrom >= 0 && i >= mobFreshFrom && i < beads.length) ? ROAD_FX_FRESH
                  : (d == null && i === beads.length ? ROAD_FX_NEXT : undefined)
                return (
                  <span key={i} className={cls} style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: d ? d.c : 'rgba(255,255,255,0.05)',
                    border: d ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                    color: COLORS.white, fontSize: 9, fontWeight: 900,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                  }}>{d ? d.t : ''}</span>
                )
              })}
            </div>
          </div>
        </div>
        {/* 注栏（原样） */}
        <div style={{ padding: '6px 12px', background: DERBY.band, borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1 }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
          gridTemplateRows: 'repeat(2, 28px)', gap: 6, maxWidth: 480, margin: '0 auto',
        }}>
          {[
            { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
            { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
          ].map(({ v, col, row }) => (
            <button key={v} type="button" className="rbChip" disabled={!betting} onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row, width: '100%', height: '100%', borderRadius: 8,
              fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
              background: bet === v ? DERBY.selTint : 'rgba(0,0,0,0.35)',
              border: `1px solid ${bet === v ? DERBY.sel : 'rgba(255,255,255,0.35)'}`,
              cursor: betting ? 'pointer' : 'not-allowed', opacity: betting ? 1 : 0.6, boxSizing: 'border-box',
            }}>{v}</button>
          ))}
          <div style={{
            gridColumn: 3, gridRow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            borderRadius: 8, padding: '0 6px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            opacity: betting ? 1 : 0.6, boxSizing: 'border-box', minWidth: 0,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>投注额</span>
            <input value={bet} disabled={!betting} onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ width: 40, minWidth: 0, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none', color: COLORS.white, fontSize: 14, fontWeight: 900 }} />
          </div>
          <div style={{
            gridColumn: 3, gridRow: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.15)',
            color: DERBY.dim, fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap', boxSizing: 'border-box', overflow: 'hidden',
          }}>连开 3 球 · 逐球结算</div>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={betting ? `下注 ${picks.size} 格` : sub === 'draw' ? '开球中' : '本球已结'}
              sub={betting ? `$${confirmTotal.toFixed(0)}` : undefined}
              onClick={confirmBets} disabled={!confirmOk} stretch
            />
          </div>
        </div>
      </div>
      </div>

      <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)}
        venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />
    </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024) ----
  if (isDesk) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640, background: COLORS.bg }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12 }}>
            <div style={{ flex: 1, minHeight: 0 }}>{gameCard}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`.rbMobileRoot{height:100vh;height:100dvh;overflow:hidden}`}</style>
      <div className="rbMobileRoot">{mobileCard}</div>
    </>
  )
}
