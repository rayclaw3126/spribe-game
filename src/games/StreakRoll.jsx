import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, HOTLINE } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import WinToast from '../components/shell/WinToast'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import SeedFairness from '../components/shell/SeedFairness'
import HowToPlay from '../components/shell/HowToPlay'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'
import flameUrl from '../assets/shared/flame_tier_sm.png'
import ballUrl from '../assets/covers/ball-3d.png'
import silKeeperUrl from '../assets/shared/silhouette_keeper.png'
import silStrikerUrl from '../assets/shared/silhouette_striker.png'
import silTackleUrl from '../assets/shared/silhouette_tackle.png'

const CELL_W = 64          // portrait cards, ref-proportioned (≈64×84)
const CARD_H = 84
const GAP = 8
const STEP = CELL_W + GAP

// ---- card distributions & payouts (parameterized, not hand-picked) ----
// A landing index is drawn uniformly over the pattern, so P(color) is exactly
// count/len. Payout per color = RTP / P(color), rounded to 2dp → RTP ≈ 95%.
//   normal: 32 cells = 16 black · 15 red · 1 fire  → B 1.90× R 2.03× F 30.40×
//   high:   32 cells = 16 black · 12 red · 4 fire  → B 1.90× R 2.53× F 7.60×
const RTP = 0.95
const PATTERN_NORMAL = [
  ...Array.from({ length: 30 }, (_, i) => (i % 2 ? 'R' : 'B')),  // B/R ×15
  'B', 'F',
]
const PATTERN_HIGH = [
  ...Array.from({ length: 24 }, (_, i) => (i % 2 ? 'R' : 'B')),  // B/R ×12
  'B', 'F', 'B', 'F', 'B', 'F', 'B', 'F',
]
const round2 = x => Math.round(x * 100) / 100
function multsFor(pattern) {
  const n = pattern.length
  const count = c => pattern.filter(x => x === c).length
  return { R: round2(RTP * n / count('R')), B: round2(RTP * n / count('B')), F: round2(RTP * n / count('F')) }
}
const MULTS = { normal: multsFor(PATTERN_NORMAL), high: multsFor(PATTERN_HIGH) }
// 复制成长条：6 份副本 — 每局从副本2一带向前多绕 2 圈落位（视觉行程 2–4 圈），
// 落地后在同一 pattern 相位上无痕回卷到副本2，行程永远向前（tick 调度依赖正 delta）。
const COPIES = 6
const STRIPS = {
  normal: Array.from({ length: COPIES }, () => PATTERN_NORMAL).flat(),
  high: Array.from({ length: COPIES }, () => PATTERN_HIGH).flat(),
}
const COLOR_LABEL = { R: 'RED', B: 'BLACK', F: 'FIRE' }

// ---- rAF spin physics: one continuous critically-damped motion ----
// x(t) = T − (D + C2·t)·e^(−ωt) with initial kick v0 = KICK·ω·D. KICK > 1
// makes the tail cross the target slightly and spring back — the settle
// wobble comes from the same equation, no stitched transitions.
const SPRING_W = 1.55       // rad/s — ≈4.2s of glide + settle
const SPRING_KICK = 1.15

const G = GAME_BY_ID['StreakRoll']

