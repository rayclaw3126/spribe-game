import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, PLINKO } from '../components/shell/tokens'
import { useIsMobile } from '../hooks/useMediaQuery'
import WinToast from '../components/shell/WinToast'
import bgmUrl from '../assets/covers/bgm.mp3'

// 单P2: Free Kick gameplay — three risk tiers, binomial physics drop,
// adjustable pins, RTP-calibrated paytables.
//
// 赔率推导（禁拍脑袋）:
//   N 行钉 → N+1 落格，落格 k 的概率是二项分布 p(k) = C(N,k) / 2^N
//   （每行独立左右各 1/2，k = 向右次数 —— 落格与飞行路径同一映射）。
//   档位曲线 raw(k) = floor + d(k)^γ，d = |2k−N|/N ∈ [0,1] 是归一化边距：
//     green  γ=3, floor=0.25  （平缓）
//     yellow γ=5, floor=0.02  （陡）
//     red    γ=8, floor=0.001 （极陡，边缘大奖）
//   归一化 s = RTP / Σ p(k)·raw(k)，mult(k) = round(s·raw(k))，RTP = 0.95。
//   四舍五入(≥10 取整、<10 一位小数)引入 <±1% 偏差，表值即结算值。
const RTP = 0.95
const TIERS = {
  green: { gamma: 3, floor: 0.25 },
  yellow: { gamma: 5, floor: 0.02 },
  red: { gamma: 8, floor: 0.001 },
}
const DROP_MS_TOTAL = 2500          // ~2.5s of row-by-row bouncing
const PINS_MIN = 8
const PINS_MAX = 16
const round2 = x => Math.round(x * 100) / 100
const roundMult = x => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10)

function binomProbs(n) {
  const c = [1]
  for (let r = 0; r < n; r++) for (let i = c.length - 1; i >= 0; i--) c[i + 1] = (c[i + 1] || 0) + c[i]
  const denom = Math.pow(2, n)
  return c.map(v => v / denom)
}
function multsFor(n, tier) {
  const { gamma, floor } = TIERS[tier]
  const probs = binomProbs(n)
  const raw = probs.map((_, k) => floor + Math.pow(Math.abs(2 * k - n) / n, gamma))
  const s = RTP / raw.reduce((acc, r, k) => acc + probs[k] * r, 0)
  return raw.map(r => roundMult(s * r))
}
// module-level randomness: one L/R per pin row (event-time only)
const randomPath = n => Array.from({ length: n }, () => (Math.random() < 0.5 ? 1 : 0))

