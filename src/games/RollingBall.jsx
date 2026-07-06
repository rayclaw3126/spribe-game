import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'

// Rolling Ball — NUMBER GAME 连开 3 球足球滚球皮（每球 1-75，同局 3 球不重复），第 20 卡。
// X2：连开 3 球引擎 + 剩余池动态赔率 + 逐球结算状态机（前 19 卡无此结构）。
//   逐球开：pendingRef 锁 3 球，逐球揭示；每球独立押注窗 → 开球 → 结算 → 重算下球赔率。
//   动态赔率（逆向报告公式，禁改）：odds_k = round(R_key × (76-k) / c_k, 2)
//     k = 球序 1-3；c_k = 该键剩余池号码数 = 初始计数 − 已开出属该键球数。
//   R 标定（单据定稿 2026-07-06，全键入 94-97.5% 带）：单号 0.9523；
//     大小/单双/红蓝 0.972（37 计数侧 1.98→1.97，进位溢出修掉）；列注/行注 = odds₁×c₁/75；
//     组合独立 R_组合 0.955，odds_k = round(0.955×(76-k)/c_combo, 2)，
//     c_combo = 组合剩余计数（大单 = 剩余池「大且单」数）。第1球四键=3.77，
//     小双计数 18（38 偶数落大侧）→ 3.98；两者 RTP 均 ≈95.5%。
// 算钱路径：placeBets() 唯一扣注入口，settleBall() 每球一次赔付点。

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
const ROAD_CAP = 120

// ---------- 静态种子数据 ----------
const VENUE = 'SPINEL STADIUM'         // 架空球场名（禁真实球场名）
const ROUND_DATE = 'SS20260706'
const SEED_LAST = [21, 44, 7]          // 上局回顾种子（真开奖逐期顶掉）
const SEED_ROAD = [
  '大', '小', '大', '大', '小', '大', '小', '小', '大', '小',
  '大', '大', '小', '大', '小', '大', '大', '小', '小', '大',
  '小', '大', '小', '大', '大', '小', '大', '小', '大', '小',
  '小', '大', '大', '小', '大', '小', '大', '大', '小', '大',
]

// 盘面玩法元数据（名/区间/底色；赔率运行时动态取）
const MAIN = [
  { slot: 'big', name: '大', range: '38-75', bg: DERBY.grey },
  { slot: 'small', name: '小', range: '1-37', bg: DERBY.grey },
]
const OE = [
  { slot: 'odd', name: '单', range: '球号单', bg: DERBY.grey },
  { slot: 'even', name: '双', range: '球号双', bg: DERBY.grey },
]
const RB = [
  { slot: 'red', name: '红', range: '38 红号', bg: DERBY.away },
  { slot: 'blue', name: '蓝', range: '37 蓝号', bg: DERBY.home },
]
const COMBO_META = [
  { slot: 'big-odd', name: '大单' }, { slot: 'small-odd', name: '小单' },
  { slot: 'big-even', name: '大双' }, { slot: 'small-even', name: '小双' },
]
const ROWS = [
  { slot: 'row-t1', name: '>1行', range: '15行×5号' },
  { slot: 'row-t3', name: '>3行', range: '5行×15号' },
  { slot: 'row-t5', name: '>5行', range: '3行×25号' },
]

// ---------- 滚球舞台（draw 相位；目标已锁于 pendingRef，动画只读）----------
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
// （不碰引擎 RNG，纯展示）；开奖真值仍锁于 pendingRef，本球只是暖场障眼。
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