const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '转盘由一长条彩色号码带组成，每格是三种颜色之一：红(RED) / 黑(BLACK) / 王牌(FIRE 火焰)。你先押其中一种颜色，然后开转，转盘绕行后停在某一格，就按该格的颜色结算——押中该色即获胜，按对应倍数赔付。',
  },
  {
    icon: '📊', title: '两档赔率',
    body: '游戏有两档模式，切换「High risk mode」即换一套号码分布与赔率：\n· 普通档(normal)：红 2.03× / 黑 1.9× / 王牌 30.4×。红黑格数接近，王牌极稀有，故王牌赔率最高。\n· 高倍档(high)：红 2.53× / 黑 1.9× / 王牌 7.6×。王牌格变多、更易命中，赔率随之降低，红则相应升高。\n倍数 = RTP × 号码带长度 ÷ 该色格数，两档理论返还率均约 95%。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '① 选档：点「High risk mode」在普通/高倍之间切换，赔率按钮会即时更新。\n② 选色并下注：用 −/+ 或输入框设好每注金额，点 RED / FIRE / BLACK 三个按钮之一即以该金额押注该色并开转。\n③ 转：转盘绕行 2–4 圈后落格，命中金框高亮结算，赔付直接入余额。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 求稳押红/黑，中奖率高、赔率低；求大赔押王牌(FIRE)，稀有但一击回报可观。\n· 普通档王牌高达 30.4×但极难中；高倍档王牌只 7.6×却好中得多——按你偏好的风险选档。\n· 每局独立开奖，上一局结果不影响下一局。本游戏属娱乐性质，理性游戏。',
  },
]

