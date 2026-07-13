import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DICE } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import WinToast from '../components/shell/WinToast'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import SeedFairness from '../components/shell/SeedFairness'
import HowToPlay from '../components/shell/HowToPlay'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'

const G = GAME_BY_ID['Dice']

// 单D2: Total Goals gameplay — 0–100 roll, UNDER/OVER settle, RTP-calibrated
// payouts. Slider sets the target line (4.00–96.00); the roll is uniform on
// [0,100] with 2 decimals.
//
// Payout calibration (replaces the D1 placeholder): payout = RTP·100/chance,
// RTP = 0.97. UNDER chance = target, OVER chance = 100 − target. Buttons, the
// Payout box and Potential win all go through payoutFor().
const RTP = 0.97
const TARGET_MIN = 4
const TARGET_MAX = 96
const ROLL_MS = 1200
const round2 = x => Math.round(x * 100) / 100
const payoutFor = chance => round2(RTP * 100 / chance)

// 玩法说明抽屉文案（照 DominoDuel 模板；数字取自本文件引擎实值，勿改）
const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '每局开出一个 0–100 的点数（保留 2 位小数，均匀分布）。你先拖动滑块把「目标线」设在 4–96 之间，再选押 UNDER 还是 OVER：\n· UNDER：开点严格小于目标线才赢（正好等于目标线不算赢）。\n· OVER：开点严格大于目标线才赢（正好等于目标线不算赢）。',
  },
  {
    icon: '📊', title: '赔率与中奖率',
    body: '赔率 = 97% × 100 ÷ 中奖率，目标线越靠近能赢的一侧、中奖率越高、赔率越低；反之赔率越高。\n· UNDER 中奖率 = 目标线数值%，赔率 = 97 ÷ 目标线。\n· OVER 中奖率 =（100 − 目标线）%，赔率 = 97 ÷（100 − 目标线）。\n面板会实时显示当前 Payout（赔率）、Chance（中奖率）与 Potential win（可赢金额）。本游戏理论返还率（RTP）约 97%。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '用 − / + 或输入框设定每注金额（USD），拖滑块选好目标线后，点 UNDER 或 OVER 按钮即下注。开点由服务器算出，落定后按结果结算，赢的赔付直接入余额。每局独立，上一局不影响下一局。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 想稳一点：把目标线拖向能赢的一侧，中奖率高但赔率低。\n· 想搏大赔：把目标线拖向另一侧，中奖率低但赔率高。\n· 注意两侧都是「严格不等」，开点正好落在目标线上，UNDER 和 OVER 都不算赢。\n· 娱乐为主，理性游戏。',
  },
]

// slider handle: block-face football (white ball, black patches — no star)
function BallHandle({ size = 24 }) {
  const patch = 'M12,2.2 L14.6,3.1 L15.2,5.6 L12,7.2 L8.8,5.6 L9.4,3.1 Z'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="11" fill="#f5f7fa" stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
      <polygon points="12,8.6 15.2,10.9 14,14.7 10,14.7 8.8,10.9" fill="#16181d" />
      {[0, 72, 144, 216, 288].map(a => (
        <path key={a} d={patch} fill="#16181d" transform={`rotate(${a} 12 12)`} />
      ))}
    </svg>
  )
}

