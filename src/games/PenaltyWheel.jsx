import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel, BetInput, ActionButton } from '../components/GameLayout'
import bgmUrl from '../assets/covers/bgm.mp3'

const COLOR = '#16C784'
const VALS = [0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2]
const R = 115, CX = 140, CY = 140
// Layered sector colours: 0× dark, higher = brighter/greener
const colorFor = v => v === 0 ? '#232c39' : v < 2 ? '#137a52' : v < 3 ? '#16a06a' : '#1fe39a'
const rad = d => (d * Math.PI) / 180
const SPIN_MS = 4000

// cubic-bezier(0.15,0.55,0.25,1) easing — matches the CSS transition so ticks stay in sync
function makeBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = t => ((ax * t + bx) * t + cx) * t
  const sy = t => ((ay * t + by) * t + cy) * t
  const dx = t => (3 * ax * t + 2 * bx) * t + cx
  return x => {
    let t = x
    for (let i = 0; i < 6; i++) { const e = sx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-4 || d === 0) break; t -= e / d }
    return sy(t)
  }
}
const EASE = makeBezier(0.15, 0.55, 0.25, 1)
function timeForProgress(y) { // invert EASE: find x where EASE(x) ≈ y
  let lo = 0, hi = 1
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (EASE(m) < y) lo = m; else hi = m }
  return (lo + hi) / 2
}

function sectorPath(i) {
  const a1 = rad(-90 + i * 30), a2 = rad(-90 + (i + 1) * 30)
  const x1 = (CX + R * Math.cos(a1)).toFixed(1), y1 = (CY + R * Math.sin(a1)).toFixed(1)
  const x2 = (CX + R * Math.cos(a2)).toFixed(1), y2 = (CY + R * Math.sin(a2)).toFixed(1)
  return `M${CX},${CY} L${x1},${y1} A${R},${R} 0 0,1 ${x2},${y2} Z`
}
function labelPos(i) {
  const a = rad(-90 + i * 30 + 15)
  return { x: CX + 78 * Math.cos(a), y: CY + 78 * Math.sin(a) }
}