// ---------- audio (module-level, mechanical recipe + shared compressor bus) ----------
function ensureAudio(audio) {
  if (audio.ctx) return audio.ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
  audio.ctx = ctx; return ctx
}
function bus(audio) {
  const ctx = ensureAudio(audio); if (!ctx) return null
  if (!audio.bus) {
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 6
    comp.attack.value = 0.002; comp.release.value = 0.12
    const master = ctx.createGain(); master.gain.value = 0.9
    comp.connect(master); master.connect(ctx.destination)
    audio.bus = comp
  }
  return audio.bus
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
// pin hit — crisp metallic ding: short high sine + faint triangle overtone,
// pitch climbs with the row (2.2k→3.6kHz) with ±10% humanizing
function sfxTick(audio, row = 0, rows = 14) {
  const ctx = ensureAudio(audio); if (!ctx || audio.muted) return
  const out = bus(audio); const t = ctx.currentTime
  const j = 0.9 + Math.random() * 0.2
  const f = (2200 + (row / Math.max(1, rows - 1)) * 1400) * j
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.06 * j, t + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.06)
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 1.5
  const g2 = ctx.createGain()
  g2.gain.setValueAtTime(0.0001, t)
  g2.gain.exponentialRampToValueAtTime(0.02 * j, t + 0.002)
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
  o2.connect(g2); g2.connect(out); o2.start(t); o2.stop(t + 0.05)
}
function sfxChip(audio) {
  const ctx = ensureAudio(audio); if (!ctx || audio.muted) return
  const out = bus(audio); const t = ctx.currentTime
  const j = 0.9 + Math.random() * 0.2
  clickLayer(ctx, out, t, { freq: 2200 * j, vol: 0.07 * j, dur: 0.02 })
  woodLayer(ctx, out, t, { freq: 260 * j, vol: 0.035 * j, dur: 0.035 })
}
function sfxLand(audio) {   // pocket thunk
  const ctx = ensureAudio(audio); if (!ctx || audio.muted) return
  const out = bus(audio); const t = ctx.currentTime
  const len = Math.floor(ctx.sampleRate * 0.09)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = ctx.createBufferSource(); src.buffer = buf
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320
  const ng = ctx.createGain(); ng.gain.value = 0.18
  src.connect(lp); lp.connect(ng); ng.connect(out); src.start(t); src.stop(t + 0.09)
  const o = ctx.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.08)
  const og = ctx.createGain()
  og.gain.setValueAtTime(0.0001, t)
  og.gain.exponentialRampToValueAtTime(0.18, t + 0.008)
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
  o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.11)
}
function sfxChime(audio) {   // big-hit chime (mult ≥ 10)
  const ctx = ensureAudio(audio); if (!ctx || audio.muted) return
  const out = bus(audio); const t = ctx.currentTime
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

const ROW_BG = { green: PLINKO.rowGreen, yellow: PLINKO.rowYellow, red: PLINKO.rowRed }
const ROW_DIM = { green: PLINKO.rowGreenDim, yellow: PLINKO.rowYellowDim, red: PLINKO.rowRedDim }

// small football: white ball, center pentagon + edge patches (block faces)
function Football({ size = 16 }) {
  const patch = 'M12,2.2 L14.6,3.1 L15.2,5.6 L12,7.2 L8.8,5.6 L9.4,3.1 Z'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="11" fill={PLINKO.ball} stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
      <polygon points="12,8.6 15.2,10.9 14,14.7 10,14.7 8.8,10.9" fill="#16181d" />
      {[0, 72, 144, 216, 288].map(a => (
        <path key={a} d={patch} fill="#16181d" transform={`rotate(${a} 12 12)`} />
      ))}
    </svg>
  )
}