export default function StreakRoll({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const [bet, setBet] = useState(10)
  const [offset, setOffset] = useState(0)
  const [rolling, setRolling] = useState(false)
  const [result, setResult] = useState(null)
  const [roundHistory, setRoundHistory] = useState([])   // landed multiplier per round, newest first
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // fake feed rows (display only)
  const [winCell, setWinCell] = useState(null)
  const [highRisk, setHighRisk] = useState(false)
  const cellRef = useRef(PATTERN_NORMAL.length)      // cell currently under the frame
  const rollingRef = useRef(false)
  const stripRef = useRef(null)                      // rAF writes transform directly
  const rafRef = useRef(null)
  const [toasts, setToasts] = useState([])
  const [lossFlash, setLossFlash] = useState(false)
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const [fairOpen, setFairOpen] = useState(false)   // 可验证公平抽屉
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明弹窗
  const [netErr, setNetErr] = useState(null)   // 网络/后端错误提示（不白屏）
  const busyRef = useRef(false)
  const toastIdRef = useRef(0)
  const lossTimerRef = useRef(null)

  const viewRef = useRef(null)
  const audioRef = useRef({ ctx: null, muted: false })

  useEffect(() => { audioRef.current.muted = muted }, [muted])

  // ONE centering formula for everything: initial frame, every landing, resize.
  // offset(cell) = cell·STEP + CELL_W/2 − viewW/2  (cell midpoint under frame)
  function centerOffset(cell) {
    const viewW = viewRef.current ? viewRef.current.offsetWidth : 400
    return cell * STEP + CELL_W / 2 - viewW / 2
  }
  useEffect(() => {
    setOffset(centerOffset(cellRef.current))
    const onResize = () => { if (!rollingRef.current) setOffset(centerOffset(cellRef.current)) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (lossTimerRef.current) clearTimeout(lossTimerRef.current)
  }, [])

  // ---------- audio ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  // Shared bus: everything runs through a compressor + 0.9 master so dense
  // tick bursts can't clip (peak stays < 1.0 at the destination).
  function bus() {
    const ctx = ensureAudio(); if (!ctx) return null
    if (!audioRef.current.bus) {
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 6
      comp.attack.value = 0.002; comp.release.value = 0.12
      const master = ctx.createGain(); master.gain.value = 0.9
      comp.connect(master); master.connect(ctx.destination)
      audioRef.current.bus = comp
    }
    return audioRef.current.bus
  }
  // 2–4ms noise impulse through a 2–4kHz bandpass = mechanical click body.
  function clickLayer(ctx, out, t, { freq, vol, dur = 0.025 }) {
    const len = Math.floor(ctx.sampleRate * dur)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
    const src = ctx.createBufferSource(); src.buffer = buf
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.005)
    src.connect(bp); bp.connect(g); g.connect(out)
    src.start(t); src.stop(t + dur)
  }
  function woodLayer(ctx, out, t, { freq, vol, dur = 0.045 }) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.01)
  }
  function playTick() {   // mechanical ratchet click, ±10% pitch/volume humanized
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const out = bus(); const t = ctx.currentTime
    const j = 0.9 + Math.random() * 0.2
    clickLayer(ctx, out, t, { freq: 3000 * j, vol: 0.09 * j })
    woodLayer(ctx, out, t, { freq: 200 * j, vol: 0.05 * j })
  }
  function playChip() {   // bet/step clack — same recipe, lighter & tighter
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const out = bus(); const t = ctx.currentTime
    const j = 0.9 + Math.random() * 0.2
    clickLayer(ctx, out, t, { freq: 2200 * j, vol: 0.07 * j, dur: 0.02 })
    woodLayer(ctx, out, t, { freq: 260 * j, vol: 0.035 * j, dur: 0.035 })
  }
  function playLand() {   // pocket thunk: low noise + bass drop + lock knock
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const out = bus(); const t = ctx.currentTime
    // low noise body
    const len = Math.floor(ctx.sampleRate * 0.09)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ctx.createBufferSource(); src.buffer = buf
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320
    const ng = ctx.createGain(); ng.gain.value = 0.22
    src.connect(lp); lp.connect(ng); ng.connect(out); src.start(t); src.stop(t + 0.09)
    // bass drop
    const o = ctx.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.08)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, t)
    og.gain.exponentialRampToValueAtTime(0.22, t + 0.008)
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.11)
    // lock-in knock
    clickLayer(ctx, out, t + 0.01, { freq: 700, vol: 0.1, dur: 0.015 })
  }
  // Rising three-note chime, each note a detuned pair, with a short delay tail.
  function playWin() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const out = bus(); const t = ctx.currentTime
    const tail = ctx.createDelay(0.4); tail.delayTime.value = 0.16
    const fb = ctx.createGain(); fb.gain.value = 0.24
    const wet = ctx.createGain(); wet.gain.value = 0.35
    tail.connect(fb); fb.connect(tail); tail.connect(wet); wet.connect(out)
    ;[520, 690, 920].forEach((f, i) => {
      const s = t + i * 0.085
      ;[0.997, 1.004].forEach(dt => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * dt
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, s)
        g.gain.exponentialRampToValueAtTime(0.07, s + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
        o.connect(g); g.connect(out); g.connect(tail)
        o.start(s); o.stop(s + 0.32)
      })
    })
  }
  function playBig() {   // fire hit: metallic inharmonic overtones on top
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const out = bus(); const t = ctx.currentTime + 0.12
    ;[1380, 2210, 3170].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f
      const g = ctx.createGain()
      const s = t + i * 0.07
      g.gain.setValueAtTime(0.0001, s)
      g.gain.exponentialRampToValueAtTime(0.055, s + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.34)
      o.connect(g); g.connect(out); o.start(s); o.stop(s + 0.36)
    })
  }
  function playLose() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const out = bus(); const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.44)
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.46)
  }

  // rAF spring drive: writes translate3d straight to the strip node every
  // frame; ticks fire from actual cell-boundary crossings (max one per frame,
  // so they thin out naturally as the real velocity decays).
  function animateSpin(from, to, onDone) {
    const D = to - from
    const w = SPRING_W
    const C2 = w * D - SPRING_KICK * w * D   // = (1−KICK)·ωD
    const t0 = performance.now()
    let lastK = Math.floor(from / STEP)
    const step = now => {
      const t = (now - t0) / 1000
      const e = Math.exp(-w * t)
      const x = to - (D + C2 * t) * e
      const v = (w * (D + C2 * t) - C2) * e
      if (stripRef.current) stripRef.current.style.transform = `translate3d(${-x}px,0,0)`
      const k = Math.floor(x / STEP)
      if (k > lastK) { lastK = k; playTick() }
      const done = t > 0.25 && Math.abs(x - to) < 0.4 && Math.abs(v) < 10
      if (done || t > 6.5) {
        if (stripRef.current) stripRef.current.style.transform = `translate3d(${-to}px,0,0)`
        playLand()
        onDone()
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  function pushToast(label, mult, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label: `${label} ${mult}×`, win }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }

  // 押色 + 开滚 —— 落格/命中/赔付全走后端 /round/streak/play，动画滚到后端指定 idx。
  // 前端只提供 color + risk（风险档）；余额只认后端 balanceAfter。
  async function betOn(color) {
    if (bet < 1 || rolling || busyRef.current || (serverBalance != null && bet > serverBalance)) return
    busyRef.current = true
    ensureAudio(); playChip()
    setNetErr(null)
    setResult(null); setWinCell(null); setLossFlash(false)
    setRolling(true)

    const mode = highRisk ? 'high' : 'normal'
    let data
    try {
      data = await api.apiPlay(G.backendId, { amount: bet, color, risk: mode }, { autoBalance: false })
    } catch (e) {
      setNetErr(e.message); setRolling(false); busyRef.current = false; return
    }

    const pattern = mode === 'high' ? PATTERN_HIGH : PATTERN_NORMAL
    const L = pattern.length
    const idx = data.idx   // ← 后端指定落格（不再本地 Math.random）
    setFeedBets(makeFeedBots())
    // always travel FORWARD: next copy's idx-cell plus 2 extra laps (2–4 laps total)
    const cur = cellRef.current
    const landCell = (Math.floor(cur / L) + 1) * L + idx + 2 * L
    const target = centerOffset(landCell)
    cellRef.current = landCell
    rollingRef.current = true
    const prevOffset = offset

    animateSpin(prevOffset, target, () => {
      const eqCell = L + (landCell % L)
      cellRef.current = eqCell
      const landed = data.landed
      const win = data.win
      const mult = data.mult
      const payout = Number(data.payout)
      if (data.balanceAfter != null) setServerBalance(Number(data.balanceAfter))   // 余额只认后端
      if (win) {
        pushToast(COLOR_LABEL[color], mult, payout)
      } else {
        setLossFlash(true)
        if (lossTimerRef.current) clearTimeout(lossTimerRef.current)
        lossTimerRef.current = setTimeout(() => setLossFlash(false), 700)
      }
      setResult({ color, landed, mult, payout, win })
      setRoundHistory(h => [mult, ...h].slice(0, 20))
      setFeedBets(list => list.map(b => Math.random() < 0.45
        ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
        : { ...b, status: 'crashed' }))
      setWinCell(eqCell)
      setRolling(false)
      rollingRef.current = false
      busyRef.current = false
      setOffset(centerOffset(eqCell))
      if (win && landed === 'F') { playWin(); playBig() }
      else if (win) playWin()
      else playLose()
    })
  }
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the
  // centered DEMO pill would collide with the How-to-Play pill, so hide it
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const won = result && result.win
  const fireWin = result && result.win && result.landed === 'F'
  const mode = highRisk ? 'high' : 'normal'
  const strip = STRIPS[mode]
  const mults = MULTS[mode]

  // ---------- visual layer (Spribe Hotline 1:1) ----------
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: HOTLINE.bar, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const betBigBtn = (bg, fg) => ({
    minWidth: 108, padding: '9px 0', borderRadius: RADIUS.pill,
    background: bg, color: fg,
    border: '1px solid rgba(255,255,255,0.3)',
    fontSize: 13, fontWeight: 900, letterSpacing: 0.5,
    cursor: 'not-allowed', opacity: 0.92,
    display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.25,
  })
  const tri = up => ({
    width: 0, height: 0, margin: '0 auto',
    borderLeft: '9px solid transparent', borderRight: '9px solid transparent',
    [up ? 'borderBottom' : 'borderTop']: '10px solid rgba(255,255,255,0.75)',
  })

  // card face by color code: R red / B navy / F golden fire
  const cardFace = c => c === 'F'
    ? { background: `radial-gradient(circle at 50% 35%, ${HOTLINE.gold}, ${HOTLINE.fire} 55%, ${HOTLINE.fireDeep})`, border: `2px solid ${HOTLINE.gold}` }
    : c === 'R'
      ? { background: `linear-gradient(160deg, ${HOTLINE.cardRed}, ${HOTLINE.cardRedDeep})`, border: '2px solid rgba(255,255,255,0.25)' }
      : { background: HOTLINE.cardNavy, border: '2px solid rgba(0,0,0,0.3)' }

  // 速度线背景 — 6 条流光横线不同速单向穿过，避开滚条热区（中带 35–70% 留空）。
  // 绿底改版：蓝系在绿底上发脏，全部换现有白系 rgba（α 维持 0.25–0.45）。
  const SPEED_LINES = [
    { top: '11%', w: 180, h: 2, c: 'rgba(255,255,255,0.45)', dur: '3.2s', del: '0s' },
    { top: '18%', w: 90,  h: 1, c: 'rgba(255,255,255,0.30)', dur: '4.4s', del: '-1.6s' },
    { top: '26%', w: 220, h: 2, c: 'rgba(255,255,255,0.35)', dur: '2.8s', del: '-0.9s' },
    { top: '74%', w: 120, h: 1, c: 'rgba(255,255,255,0.25)', dur: '5s',   del: '-2.8s' },
    { top: '82%', w: 200, h: 2, c: 'rgba(255,255,255,0.40)', dur: '3.6s', del: '-2.1s' },
    { top: '90%', w: 70,  h: 1, c: 'rgba(255,255,255,0.30)', dur: '4.8s', del: '-0.4s' },
  ]
  // 看台剪影暗层 — shared 剪影 ×3 近大远小交错两组，压暗融进宝蓝底；
  // 贴速度线下带之下、注栏之上（bottom 按注栏高度让位），不碰滚条热区
  const SILHOUETTES = [
    { src: silKeeperUrl,  h: 88, left: '2%'  },
    { src: silStrikerUrl, h: 62, left: '15%' },
    { src: silTackleUrl,  h: 74, left: '28%' },
    { src: silStrikerUrl, h: 52, left: '43%' },
    { src: silKeeperUrl,  h: 70, left: '56%' },
    { src: silTackleUrl,  h: 56, left: '70%' },
    { src: silStrikerUrl, h: 84, left: '84%' },
  ]
  const speedLines = (
    <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <style>{`
        @keyframes srSpeedLine { from { transform: translateX(0); } to { transform: translateX(115vw); } }
        .srSpeed { animation: srSpeedLine var(--d) linear infinite; animation-delay: var(--dl); }
        @keyframes srLiveDot { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }
        .srLiveDot { animation: srLiveDot 2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .srSpeed { animation: none; }
          .srLiveDot { animation: none; opacity: 1; }
        }
      `}</style>
      {SPEED_LINES.map((l, i) => (
        <span key={i} className="srSpeed" style={{
          position: 'absolute', left: -240, top: l.top,
          width: l.w, height: l.h, borderRadius: 2,
          background: `linear-gradient(90deg, transparent, ${l.c}, transparent)`,
          '--d': l.dur, '--dl': l.del,
        }} />
      ))}
      {SILHOUETTES.map((s, i) => (
        <img key={i} src={s.src} alt="" draggable={false} style={{
          position: 'absolute', left: s.left,
          // 注栏之上让位：注栏折行越窄越高（移动 ~190 / 窄桌面 ~140 / 宽桌面单行）
          bottom: isMobile ? 200 : deskWide ? 84 : 150,
          height: s.h * (isMobile ? 0.7 : 1), width: 'auto',
          opacity: 0.1, filter: 'brightness(0.35)',
          pointerEvents: 'none',
        }} />
      ))}
    </div>
  )

  const gameCard = (
      <Panel style={{
        background: `radial-gradient(circle at 50% 30%, ${HOTLINE.bgCenter}, ${HOTLINE.bgOuter})`,
        borderColor: COLORS.border, padding: 0, overflow: 'hidden',
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        {speedLines}

        {/* ---- top bar（共享件：名 pill 下拉 + ?/音频钮；砍 DEMO/余额/HowTo pill）---- */}
        <GameTopBar balance={serverBalance ?? 0} venue={G.venue ?? G.displayName} band={HOTLINE.bar} onBack={onBack} onFairness={() => setFairOpen(true)} onHowTo={() => setRulesOpen(true)} />
        <SeedFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} playerToken={playerToken} game={G.backendId} />
        <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)} venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />

        <style>{`
          @keyframes srParticle { from { transform: translate(0,0); opacity:1 } to { transform: translate(var(--tx), var(--ty)); opacity:0 } }
          @keyframes srGlow { from { transform: translate(-50%,-50%) scale(0.4); opacity:0.85 } to { transform: translate(-50%,-50%) scale(2.3); opacity:0 } }
        `}</style>

        {/* ---- middle zone: flexes to fill the card, keeps the roll strip as
             the vertical visual center; leftover space is absorbed here ---- */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: isMobile ? '14px 12px' : '16px 18px', boxSizing: 'border-box',
        }}>

        {/* ---- thin progress row: bead left, small button right ---- */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 720, margin: '0 auto 18px', width: '100%' }}>
          <span style={{ width: 10, height: 10, borderRadius: RADIUS.pill, background: 'rgba(255,255,255,0.8)', flex: '0 0 auto' }} />
          <div style={{ flex: 1, height: 6, borderRadius: RADIUS.pill, background: HOTLINE.bar }} />
          <button type="button" disabled style={{
            padding: '3px 12px', borderRadius: RADIUS.pill, flex: '0 0 auto',
            background: HOTLINE.blue, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 11, fontWeight: 900, cursor: 'not-allowed',
          }}>⟲˅</button>
        </div>

        {/* ---- card strip band — 转播跑马灯化：LIVE 角标 + 频道条描边 ---- */}
        <div style={{
          background: HOTLINE.band, borderRadius: 14,
          padding: '10px 0 10px', margin: '0 auto', maxWidth: 860, width: '100%',
          boxSizing: 'border-box',
          position: 'relative',
          // 左右微内发光（白系，绿底改版），量级克制
          boxShadow: 'inset 10px 0 20px -12px rgba(255,255,255,0.22), inset -10px 0 20px -12px rgba(255,255,255,0.22)',
        }}>
          {/* 顶部频道条亮线（白系） */}
          <div style={{
            position: 'absolute', top: 0, left: 14, right: 14, height: 2, borderRadius: 2,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)',
            pointerEvents: 'none',
          }} />
          {/* LIVE 角标 — 红点 2s 呼吸（reduced-motion 常亮） */}
          <span style={{
            position: 'absolute', top: -10, left: 14, zIndex: 3,
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 10px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(249,87,109,0.6)',
          }}>
            <span className="srLiveDot" style={{
              width: 7, height: 7, borderRadius: '50%',
              background: HOTLINE.cardRed, boxShadow: '0 0 6px rgba(249,87,109,0.8)',
            }} />
            <span style={{ color: COLORS.white, fontSize: 9.5, fontWeight: 900, letterSpacing: 1.5 }}>LIVE</span>
          </span>
          <WinToast toasts={toasts} />
          <div style={tri(false)} />
          <div ref={viewRef} style={{
            position: 'relative', width: '100%', height: CARD_H + 12,
            overflow: 'hidden', margin: '8px 0',
          }}>
            {/* fade edges */}
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 60, zIndex: 2, background: `linear-gradient(90deg, ${HOTLINE.band}, transparent)` }} />
            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 60, zIndex: 2, background: `linear-gradient(270deg, ${HOTLINE.band}, transparent)` }} />

            {/* rolling strip — same offset/transition mechanics as before */}
            <div ref={stripRef} style={{
              display: 'flex', gap: GAP, position: 'absolute', top: 6, left: 0,
              transform: `translate3d(${-offset}px,0,0)`,
              willChange: 'transform',
            }}>
              {strip.map((c, i) => {
                const isWin = !rolling && winCell === i
                const dotSize = Math.round(CELL_W * 0.46)
                return (
                  <div key={i} style={{
                    width: CELL_W, height: CARD_H, flexShrink: 0, borderRadius: 10,
                    ...cardFace(c),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    // rendering diet: no per-card resting shadow — only the
                    // single winning card gets a glow after the roll stops
                    boxShadow: isWin ? `0 0 18px ${HOTLINE.gold}` : 'none',
                    transform: isWin ? 'scale(1.06)' : 'none',
                    fontSize: c === 'F' ? 28 : 8, lineHeight: 1,
                  }}>
                    {c === 'F'
                      ? <img src={flameUrl} alt="" draggable={false} style={{
                          height: 28, width: 'auto', pointerEvents: 'none', display: 'block',
                        }} />
                      : (
                        <span style={{
                          width: dotSize, height: dotSize, borderRadius: RADIUS.pill,
                          background: c === 'R' ? HOTLINE.cardRedDot : HOTLINE.cardNavyDot,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          opacity: c === 'R' ? 1 : 0.9,
                        }}>
                          <img src={ballUrl} alt="" draggable={false} style={{
                            width: Math.round(dotSize * 0.55), height: Math.round(dotSize * 0.55),
                            opacity: c === 'R' ? 1 : 0.9,
                            filter: c === 'R' ? 'none' : 'brightness(1.45) drop-shadow(0 0 4px rgba(255,255,255,0.6))',
                            pointerEvents: 'none', display: 'block',
                          }} />
                        </span>
                      )}
                  </div>
                )
              })}
            </div>

            {/* center golden selection frame — flashes red on a lost round */}
            <div style={{
              position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
              width: CELL_W + 14, height: CARD_H + 12, borderRadius: 12,
              border: `3px solid ${lossFlash ? HOTLINE.cardRed : HOTLINE.gold}`,
              boxShadow: lossFlash ? `0 0 16px ${HOTLINE.cardRed}` : '0 0 12px rgba(255,213,79,0.45)',
              transition: 'border-color 0.15s, box-shadow 0.15s',
              pointerEvents: 'none', zIndex: 3,
            }} />

            {/* win FX (fire hit): burst + glow at the pointer */}
            {won && fireWin && (
              <div key={`fx-${winCell}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
                <div style={{
                  position: 'absolute', left: '50%', top: '50%', width: 90, height: 90, borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(255,213,79,0.6), rgba(255,213,79,0))',
                  animation: 'srGlow 0.7s ease-out forwards',
                }} />
                {Array.from({ length: 14 }).map((_, k) => {
                  const a = (Math.PI * 2 * k) / 14
                  const dist = 70 + (k % 3) * 14
                  return (
                    <span key={k} style={{
                      position: 'absolute', left: '50%', top: '50%', width: 6, height: 6, borderRadius: '50%',
                      background: k % 2 ? '#fff3cd' : HOTLINE.gold,
                      '--tx': `${Math.cos(a) * dist}px`, '--ty': `${Math.sin(a) * dist}px`,
                      animation: 'srParticle 0.8s ease-out forwards', animationDelay: `${(k % 4) * 0.03}s`,
                    }} />
                  )
                })}
              </div>
            )}
          </div>
          <div style={tri(true)} />
        </div>

        {/* ---- High risk mode toggle — swaps distribution + payouts ---- */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button type="button" disabled={rolling} onClick={() => setHighRisk(v => !v)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '5px 16px', borderRadius: RADIUS.pill,
            background: HOTLINE.bar, border: `1px solid ${highRisk ? HOTLINE.gold : 'rgba(255,255,255,0.25)'}`,
            color: COLORS.white, fontSize: 12, fontWeight: 800,
            opacity: rolling ? 0.5 : 1, cursor: rolling ? 'not-allowed' : 'pointer',
          }}>
            <span style={{
              width: 30, height: 16, borderRadius: RADIUS.pill, position: 'relative',
              background: highRisk ? 'rgba(53,208,127,0.5)' : 'rgba(255,255,255,0.2)', display: 'inline-block',
              transition: 'background 0.15s',
            }}>
              <span style={{
                position: 'absolute', top: 2, left: highRisk ? 16 : 2, width: 12, height: 12,
                borderRadius: RADIUS.pill, background: highRisk ? '#35d07f' : 'rgba(255,255,255,0.7)',
                transition: 'left 0.15s, background 0.15s',
              }} />
            </span>
            High risk mode
          </button>
        </div>

        </div>{/* /middle zone */}

        {/* ---- bottom bet band — pinned to the card bottom, full-bleed strip ---- */}
        <div style={{
          flex: '0 0 auto',
          padding: '12px 18px',
          background: HOTLINE.bar,
          borderTop: '1px solid rgba(0,0,0,0.25)',
          display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
          position: 'relative', zIndex: 1,
        }}>
          <div style={{
            padding: '5px 22px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
            textAlign: 'center',
          }}>
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
            <input
              type="number" min="1" value={bet} disabled={rolling}
              onChange={e => setBet(Math.max(1, Number(e.target.value)))}
              style={{
                width: 72, background: 'transparent', border: 'none', textAlign: 'center',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" disabled={rolling} onClick={() => { playChip(); setBet(b => Math.max(1, b - 10)) }} style={{ ...circleBtn, opacity: rolling ? 0.5 : 1, cursor: rolling ? 'not-allowed' : 'pointer' }}>−</button>
          <button type="button" style={{ ...circleBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="筹码">
            {/* chip-stack icon drawn in CSS — the ≡ glyph rendered as a dash in this font */}
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
            </span>
          </button>
          <button type="button" disabled={rolling} onClick={() => { playChip(); setBet(b => b + 10) }} style={{ ...circleBtn, opacity: rolling ? 0.5 : 1, cursor: rolling ? 'not-allowed' : 'pointer' }}>+</button>
          <button type="button" disabled title="自动" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: HOTLINE.blue, color: COLORS.white,
            border: '2px solid rgba(255,255,255,0.4)',
            fontSize: 16, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          {/* three bet buttons — bet the amount on a color and roll */}
          {(() => {
            const locked = rolling || bet < 1 || (serverBalance != null && bet > serverBalance)
            const withLock = s => ({ ...s, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1 })
            return (
              <>
                <button type="button" disabled={locked} onClick={() => betOn('R')} style={withLock(betBigBtn(`linear-gradient(160deg, ${HOTLINE.cardRed}, ${HOTLINE.cardRedDeep})`, COLORS.white))}>
                  <span>RED</span><span>X{mults.R}</span>
                </button>
                <button type="button" disabled={locked} onClick={() => betOn('F')} style={withLock(betBigBtn(`radial-gradient(circle at 50% 30%, ${HOTLINE.gold}, ${HOTLINE.fireDeep})`, COLORS.white))}>
                  <img src={flameUrl} alt="" draggable={false} style={{
                    height: 16, width: 'auto', pointerEvents: 'none', display: 'block', margin: '0 auto',
                  }} /><span>X{mults.F}</span>
                </button>
                <button type="button" disabled={locked} onClick={() => betOn('B')} style={withLock(betBigBtn(HOTLINE.black, COLORS.white))}>
                  <span>BLACK</span><span>X{mults.B}</span>
                </button>
              </>
            )
          })()}
        </div>
        {netErr && (
          <div style={{ marginTop: 8, color: '#ff8a9a', fontSize: 12, fontWeight: 700, textAlign: 'center' }}>{netErr}</div>
        )}
      </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Team Keno ----
  if (isDesk) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640,
        background: COLORS.bg,
      }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            <div style={{ height: LAYOUT.historyH, flex: '0 0 auto', overflow: 'hidden' }}>
              <RoundHistoryBar rounds={roundHistory} />
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {gameCard}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- stacked layout (<1024): unchanged ----
  return (
    <GameLayout color={HOTLINE.blue}>
      {gameCard}
    </GameLayout>
  )
}