export default function PenaltyWheel({ balance, setBalance }) {
  const [bet, setBet] = useState(10)
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState(null)
  const [winIdx, setWinIdx] = useState(null)
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)

  const timerRef = useRef(null)
  const tickTimers = useRef([])
  const audioRef = useRef({ ctx: null, muted: false })
  const bgmRef = useRef({ audio: null })

  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => {
    if (bgmOn) { if (!bgmRef.current.audio) { const a = new Audio(bgmUrl); a.loop = true; a.volume = 0.25; a.play().catch(() => {}); bgmRef.current.audio = a } }
    else if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgmOn])
  useEffect(() => () => {
    if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null }
    tickTimers.current.forEach(clearTimeout); if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  // ---------- audio ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function playTick() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime; const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'square'; o.frequency.value = 900 + Math.random() * 250
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.035)
  }
  function playLand() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime; const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.14)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.2)
  }
  function playWin() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[720, 960, 1280].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.08
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.12, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.26)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.28)
    })
  }
  function playBig() {   // extra fanfare for a 3× hit
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime + 0.14
    ;[880, 1180, 1560, 2080].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = f
      const s = t + i * 0.09
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.11, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.32)
    })
  }
  function playLose() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime; const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.44)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.46)
  }

  function scheduleTicks(baseRot, delta) {
    tickTimers.current.forEach(clearTimeout); tickTimers.current = []
    const startK = Math.ceil(baseRot / 30)
    const endK = Math.floor((baseRot + delta) / 30)
    for (let k = startK; k <= endK; k++) {
      const y = (k * 30 - baseRot) / delta     // progress fraction (0..1) of the travel
      const tms = timeForProgress(y) * SPIN_MS  // decelerating → ticks get sparser
      tickTimers.current.push(setTimeout(playTick, tms))
    }
  }

  function spin() {
    if (bet > balance || spinning) return
    ensureAudio()
    setBalance(b => parseFloat((b - bet).toFixed(2)))
    setResult(null); setWinIdx(null)
    setSpinning(true)
    const idx = Math.floor(Math.random() * 12)
    const baseR = (((-15 - idx * 30) % 360) + 360) % 360
    const jitter = (Math.random() - 0.5) * 16
    const current = ((rotation % 360) + 360) % 360
    const delta = ((baseR - current + 360) % 360) + 360 * 5 + jitter
    const target = rotation + delta
    setRotation(target)
    scheduleTicks(rotation, delta)
    tickTimers.current.push(setTimeout(playLand, SPIN_MS - 30))
    timerRef.current = setTimeout(() => {
      const mult = VALS[idx]
      const payout = parseFloat((bet * mult).toFixed(2))
      if (payout > 0) setBalance(b => parseFloat((b + payout).toFixed(2)))
      setResult({ mult, payout, win: payout > 0 })
      setWinIdx(idx)
      setSpinning(false)
      if (mult >= 3) { playWin(); playBig() }
      else if (payout > 0) playWin()
      else playLose()
    }, 4200)
  }

  const won = result && result.win
  const bigWin = result && result.mult >= 2

  return (
    <GameLayout title="Penalty Wheel" emoji="⚽" color={COLOR}
      sidebar={
        <Panel>
          <BetInput bet={bet} setBet={setBet}
            onHalf={() => setBet(b => Math.max(1, Math.floor(b / 2)))}
            onDouble={() => setBet(b => b * 2)}
            disabled={spinning}
          />
          <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, fontWeight: 600 }}>Wheel payouts</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[...new Set(VALS)].sort((a, b) => a - b).map(v => (
                <span key={v} style={{
                  fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 8,
                  background: v === 0 ? 'var(--bg2)' : colorFor(v) + '33',
                  color: v === 0 ? 'var(--text3)' : v >= 3 ? '#7dffcf' : '#6EE7B7',
                  border: `1px solid ${colorFor(v)}`,
                }}>{v}×</span>
              ))}
            </div>
          </div>
          <ActionButton onClick={spin} color={COLOR} disabled={spinning || bet > balance || bet < 1}>
            {spinning ? '⚽ Spinning...' : '⚽ Spin the Wheel'}
          </ActionButton>
          {result && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: result.win ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              color: result.win ? '#6EE7B7' : '#FCA5A5',
              fontWeight: 600, fontSize: 14, animation: 'winPop 0.4s ease',
            }}>
              {result.win ? '🎉' : '💔'} Landed {result.mult}× — {result.win ? `Won $${result.payout.toFixed(2)}!` : 'No win'}
            </div>
          )}
        </Panel>
      }
    >
      <Panel style={{ position: 'relative', minHeight: 340, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{`
          @keyframes wheelParticle { from { transform: translate(0,0); opacity:1 } to { transform: translate(var(--tx), var(--ty)); opacity:0 } }
          @keyframes wheelGlow { from { transform: translate(-50%,-50%) scale(0.4); opacity:0.85 } to { transform: translate(-50%,-50%) scale(2.3); opacity:0 } }
        `}</style>

        {/* Audio toggles */}
        <button type="button" onClick={() => setBgmOn(v => !v)} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
          position: 'absolute', top: 12, right: 60, width: 40, height: 40, borderRadius: '50%', zIndex: 4,
          background: bgmOn ? 'rgba(22,199,132,0.18)' : 'var(--bg2)', color: bgmOn ? COLOR : 'var(--text3)',
          border: `1px solid ${bgmOn ? 'rgba(22,199,132,0.5)' : 'var(--border)'}`, fontSize: 16, cursor: 'pointer',
        }}>🎵</button>
        <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
          position: 'absolute', top: 12, right: 12, width: 40, height: 40, borderRadius: '50%', zIndex: 4,
          background: 'var(--bg2)', color: muted ? 'var(--text3)' : COLOR, border: '1px solid var(--border)', fontSize: 18, cursor: 'pointer',
        }}>{muted ? '🔇' : '🔊'}</button>

        <div style={{ position: 'relative', width: 280, maxWidth: '100%' }}>
          <svg viewBox="0 0 280 285" width="100%" style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.15,0.55,0.25,1)` : 'none',
          }}>
            <defs>
              <radialGradient id="wheelShade" cx="50%" cy="42%" r="60%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
                <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.35" />
              </radialGradient>
              <linearGradient id="rimGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e8edf2" />
                <stop offset="50%" stopColor="#7d8a99" />
                <stop offset="100%" stopColor="#2b3546" />
              </linearGradient>
              <filter id="secGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#39ffb0" floodOpacity="0.95" />
              </filter>
            </defs>

            {VALS.map((v, i) => {
              const isWin = !spinning && winIdx === i
              return (
                <path key={i} d={sectorPath(i)}
                  fill={isWin ? '#39ffb0' : colorFor(v)}
                  stroke={isWin ? '#eafff5' : '#0e1520'} strokeWidth={isWin ? 2.4 : 1.5}
                  filter={isWin && v > 0 ? 'url(#secGlow)' : undefined} />
              )
            })}
            {/* soft shading overlay for depth */}
            <circle cx={CX} cy={CY} r={R} fill="url(#wheelShade)" pointerEvents="none" />
            {/* metallic rim */}
            <circle cx={CX} cy={CY} r={R + 3} fill="none" stroke="url(#rimGrad)" strokeWidth="4" />

            {VALS.map((v, i) => {
              const p = labelPos(i)
              return (
                <text key={'l' + i} x={p.x.toFixed(1)} y={p.y.toFixed(1)} fontSize="12" fontWeight="800"
                  textAnchor="middle" dominantBaseline="middle" fontFamily="system-ui,sans-serif"
                  fill={v >= 3 ? '#04342c' : v === 0 ? '#8a97a6' : '#ffffff'}>{v}×</text>
              )
            })}
            <circle cx={CX} cy={CY} r="27" fill="#131a24" stroke={won ? '#39ffb0' : COLOR} strokeWidth="2" filter={won ? 'url(#secGlow)' : undefined} />
            <circle cx={CX} cy={CY} r="9" fill={won ? '#39ffb0' : COLOR} />
          </svg>

          {/* pointer (metallic + glow) */}
          <svg viewBox="0 0 280 285" width="100%" style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
            <defs>
              <linearGradient id="ptrGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#9aa7b5" />
              </linearGradient>
              <filter id="ptrGlow" x="-60%" y="-60%" width="220%" height="220%">
                <feDropShadow dx="0" dy="1" stdDeviation="1.6" floodColor="#000" floodOpacity="0.6" />
              </filter>
            </defs>
            <polygon points="126,4 154,4 140,34" fill="url(#ptrGrad)" stroke="#0e1520" strokeWidth="1" filter="url(#ptrGlow)" />
            <circle cx="140" cy="10" r="4" fill="#e8edf2" stroke="#0e1520" strokeWidth="1" />
          </svg>

          {/* win FX overlay (high-mult burst) */}
          {won && bigWin && (
            <div key={`fx-${winIdx}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <div style={{
                position: 'absolute', left: '50%', top: '49%', width: 120, height: 120, borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(57,255,176,0.55), rgba(57,255,176,0))',
                animation: 'wheelGlow 0.7s ease-out forwards',
              }} />
              {Array.from({ length: 14 }).map((_, k) => {
                const a = (Math.PI * 2 * k) / 14
                const dist = 95 + (k % 3) * 12
                return (
                  <span key={k} style={{
                    position: 'absolute', left: '50%', top: '49%', width: 6, height: 6, borderRadius: '50%',
                    background: k % 2 ? '#eafff5' : '#39ffb0',
                    '--tx': `${Math.cos(a) * dist}px`, '--ty': `${Math.sin(a) * dist}px`,
                    animation: `wheelParticle 0.8s ease-out forwards`, animationDelay: `${(k % 4) * 0.03}s`,
                  }} />
                )
              })}
            </div>
          )}
        </div>
      </Panel>
    </GameLayout>
  )
}