export default function Plinko({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const [bet, setBet] = useState(10)
  const [pins, setPins] = useState(14)
  const [pinsOpen, setPinsOpen] = useState(false)
  const [balls, setBalls] = useState([])           // flying balls (render list)
  const [history, setHistory] = useState([])       // real results {v, c}, newest first
  const [toasts, setToasts] = useState([])
  const [flash, setFlash] = useState(null)         // { tier, k } landing cell glow
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)
  const ballsRef = useRef([])
  const rafRef = useRef(null)
  const ballIdRef = useRef(0)
  const toastIdRef = useRef(0)
  const flashTimerRef = useRef(null)
  const audioRef = useRef({ ctx: null, bus: null, muted: false })
  const bgmRef = useRef({ audio: null })

  const TABLE = {
    green: multsFor(pins, 'green'),
    yellow: multsFor(pins, 'yellow'),
    red: multsFor(pins, 'red'),
  }
  const flying = balls.length > 0

  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => {
    if (bgmOn) { if (!bgmRef.current.audio) { const a = new Audio(bgmUrl); a.loop = true; a.volume = 0.25; a.play().catch(() => {}); bgmRef.current.audio = a } }
    else if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null }
  }, [bgmOn])
  useEffect(() => () => {
    if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
  }, [])

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }

  // ---------- drop physics: one continuous rAF over all flying balls ----------
  // Ball x walks the binomial path (±half-step per row), y hops row to row
  // with a small sine arc; the same path sum k picks the landing slot, so
  // the flight and the settlement can never disagree.
  function settleBall(ball) {
    const payout = round2(ball.bet * ball.mult)
    sfxLand(audioRef.current)
    if (payout > 0) setBalance(b => round2(b + payout))
    if (ball.mult >= 1) pushToast(`${ball.mult}×`, payout)
    if (ball.mult >= 10) sfxChime(audioRef.current)
    setHistory(h => [{ v: String(ball.mult), c: ball.tier }, ...h].slice(0, 12))
    setFlash({ tier: ball.tier, k: ball.k })
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlash(null), 600)
  }
  function frame(now) {
    const list = ballsRef.current
    const done = []
    for (const ball of list) {
      if (ball.start == null) ball.start = now
      const segDur = DROP_MS_TOTAL / ball.pins
      const t = now - ball.start
      const seg = Math.min(ball.pins, Math.floor(t / segDur))   // last seg = fall into slot
      if (seg > ball.seg) {
        for (let s = ball.seg + 1; s <= Math.min(seg, ball.pins - 1); s++) sfxTick(audioRef.current, s, ball.pins)
        ball.seg = seg
      }
      const stepX = 100 / (ball.pins + 1)
      const xAt = i => 50 + (ball.path.slice(0, i).reduce((a, b) => a + b, 0) - i / 2) * stepX
      const yAt = i => (i < 0 ? -2 : 4 + (i / (ball.pins - 1)) * 93) * 0.93   // % of board box
      const p = Math.min(1, (t - seg * segDur) / segDur)
      let x, y
      if (seg < ball.pins) {
        x = xAt(seg) + (xAt(seg + 1) - xAt(seg)) * p
        y = yAt(seg - 1) + (yAt(seg) - yAt(seg - 1)) * p - Math.sin(p * Math.PI) * 1.6
      } else {
        x = xAt(ball.pins)
        y = yAt(ball.pins - 1) + (104 - yAt(ball.pins - 1)) * p
      }
      ball.rot += (ball.path[Math.min(seg, ball.pins - 1)] ? 1 : -1) * 6
      if (ball.node) ball.node.style.transform = `translate(-50%,-50%) rotate(${ball.rot}deg)`
      if (ball.node) { ball.node.style.left = `${x}%`; ball.node.style.top = `${y}%` }
      if (seg >= ball.pins && p >= 1) done.push(ball)
    }
    if (done.length) {
      ballsRef.current = list.filter(b => !done.includes(b))
      setBalls([...ballsRef.current])
      done.forEach(settleBall)
    }
    if (ballsRef.current.length) rafRef.current = requestAnimationFrame(frame)
    else rafRef.current = null
  }
  function kick(tier) {
    if (bet > balance || bet < 1) return
    const path = randomPath(pins)   // path first — SFX jitter randoms must not sit ahead
    ensureAudio(audioRef.current)
    sfxChip(audioRef.current)
    setBalance(b => round2(b - bet))
    const k = path.reduce((a, b) => a + b, 0)
    const ball = {
      id: ++ballIdRef.current, tier, bet, path, k, pins,
      mult: TABLE[tier][k],       // captured now — pins switches can't retarget it
      start: null, seg: -1, rot: 0, node: null,
    }
    ballsRef.current = [...ballsRef.current, ball]
    setBalls([...ballsRef.current])
    if (!rafRef.current) rafRef.current = requestAnimationFrame(frame)
  }

  // ---------- visual layer (Spribe Plinko 1:1, pitch green) ----------
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: PLINKO.band, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const locked = bet > balance || bet < 1
  const bigBtn = bg => ({
    minWidth: 96, padding: '11px 0', borderRadius: RADIUS.pill,
    background: bg, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.3)',
    fontSize: 13, fontWeight: 900, letterSpacing: 0.5,
    cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1,
  })

  const pinRows = []
  for (let r = 0; r < pins; r++) pinRows.push({ count: 3 + r, y: (r / (pins - 1)) * 100 })
  const xFor = (row, i) => {
    const spread = (row.count - 1) / (pins + 1)
    const start = 0.5 - spread / 2
    return (start + (row.count === 1 ? 0 : (i / (row.count - 1)) * spread)) * 100
  }

  return (
    <GameLayout title="Free Kick" emoji="⚽" color={PLINKO.btnGreen}>
      <Panel style={{
        background: `radial-gradient(circle at 50% 42%, ${PLINKO.bgCenter}, ${PLINKO.bgOuter})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
        position: 'relative',
      }}>
        {/* pitch markings — two big side circles + corner arc, like the ref */}
        <div style={{
          position: 'absolute', left: -130, top: '46%', width: 260, height: 260,
          border: `2px solid ${PLINKO.line}`, borderRadius: '50%',
          transform: 'translateY(-50%)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', right: -130, top: '46%', width: 260, height: 260,
          border: `2px solid ${PLINKO.line}`, borderRadius: '50%',
          transform: 'translateY(-50%)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', left: -60, bottom: -60, width: 120, height: 120,
          border: `2px solid ${PLINKO.line}`, borderRadius: '50%',
          pointerEvents: 'none',
        }} />

        {/* ---- top bar ---- */}
        <div style={{
          margin: isMobile ? '-12px -12px 12px' : '-18px -18px 14px',
          padding: '8px 14px',
          background: PLINKO.band,
          display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
        }}>
          <span style={navPill}>FREE KICK ▾</span>
          <span style={{
            padding: '5px 14px', borderRadius: RADIUS.pill,
            background: PLINKO.orange, color: COLORS.white,
            fontSize: 12, fontWeight: 900,
          }}>? How to Play?</span>
          {!isMobile && (
            <span style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              padding: '4px 18px', borderRadius: RADIUS.pill,
              border: `1px solid ${PLINKO.gold}`, color: PLINKO.gold,
              fontSize: 11, fontWeight: 900, letterSpacing: 2,
            }}>DEMO MODE</span>
          )}
          <span style={{ marginLeft: 'auto', color: COLORS.white, fontSize: 14, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ opacity: 0.7, fontSize: 11 }}>USD</span>
          </span>
          <button type="button" onClick={() => setBgmOn(v => !v)} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
            width: 30, height: 30, borderRadius: RADIUS.pill,
            background: bgmOn ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.3)',
            color: COLORS.white, border: `1px solid rgba(255,255,255,${bgmOn ? 0.6 : 0.25})`,
            fontSize: 13, cursor: 'pointer',
            fontFamily: "'Segoe UI Emoji', 'Noto Color Emoji', 'Apple Color Emoji', sans-serif",
          }}>🎵</button>
          <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
            width: 30, height: 30, borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.3)', color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.25)',
            fontSize: 14, cursor: 'pointer',
            fontFamily: "'Segoe UI Emoji', 'Noto Color Emoji', 'Apple Color Emoji', sans-serif",
          }}>{muted ? '🔇' : '🔊'}</button>
        </div>

        {/* ---- second row: Pins selector + result history + refresh ---- */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: PLINKO.band, borderRadius: RADIUS.pill,
          padding: '4px 6px', marginBottom: 12, overflow: 'visible', minHeight: 24,
          position: 'relative', zIndex: 2,
        }}>
          <span style={{ position: 'relative', flex: '0 0 auto' }}>
            <button type="button"
              onClick={() => { if (!flying) setPinsOpen(v => !v) }}
              style={{
                padding: '3px 22px', borderRadius: RADIUS.pill,
                background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.25)',
                color: COLORS.white, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
                cursor: flying ? 'not-allowed' : 'pointer', opacity: flying ? 0.6 : 1,
              }}>Pins: {pins} ˅</button>
            {pinsOpen && (
              <span style={{
                position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 5,
                display: 'flex', gap: 4, padding: 6,
                background: PLINKO.band, border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 10, boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
              }}>
                {Array.from({ length: PINS_MAX - PINS_MIN + 1 }, (_, i) => PINS_MIN + i).map(n => (
                  <button key={n} type="button"
                    onClick={() => { setPins(n); setPinsOpen(false) }}
                    style={{
                      width: 30, height: 26, borderRadius: 6,
                      background: n === pins ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.35)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      color: COLORS.white, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    }}>{n}</button>
                ))}
              </span>
            )}
          </span>
          {(isMobile ? history.slice(0, 5) : history.slice(0, 10)).map((h, i) => (
            <span key={history.length - i} style={{
              padding: '3px 9px', borderRadius: RADIUS.pill,
              background: ROW_BG[h.c], color: COLORS.white,
              fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
            }}>{h.v}</span>
          ))}
          <span style={{
            marginLeft: 'auto', padding: '3px 12px', borderRadius: RADIUS.pill,
            background: PLINKO.blue, color: COLORS.white,
            fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
          }}>⟲ ˅</span>
        </div>

        {/* ---- pin board: triangle of pearls + dashed funnel + flying balls ---- */}
        <div style={{
          position: 'relative', zIndex: 1,
          width: isMobile ? '100%' : 480, maxWidth: '100%',
          height: isMobile ? 300 : 330, margin: '0 auto 2px',
        }}>
          <svg width="100%" height="100%" viewBox="0 0 480 330" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
            <line x1="204" y1="-6" x2="6" y2="238" stroke={PLINKO.dash} strokeWidth="1.5" strokeDasharray="4 5" />
            <line x1="276" y1="-6" x2="474" y2="238" stroke={PLINKO.dash} strokeWidth="1.5" strokeDasharray="4 5" />
            <line x1="6" y1="238" x2="6" y2="330" stroke={PLINKO.dash} strokeWidth="1.5" strokeDasharray="4 5" />
            <line x1="474" y1="238" x2="474" y2="330" stroke={PLINKO.dash} strokeWidth="1.5" strokeDasharray="4 5" />
          </svg>
          {!flying && (
            <div style={{ position: 'absolute', left: '50%', top: -4, transform: 'translateX(-50%)' }}>
              <Football size={16} />
            </div>
          )}
          {pinRows.map((row, r) => (
            Array.from({ length: row.count }).map((_, i) => (
              <span key={`${r}-${i}`} style={{
                position: 'absolute',
                left: `${xFor(row, i)}%`, top: `${4 + row.y * 0.93}%`,
                width: isMobile ? 6 : 7, height: isMobile ? 6 : 7,
                borderRadius: '50%', transform: 'translate(-50%, -50%)',
                background: `radial-gradient(circle at 35% 30%, #ffffff, ${PLINKO.pin} 55%, #b9c2c9)`,
                boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
              }} />
            ))
          ))}
          {balls.map(ball => (
            <div key={ball.id} ref={el => { ball.node = el }} style={{
              position: 'absolute', left: '50%', top: '-2%',
              transform: 'translate(-50%,-50%)', zIndex: 3, pointerEvents: 'none',
            }}>
              <Football size={14} />
            </div>
          ))}
          <WinToast toasts={toasts} />
        </div>

        {/* ---- three-row multiplier table (computed, RTP 0.95) ---- */}
        <div style={{
          position: 'relative', zIndex: 1,
          width: isMobile ? '100%' : 480, maxWidth: '100%', margin: '0 auto 14px',
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          {['green', 'yellow', 'red'].map(tier => (
            <div key={tier} style={{ display: 'flex', gap: 2 }}>
              {TABLE[tier].map((m, ci) => {
                const center = Math.abs(ci - pins / 2) <= 1.5
                const hot = flash && flash.tier === tier && flash.k === ci
                return (
                  <span key={ci} style={{
                    flex: 1, minWidth: 0, textAlign: 'center',
                    padding: isMobile ? '3px 0' : '4px 0', borderRadius: 3,
                    background: center ? ROW_DIM[tier] : ROW_BG[tier],
                    color: COLORS.white, fontSize: isMobile ? 8 : 9.5, fontWeight: 800,
                    overflow: 'hidden',
                    boxShadow: hot ? `0 0 10px 2px ${PLINKO.gold}` : 'none',
                    filter: hot ? 'brightness(1.5)' : 'none',
                    transition: 'filter 0.15s, box-shadow 0.15s',
                  }}>{m}</span>
                )
              })}
            </div>
          ))}
        </div>

        {/* ---- bottom bet band ---- */}
        <div style={{
          margin: isMobile ? '0 -12px -12px' : '0 -18px -18px',
          padding: '12px 14px',
          background: PLINKO.band,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, flexWrap: 'wrap', position: 'relative', zIndex: 1,
        }}>
          <div style={{
            padding: '5px 18px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            textAlign: 'center', lineHeight: 1.2,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
            <input
              value={bet}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 56, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" onClick={() => { sfxChip(audioRef.current); setBet(b => Math.max(1, b - 10)) }} style={circleBtn}>−</button>
          <button type="button" style={{ ...circleBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="筹码">
            {/* chip-stack icon drawn in CSS — the ≡ glyph renders as a dash in this font */}
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
            </span>
          </button>
          <button type="button" onClick={() => { sfxChip(audioRef.current); setBet(b => b + 10) }} style={circleBtn}>+</button>
          <button type="button" disabled title="刷新" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: PLINKO.blue, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 17, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          <button type="button" disabled={locked} onClick={() => kick('green')} style={bigBtn(PLINKO.btnGreen)}>GREEN</button>
          <button type="button" disabled={locked} onClick={() => kick('yellow')} style={bigBtn(PLINKO.btnYellow)}>YELLOW</button>
          <button type="button" disabled={locked} onClick={() => kick('red')} style={bigBtn(PLINKO.btnRed)}>RED</button>
        </div>
      </Panel>
    </GameLayout>
  )
}