export default function RollingBall({ balance, setBalance, onBack }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())

  // ---- 逐球结算状态机 ----
  // phase: b{1-3}-{bet|draw|settle}；ballIdx / sub 由 phase 解析
  const [phase, setPhase] = useState('b1-bet')
  const [countdown, setCountdown] = useState(BET_T)
  const [roundNo, setRoundNo] = useState(88)
  const [lastRound, setLastRound] = useState(SEED_LAST)   // 上局回顾
  const [road, setRoad] = useState(SEED_ROAD)
  const [result, setResult] = useState(null)              // { idx, ball, hits:Set, win }
  const [toasts, setToasts] = useState([])
  const [, forceTick] = useState(0)                       // pendingRef 揭示后触发重渲

  const phaseRef = useRef('b1-bet')
  const cdRef = useRef(BET_T)
  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())                       // 当前球注单 key→{stake,odds}
  const betRef = useRef(bet)
  const balanceRef = useRef(balance)
  const pendingRef = useRef(null)                         // 本局锁定的 3 球
  const toastIdRef = useRef(0)
  const timersRef = useRef([])

  const ballIdx = Number(phase[1]) - 1
  const sub = phase.slice(3)   // bet | draw | settle
  const betting = sub === 'bet'

  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const audioRef = useRef({ ctx: null, muted: false })

  useEffect(() => { balanceRef.current = balance }, [balance])
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

  // 唯一赔付点：结算第 idx 球注单（对本球号 n）
  function settleBall(idx) {
    const n = pendingRef.current[idx]
    let win = 0
    const hits = new Set()
    betsRef.current.forEach(({ stake, odds }, key) => {
      if (hitOf(key, n)) { win = round2(win + stake * odds); hits.add(key) }
    })
    if (win > 0) { setBalance(b => round2(b + win)); pushToast(`第${idx + 1}球命中`, win); sfxHit() }
    setResult({ idx, ball: n, hits, win })
    if (idx === 2) sfxFinal()   // 三球齐 → 终场哨
    if (idx === 0) setRoad(r => [...r, n >= 38 ? '大' : '小'].slice(-ROAD_CAP))
  }

  // 单心跳驱动状态机（500ms/tick）；StrictMode 双挂载由 cleanup 兜底
  useEffect(() => {
    const id = setInterval(() => {
      cdRef.current -= 1
      if (cdRef.current > 0) { setCountdown(cdRef.current); return }
      const ph = phaseRef.current
      const bi = Number(ph[1]) - 1
      const sb = ph.slice(3)
      const go = (next, ticks) => {
        phaseRef.current = next; setPhase(next)
        cdRef.current = ticks; setCountdown(ticks)
      }
      if (sb === 'bet') {
        // 第 1 球押注截止 → 锁定 3 球（pendingRef 锁 3 球，逐球揭示）
        if (bi === 0) {
          let three = null
          if (import.meta.env.DEV && window.__RB_FORCE) { three = window.__RB_FORCE; window.__RB_FORCE = null }
          pendingRef.current = three || drawThree()
        }
        forceTick(x => x + 1)   // 揭示本球
        go(`b${bi + 1}-draw`, DRAW_T)
      } else if (sb === 'draw') {
        settleBall(bi)
        go(`b${bi + 1}-settle`, SETTLE_T)
      } else {
        // 结算完毕 → 下一球 或 本局收尾
        betsRef.current = new Map(); setBetsPlaced(new Map())
        picksRef.current = new Set(); setPicks(new Set())
        setResult(null)
        if (bi < 2) {
          go(`b${bi + 2}-bet`, BET_T)   // 开下一球押注窗（赔率随剩余池自动重算）
        } else {
          setLastRound(pendingRef.current)
          pendingRef.current = null
          setFeedBets(makeFeedBots())
          setRoundNo(x => x + 1)
          go('b1-bet', BET_T)
        }
      }
    }, TICK_MS)
    return () => clearInterval(id)
    // 引擎全程走 refs，空依赖单心跳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 动态赔率表（当前押注球）----
  const revealedBefore = pendingRef.current ? pendingRef.current.slice(0, ballIdx) : []
  const oddsAt = key => oddsFor(key, ballIdx, revealedBefore)

  const toggleSel = key => {
    if (phaseRef.current.slice(3) !== 'bet') return
    if (oddsAt(key) == null) return   // 不可押（已开号）
    setPicks(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      picksRef.current = n
      return n
    })
  }

  // 唯一扣注点
  function placeBets(entries) {
    if (phaseRef.current.slice(3) !== 'bet') return false
    let total = 0
    entries.forEach(({ stake }) => { total = round2(total + stake) })
    if (!entries.size || total <= 0 || total > balanceRef.current) return false
    setBalance(b => round2(b - total))
    balanceRef.current = round2(balanceRef.current - total)
    entries.forEach((v, k) => {
      const prev = betsRef.current.get(k)
      betsRef.current.set(k, { stake: round2((prev?.stake || 0) + v.stake), odds: v.odds })
    })
    setBetsPlaced(new Map(betsRef.current))
    return true
  }
  function confirmBets() {
    const amount = betRef.current
    if (amount < 1) return
    const entries = new Map()
    picksRef.current.forEach(k => {
      const o = oddsFor(k, Number(phaseRef.current[1]) - 1, pendingRef.current ? pendingRef.current.slice(0, Number(phaseRef.current[1]) - 1) : [])
      if (o != null) entries.set(k, { stake: amount, odds: o })
    })
    if (placeBets(entries)) { picksRef.current = new Set(); setPicks(new Set()) }
  }

  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && confirmTotal <= balance
  const revealedCount = ballIdx + (sub === 'bet' ? 0 : 1)
  const drawnBalls = pendingRef.current ? pendingRef.current.slice(0, revealedCount) : []
  const curNum = sub === 'bet' ? null : pendingRef.current?.[ballIdx]

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
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const secHead = { color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 3 : 4,
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
  const stackCell = (slot, name, range, bg = DERBY.grey) =>
    isMobile ? (
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
  const lowTime = betting && countdown <= 10   // 末 5s 催注（数字变红放大）
  const secs = String(Math.ceil(countdown / 2)).padStart(2, '0')
  const phaseInfo = betting
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
      {betting && (
        <span data-cd style={lowTime ? {
          display: 'inline-block', color: DERBY.away, fontSize: 15,
          fontFamily: "'Space Grotesk', sans-serif",
          animation: 'rbPulse 0.5s ease-in-out infinite',
        } : { fontFamily: "'Space Grotesk', sans-serif" }}>{secs}</span>
      )}
    </span>
  )
  const topBar = (
    <GameTopBar gameName="ROLLING BALL" venue={VENUE}
      roundId={`${ROUND_DATE}-${String(roundNo).padStart(3, '0')}`}
      phaseChip={phaseChipNode} onBack={onBack} />
  )

  // ---- ① 开奖区：当前球大字 + 3 球槽 + 上局回顾 ----
  const slotSz = isMobile ? 40 : 44
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
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
        {sub === 'draw' && pendingRef.current ? (
          // draw 相位：canvas 滚球定格（1-75 快闪 → 真值），末球慢放
          <RollStage key={`${roundNo}-roll-${ballIdx}`} target={pendingRef.current[ballIdx]}
            isLast={ballIdx === 2} size={isMobile ? 56 : 66} sfx={stageSfx} />
        ) : betting ? (
          // betting 期：暖场号码快跳（障眼动效，非 rAF；真值仍锁 pendingRef）
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
          const n = pendingRef.current ? pendingRef.current[i] : undefined
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
  const ballSwitch = (
    <div style={{ display: 'flex', gap: 4, marginBottom: isMobile ? 5 : 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {[0, 1, 2].map(i => {
        const done = i < ballIdx || (i === ballIdx && !betting)
        const active = i === ballIdx
        return (
          <span key={i} style={{
            padding: '4px 12px', borderRadius: RADIUS.pill,
            background: active ? DERBY.sel : done ? 'rgba(53,208,127,0.14)' : 'rgba(0,0,0,0.35)',
            color: active ? '#083a1b' : done ? DERBY.sel : DERBY.dim,
            border: `1px solid ${active ? DERBY.sel : done ? 'rgba(53,208,127,0.45)' : 'rgba(255,255,255,0.2)'}`,
            fontSize: 11, fontWeight: 900, letterSpacing: 0.3, whiteSpace: 'nowrap',
          }}>第{i + 1}球{done && drawnBalls[i] != null ? ` ${String(drawnBalls[i]).padStart(2, '0')}` : active ? ' ◀ 押注中' : ''}</span>
        )
      })}
      {/* 剩余池收缩可视化：75→74→73 每球定后跳动（key 由值驱动，CSS 无 rAF） */}
      <span style={{
        marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: `1px solid ${DERBY.gold}`,
        color: DERBY.gold, fontSize: 10, fontWeight: 900, whiteSpace: 'nowrap',
      }}>剩余池 <span key={75 - ballIdx} style={{ display: 'inline-block', animation: 'rbPoolBump 0.4s ease-out', fontFamily: "'Space Grotesk', sans-serif", fontSize: 12 }}>{75 - ballIdx}</span></span>
      {ballIdx > 0 && (
        <span style={{ color: DERBY.orange, fontSize: 9, fontWeight: 800, whiteSpace: 'nowrap' }}>
          赔率已按剩余池重算
        </span>
      )}
    </div>
  )
  const mainBoard = (
    <div style={secBox}>
      <div style={secHead}>主盘 · 押第 {ballIdx + 1} 球</div>
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
  const comboRowBoard = (
    <div style={secBox}>
      <div style={secHead}>组合 · 大小×单双 ｜ 行注三档</div>
      <div style={{
        display: isMobile ? 'grid' : 'flex',
        gridTemplateColumns: isMobile ? '1fr 1fr' : undefined,
        gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4,
      }}>
        {COMBO_META.map(m => rowCell(m.slot, m.name, ''))}
      </div>
      {/* 行注三档：竖排堆叠（>N行 / 区间小字 / 赔率），满位赔率不挤 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: isMobile ? 5 : 8 }}>
        {ROWS.map(m => stackCell(m.slot, m.name, m.range))}
      </div>
    </div>
  )
  const colBoard = (
    <div style={secBox}>
      <div style={secHead}>列注 · 1-75 按 5 分列（各 15 号）</div>
      {/* 列注五键：grid 等宽竖排堆叠（列N / 赔率），照 Wu Xing 五行横排先例 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: isMobile ? 4 : 8 }}>
        {[1, 2, 3, 4, 5].map(c => stackCell(`col-${c}`, `列${c}`, ''))}
      </div>
    </div>
  )
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
              style={{ ...cellBase(key, isRed(n) ? DERBY.away : DERBY.home), padding: isMobile ? '3px 0' : '4px 0', minHeight: isMobile ? 30 : 26 }}>
              <span style={{ ...cellName, fontSize: isMobile ? 12 : 12.5, fontFamily: "'Space Grotesk', sans-serif" }}>{String(n).padStart(2, '0')}</span>
              {stakeChip(key)}
            </button>
          )
        })}
      </div>
    </div>
  )

  // ---- ③ 珠盘路（第1球大小单轨，抄 Line Up）----
  const ROAD_COLS = 20
  const roadBead = isMobile ? 18 : 14
  const beads = road.slice(-ROAD_CAP)
  const beadRoad = (
    <div style={{ flex: '0 0 auto', position: 'relative', zIndex: 1, margin: isMobile ? '0 12px 8px' : '0 18px 8px' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <span style={{
          padding: '3px 12px', borderRadius: RADIUS.pill, background: DERBY.sel, color: '#083a1b',
          border: `1px solid ${DERBY.sel}`, fontSize: 10, fontWeight: 900, letterSpacing: 0.5,
        }}>第1球大小</span>
      </div>
      <div style={{ overflowX: 'auto', borderRadius: 10, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6 }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(6, ${roadBead}px)`, gridTemplateColumns: `repeat(${ROAD_COLS}, ${roadBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const t = beads[i]
            return (
              <span key={i} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: t ? (t === '大' ? DERBY.away : DERBY.home) : 'rgba(255,255,255,0.05)',
                border: t ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: roadBead / 2, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
              }}>{t || ''}</span>
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
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box', gap: 4, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        {ballSwitch}
        <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 4, alignItems: isDesk ? 'stretch' : undefined }}>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{mainBoard}</div>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{comboRowBoard}</div>
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
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>USD</span>
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
    </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024) ----
  if (isDesk) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640, background: COLORS.bg }}>
        <div style={{
          height: LAYOUT.headerH, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', background: COLORS.panel, borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Rolling Ball</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>
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
    <GameLayout title="Rolling Ball" color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