export default function Dice({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const isMobile = useIsMobile()
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })   // 统一后端封装（鉴权/401登出/余额回写/幂等）
  const [bet, setBet] = useState(10)
  const [target, setTarget] = useState(48.5)     // slider-set target line
  const [rolling, setRolling] = useState(false)
  const [, setResult] = useState(null)
  const [history, setHistory] = useState([])     // real rolls {v, win}, newest first
  const [toasts, setToasts] = useState([])
  const [numColor, setNumColor] = useState(null) // null | 'win' | 'lose'
  const [proof, setProof] = useState(null)       // 最近一局：{ serverSeed, commitHash } 供玩家自行验证
  const [fairOpen, setFairOpen] = useState(false) // 可验证公平抽屉（批B纯UI）
  const [rulesOpen, setRulesOpen] = useState(false) // 玩法说明抽屉
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // fake feed rows (display only)
  const audioRef = useRef({ ctx: null, bus: null, muted: false })
  const trackRef = useRef(null)
  const dragRef = useRef(false)
  const numRef = useRef(null)
  const ballRef = useRef(null)
  const shownRef = useRef(50)                    // currently displayed roll value
  const rafRef = useRef(null)
  const lossTimerRef = useRef(null)
  const toastIdRef = useRef(0)

  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (lossTimerRef.current) clearTimeout(lossTimerRef.current)
  }, [])

  // ---------- audio (mechanical recipe, shared compressor bus — Hotline) ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
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
    const len = Math.floor(ctx.sampleRate * 0.09)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ctx.createBufferSource(); src.buffer = buf
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320
    const ng = ctx.createGain(); ng.gain.value = 0.22
    src.connect(lp); lp.connect(ng); ng.connect(out); src.start(t); src.stop(t + 0.09)
    const o = ctx.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.08)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, t)
    og.gain.exponentialRampToValueAtTime(0.22, t + 0.008)
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.11)
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
  function playLose() {   // muffled descending thud
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const out = bus(); const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.44)
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.46)
  }

  const underChance = target                       // UNDER wins roll < target
  const overChance = round2(100 - target)          // OVER wins roll > target
  const payoutUnder = payoutFor(underChance)
  const payoutOver = payoutFor(overChance)
  const sliderPos = (target - TARGET_MIN) / (TARGET_MAX - TARGET_MIN)

  function targetFromPointer(e) {
    const r = trackRef.current.getBoundingClientRect()
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    setTarget(round2(TARGET_MIN + p * (TARGET_MAX - TARGET_MIN)))
  }
  function onDown(e) {
    if (rolling) return
    dragRef.current = true
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointers */ }
    targetFromPointer(e)
  }
  function onMove(e) { if (dragRef.current && !rolling) targetFromPointer(e) }
  function onUp() { dragRef.current = false }

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }

  // ~1.2s ease-out roll: ball + big number driven per frame via refs.
  // Ticks fire on 2-point boundary crossings of the eased value, so they
  // thin out naturally with the deceleration; a thunk lands at the stop.
  function animateRoll(to, onDone) {
    const from = shownRef.current
    let t0 = null
    let lastK = Math.floor(from / 2)
    const step = now => {
      if (t0 === null) t0 = now
      const t = Math.min(1, (now - t0) / ROLL_MS)
      const e = 1 - Math.pow(1 - t, 3)
      const v = from + (to - from) * e
      shownRef.current = v
      if (numRef.current) numRef.current.textContent = v.toFixed(2)
      if (ballRef.current) ballRef.current.style.left = `${v}%`
      const k = Math.floor(v / 2)
      if (k !== lastK) { lastK = k; playTick() }
      if (t < 1) rafRef.current = requestAnimationFrame(step)
      else { playLand(); onDone() }
    }
    rafRef.current = requestAnimationFrame(step)
  }

  // 开奖服务器算，不信前端：只把下注参数（金额/target/方向）传给后端，
  // roll/win/payout/余额全部以后端返回为准，本地不再算一分钱。
  async function betOn(side) {
    // 余额以服务器为准：登录后尚未拿到过 balanceAfter 时 serverBalance 为 null——
    // 此时不在前端拦截「余额不足」，交给后端 debit() 判断（真不够会返回 400，toast 会显示）。
    if (rolling || bet < 1 || (serverBalance != null && bet > serverBalance)) return
    ensureAudio()
    playChip()
    setRolling(true)
    setResult(null)
    setNumColor(null)
    if (lossTimerRef.current) clearTimeout(lossTimerRef.current)
    setFeedBets(makeFeedBots())   // fresh fake round rides along (display only; after the roll)

    let data
    try {
      // autoBalance:false —— 余额不即时回写，留到骰子落定回调（保留原视觉时序）；幂等键由 apiPlay 内部生成
      data = await api.apiPlay(G.backendId, { amount: bet, target, direction: side }, { autoBalance: false })
    } catch (err) {
      setRolling(false)
      // 服务端业务错（有 err.data）沿用原「下注失败」兜底；网络层异常（无 err.data）显「网络异常」
      if (err?.data) pushToast(err.data.error || '下注失败，请重试', 0)
      else pushToast('网络异常，请稍后重试', 0)
      return
    }

    const { roll, win, payout, balanceAfter, serverSeedHash, nonce } = data
    const pay = Number(payout)

    animateRoll(roll, () => {
      setServerBalance(Number(balanceAfter))   // 余额只认后端 balanceAfter，落定瞬间才回写（不本地加减）
      setProof({ serverSeedHash, nonce })
      if (win) {
        pushToast(`开点 ${roll.toFixed(2)}`, pay)
        setNumColor('win')
        playWin()
      } else {
        setNumColor('lose')
        lossTimerRef.current = setTimeout(() => setNumColor(null), 700)
        playLose()
      }
      setResult({ roll, win, side, payout: pay })
      setHistory(h => [{ v: roll, win }, ...h].slice(0, 12))
      // fake feed rows settle for the round: ~45% cash green, the rest grey out
      setFeedBets(list => list.map(b => Math.random() < 0.45
        ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
        : { ...b, status: 'crashed' }))
      setRolling(false)
    })
  }

  // ---------- visual layer (Spribe Dice 1:1, green felt) ----------
  // Pitch-scene shades — derived from the DICE felt greens (bgOuter #0a5526 /
  // bgCenter #1c8f45), darkened/lightened in place. Local to this scene only.
  const TURF_DARK = '#07401c'
  const TURF_LIGHT = '#0e6a30'
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: DICE.band, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const ribbed = color => `repeating-linear-gradient(90deg, ${color} 0px, ${color} 3px, rgba(0,0,0,0.5) 3px, rgba(0,0,0,0.5) 5px)`
  const bigBtn = (bg, locked) => ({
    minWidth: 118, padding: '8px 0', borderRadius: RADIUS.pill,
    background: bg, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.3)',
    fontSize: 13, fontWeight: 900, letterSpacing: 0.5,
    cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1,
    display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.3,
  })
  const locked = rolling || bet < 1 || (serverBalance != null && bet > serverBalance)
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the

  // roll-value pill strip — desktop renders it in the 34px skeleton row,
  // mobile keeps it inside the card (never both)
  const historyStrip = (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: DICE.band, borderRadius: RADIUS.pill,
          padding: '4px 6px', overflow: 'hidden', minHeight: 24,
        }}>
          {(isMobile ? history.slice(0, 5) : history.slice(0, 10)).map((h, i) => (
            <span key={history.length - i} style={{
              padding: '3px 10px', borderRadius: RADIUS.pill,
              background: h.win ? 'rgba(46,224,140,0.18)' : 'rgba(0,0,0,0.3)',
              color: h.win ? DICE.teal : 'rgba(255,255,255,0.55)',
              fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
            }}>{h.v.toFixed(2)}</span>
          ))}
          <span style={{
            marginLeft: 'auto', padding: '3px 12px', borderRadius: RADIUS.pill,
            background: DICE.circleBlue, color: COLORS.white,
            fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
          }}>⟲ ˅</span>
        </div>
  )

  // Pitch backdrop — decoration only: absolutely positioned, pointer-events
  // none, below the content layer. Stripes/glow loop via CSS animation.
  const pitchScene = (
    <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <style>{`
        @keyframes dgTurfDrift { from { background-position-x: 0px; } to { background-position-x: 180px; } }
        @keyframes dgGlowBreath { 0% { opacity: 0.10; } 50% { opacity: 0.22; } 100% { opacity: 0.10; } }
        .dgTurf { animation: dgTurfDrift 14s linear infinite; }
        .dgGlow { animation: dgGlowBreath 6s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .dgTurf, .dgGlow { animation: none; }
        }
      `}</style>
      {/* perspective turf — alternating stripe shades, slow sideways drift */}
      <div className="dgTurf" style={{
        position: 'absolute', left: '-25%', right: '-25%', bottom: '-4%', height: '62%',
        background: `repeating-linear-gradient(90deg, ${TURF_DARK} 0px, ${TURF_DARK} 90px, ${TURF_LIGHT} 90px, ${TURF_LIGHT} 180px)`,
        transform: 'perspective(520px) rotateX(58deg)',
        transformOrigin: '50% 100%',
        opacity: 0.55,
      }} />
      {/* white center-circle arc — hugs the card bottom, centered */}
      <div style={{
        position: 'absolute', left: '50%', bottom: 0, transform: 'translate(-50%, 55%)',
        width: 'min(46%, 420px)', aspectRatio: '1 / 1', borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.28)',
      }} />
      {/* distant goal-frame silhouette + goal line, upper area */}
      <div style={{
        position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)',
        width: 190, height: 56,
        border: '2px solid rgba(255,255,255,0.24)', borderBottom: 'none',
        borderRadius: '3px 3px 0 0',
        background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.10) 0px, rgba(255,255,255,0.10) 1px, transparent 1px, transparent 14px)',
      }} />
      <div style={{
        position: 'absolute', top: 'calc(10% + 56px)', left: '50%', transform: 'translateX(-50%)',
        width: 300, height: 2, background: 'rgba(255,255,255,0.20)',
      }} />
      {/* stadium light spill — breathes between 0.10 and 0.22 */}
      <div className="dgGlow" style={{
        position: 'absolute', top: '-18%', left: '50%', transform: 'translateX(-50%)',
        width: '80%', height: '55%',
        background: 'radial-gradient(ellipse at 50% 0%, #ffffff 0%, transparent 65%)',
        opacity: 0.14,
      }} />
    </div>
  )

  const gameCard = (
      <Panel style={{
        background: `radial-gradient(circle at 50% 30%, ${DICE.bgCenter}, ${DICE.bgOuter})`,
        borderColor: COLORS.border, padding: 0, overflow: 'hidden',
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        {pitchScene}

        {/* ---- top bar（共享件：名 pill 下拉 + ?/音频钮；砍 DEMO/余额/HowTo pill）---- */}
        <GameTopBar balance={serverBalance ?? 0} venue={G.venue ?? G.displayName} band={DICE.band} onBack={onBack} onHowTo={() => setRulesOpen(true)} onFairness={() => setFairOpen(true)} />
        <SeedFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} playerToken={playerToken} game={G.backendId} />
        <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)} venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />

        {/* ---- roll history strip (mobile only — desktop row has it) ---- */}
        {!isDesk && <div style={{ padding: '12px 12px 0', position: 'relative', zIndex: 1 }}>{historyStrip}</div>}

        {/* ---- middle zone: flexes to fill the card, keeps the roll area as
             the vertical visual center; leftover space is absorbed here so no
             bare felt strip is left above the bet band ---- */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: isMobile ? '14px 12px' : '18px 18px',
        }}>

        {/* ---- main track panel: big number + double scale bands + ball ---- */}
        <div style={{
          background: DICE.panel, border: '1px solid rgba(0,0,0,0.25)',
          borderRadius: 12, padding: isMobile ? '14px 12px 10px' : '18px 16px 12px',
          marginBottom: 16, position: 'relative',
        }}>
          <WinToast toasts={toasts} />
          <div ref={numRef} style={{
            textAlign: 'center',
            color: numColor === 'win' ? DICE.teal : numColor === 'lose' ? '#ff5a6e' : COLORS.white,
            fontSize: isMobile ? 44 : 60, fontWeight: 900, lineHeight: 1.1,
            fontFamily: "'Space Grotesk', sans-serif", marginBottom: 12,
            transition: 'color 0.15s',
          }}>50.00</div>

          <div style={{ position: 'relative', padding: '10px 0 4px' }}>
            {[0, 25, 50, 75, 100].map(p => (
              <span key={p} style={{
                position: 'absolute', top: 0, left: `${p}%`, width: 1, height: 7,
                background: 'rgba(255,255,255,0.65)',
                transform: p === 0 ? 'none' : p === 100 ? 'translateX(-1px)' : 'translateX(-0.5px)',
              }} />
            ))}

            {/* upper band — OVER: lose 0→target red, win target→100 blue */}
            <div style={{ display: 'flex', height: 28, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${target}%`, background: ribbed(DICE.red) }} />
              <div style={{ flex: 1, background: ribbed(DICE.blue) }} />
            </div>

            {/* golden landing ball — rides the roll animation */}
            <div style={{ position: 'relative', height: 10, margin: '−2px 0' }}>
              <div ref={ballRef} style={{
                position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                width: 26, height: 26, borderRadius: '50%',
                background: DICE.ball, border: '2px solid rgba(0,0,0,0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16181d' }} />
              </div>
            </div>

            {/* lower band — UNDER: win 0→target teal, lose target→100 red */}
            <div style={{ display: 'flex', height: 28, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${target}%`, background: ribbed(DICE.teal) }} />
              <div style={{ flex: 1, background: ribbed(DICE.red) }} />
            </div>

            <div style={{ position: 'relative', height: 16, marginTop: 4 }}>
              {[0, 25, 50, 75, 100].map(p => (
                <span key={p} style={{
                  position: 'absolute', left: `${p}%`, top: 0,
                  transform: p === 0 ? 'none' : p === 100 ? 'translateX(-100%)' : 'translateX(-50%)',
                  color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: 700,
                }}>{p}</span>
              ))}
            </div>
          </div>
        </div>

        {/* ---- payout panel: UNDER-side readout + target slider ---- */}
        <div style={{
          maxWidth: 470, width: '100%', margin: '0 auto', boxSizing: 'border-box',
          background: DICE.panel, border: '1px solid rgba(0,0,0,0.25)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: isMobile ? '10px 12px' : '12px 16px',
          }}>
            <div style={{ flex: '0 0 auto', textAlign: 'center' }}>
              <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Payout</div>
              <div style={{
                padding: '6px 18px', borderRadius: 8,
                background: DICE.panelDeep, border: '1px solid rgba(255,255,255,0.3)',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}>{payoutUnder.toFixed(2)} x</div>
            </div>
            <div
              ref={trackRef}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
              style={{
                flex: 1, position: 'relative', height: 34,
                cursor: rolling ? 'not-allowed' : 'pointer', touchAction: 'none',
                opacity: rolling ? 0.6 : 1,
              }}
            >
              <div style={{
                position: 'absolute', left: 0, right: 0, top: 12, height: 6,
                borderRadius: 3, background: DICE.panelDeep, border: '1px solid rgba(0,0,0,0.4)',
              }} />
              <div style={{
                position: 'absolute', left: 2, right: 2, top: 22, height: 5,
                background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.35) 0px, rgba(255,255,255,0.35) 1px, transparent 1px, transparent 7px)',
              }} />
              <div style={{
                position: 'absolute', top: 3, left: `${sliderPos * 100}%`,
                transform: 'translateX(-50%)', pointerEvents: 'none',
              }}>
                <BallHandle size={24} />
              </div>
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 16px', background: DICE.panelDeep,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: 700 }}>
              Potential win: <span style={{ color: COLORS.white, fontSize: 13, fontWeight: 900 }}>{round2(bet * payoutUnder).toFixed(2)} USD</span>
            </span>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: 700 }}>
              Chance: <span style={{ color: COLORS.white, fontSize: 13, fontWeight: 900 }}>{underChance.toFixed(2)} %</span>
            </span>
          </div>
        </div>

        {/* ---- 可验证公平：显示上一局的 serverSeed + commit hash，玩家可用
             clientSeed/nonce/serverSeed 自行重算校验 roll 未被篡改 ---- */}
        {proof && (
          <div style={{
            textAlign: 'center', marginTop: 8, fontSize: 10, fontWeight: 600,
            color: 'rgba(255,255,255,0.4)', wordBreak: 'break-all',
          }}>
            可验证 · hash: {proof.serverSeedHash?.slice(0, 16)}… · nonce: {proof.nonce}
          </div>
        )}

        </div>{/* /middle zone */}

        {/* ---- bottom bet band — pinned to the card bottom, full-bleed strip
             (Breakaway-style bottom bar, styles local to this card) ---- */}
        <div style={{
          flex: '0 0 auto', position: 'relative', zIndex: 1,
          padding: '12px 14px',
          background: DICE.band,
          borderTop: '1px solid rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, flexWrap: 'wrap',
        }}>
          <div style={{
            padding: '5px 18px', borderRadius: RADIUS.pill,
            background: DICE.panelDeep, border: '1px solid rgba(255,255,255,0.3)',
            textAlign: 'center', lineHeight: 1.2,
            opacity: rolling ? 0.6 : 1,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>投注额</div>
            <input
              value={bet}
              disabled={rolling}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 56, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" disabled={rolling} onClick={() => { playChip(); setBet(b => Math.max(1, b - 10)) }} style={{ ...circleBtn, opacity: rolling ? 0.5 : 1, cursor: rolling ? 'not-allowed' : 'pointer' }}>−</button>
          <button type="button" style={{ ...circleBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="筹码">
            {/* chip-stack icon drawn in CSS — the ≡ glyph renders as a dash in this font */}
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
            </span>
          </button>
          <button type="button" disabled={rolling} onClick={() => { playChip(); setBet(b => b + 10) }} style={{ ...circleBtn, opacity: rolling ? 0.5 : 1, cursor: rolling ? 'not-allowed' : 'pointer' }}>+</button>
          <button type="button" disabled title="刷新" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: DICE.circleBlue, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 17, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          <button type="button" disabled={locked} onClick={() => betOn('under')} style={bigBtn(DICE.btnUnder, locked)}>
            <span>UNDER</span>
            <span style={{ fontSize: 12, opacity: 0.9 }}>↓ X{payoutUnder.toFixed(2)}</span>
          </button>
          <button type="button" disabled={locked} onClick={() => betOn('over')} style={bigBtn(DICE.btnOver, locked)}>
            <span>OVER</span>
            <span style={{ fontSize: 12, opacity: 0.9 }}>↑ X{payoutOver.toFixed(2)}</span>
          </button>
        </div>
      </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Hotline ----
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
              {historyStrip}
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
    <GameLayout color={DICE.teal}>
      {gameCard}
    </GameLayout>
  )
}
