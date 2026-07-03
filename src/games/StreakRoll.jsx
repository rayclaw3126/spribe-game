import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel, BetInput, ActionButton } from '../components/GameLayout'
import bgmUrl from '../assets/covers/bgm.mp3'

const COLOR = '#16C784'
const VALS = [0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2]
const CELL_W = 72
const GAP = 8
const STEP = CELL_W + GAP
const SPIN_MS = 4000
// Layered cell colours: 0× dark, higher = brighter/greener
const colorFor = v => v === 0 ? '#232c39' : v < 2 ? '#137a52' : v < 3 ? '#16a06a' : '#1fe39a'

// 复制成长条：够长且能无缝停在中段
const STRIP = Array.from({ length: 60 }, (_, i) => VALS[i % VALS.length])

// cubic-bezier(0.15,0.55,0.25,1) — matches the CSS transition so ticks stay in sync
function makeBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = t => ((ax * t + bx) * t + cx) * t
  const sy = t => ((ay * t + by) * t + cy) * t
  const dx = t => (3 * ax * t + 2 * bx) * t + cx
  return x => { let t = x; for (let i = 0; i < 6; i++) { const e = sx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-4 || d === 0) break; t -= e / d } return sy(t) }
}
const EASE = makeBezier(0.15, 0.55, 0.25, 1)
function timeForProgress(y) { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (EASE(m) < y) lo = m; else hi = m } return (lo + hi) / 2 }

export default function StreakRoll({ balance, setBalance }) {
  const [bet, setBet] = useState(10)
  const [offset, setOffset] = useState(0)
  const [rolling, setRolling] = useState(false)
  const [result, setResult] = useState(null)
  const [winCell, setWinCell] = useState(null)
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)

  const viewRef = useRef(null)
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
    o.type = 'square'; o.frequency.value = 880 + Math.random() * 260
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
  function playBig() {
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

  function scheduleTicks(prevOffset, delta) {
    tickTimers.current.forEach(clearTimeout); tickTimers.current = []
    const startK = Math.ceil(prevOffset / STEP)
    const endK = Math.floor((prevOffset + delta) / STEP)
    for (let k = startK; k <= endK; k++) {
      const y = (k * STEP - prevOffset) / delta       // 0..1 travel fraction
      const tms = timeForProgress(y) * SPIN_MS         // decelerating → sparser ticks
      tickTimers.current.push(setTimeout(playTick, tms))
    }
    tickTimers.current.push(setTimeout(playLand, SPIN_MS - 30))
  }

  function roll() {
    if (bet > balance || rolling) return
    ensureAudio()
    setBalance(b => parseFloat((b - bet).toFixed(2)))
    setResult(null); setWinCell(null)
    setRolling(true)

    const idx = Math.floor(Math.random() * VALS.length)
    const landCell = 36 + idx  // STRIP[36+idx] === VALS[idx]
    const viewW = viewRef.current ? viewRef.current.offsetWidth : 400
    const center = viewW / 2
    const jitter = (Math.random() - 0.5) * (CELL_W * 0.5)
    const target = landCell * STEP + CELL_W / 2 - center + jitter
    const prevOffset = offset
    setOffset(target)
    scheduleTicks(prevOffset, target - prevOffset)

    timerRef.current = setTimeout(() => {
      const mult = VALS[idx]
      const payout = parseFloat((bet * mult).toFixed(2))
      if (payout > 0) setBalance(b => parseFloat((b + payout).toFixed(2)))
      setResult({ mult, payout, win: payout > 0 })
      setWinCell(landCell)
      setRolling(false)
      if (mult >= 3) { playWin(); playBig() }
      else if (payout > 0) playWin()
      else playLose()
    }, 4200)
  }

  const won = result && result.win
  const bigWin = result && result.mult >= 2

  return (
    <GameLayout title="Streak Roll" emoji="🎯" color={COLOR}
      sidebar={
        <Panel>
          <BetInput bet={bet} setBet={setBet}
            onHalf={() => setBet(b => Math.max(1, Math.floor(b / 2)))}
            onDouble={() => setBet(b => b * 2)}
            disabled={rolling}
          />
          <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, fontWeight: 600 }}>Roll payouts</div>
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
          <ActionButton onClick={roll} color={COLOR} disabled={rolling || bet > balance || bet < 1}>
            {rolling ? '🎯 Rolling...' : '🎯 Roll'}
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
          @keyframes srParticle { from { transform: translate(0,0); opacity:1 } to { transform: translate(var(--tx), var(--ty)); opacity:0 } }
          @keyframes srGlow { from { transform: translate(-50%,-50%) scale(0.4); opacity:0.85 } to { transform: translate(-50%,-50%) scale(2.3); opacity:0 } }
        `}</style>

        {/* Audio toggles */}
        <button type="button" onClick={() => setBgmOn(v => !v)} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
          position: 'absolute', top: 12, right: 60, width: 40, height: 40, borderRadius: '50%', zIndex: 6,
          background: bgmOn ? 'rgba(22,199,132,0.18)' : 'var(--bg2)', color: bgmOn ? COLOR : 'var(--text3)',
          border: `1px solid ${bgmOn ? 'rgba(22,199,132,0.5)' : 'var(--border)'}`, fontSize: 16, cursor: 'pointer',
        }}>🎵</button>
        <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
          position: 'absolute', top: 12, right: 12, width: 40, height: 40, borderRadius: '50%', zIndex: 6,
          background: 'var(--bg2)', color: muted ? 'var(--text3)' : COLOR, border: '1px solid var(--border)', fontSize: 18, cursor: 'pointer',
        }}>{muted ? '🔇' : '🔊'}</button>

        <div ref={viewRef} style={{
          position: 'relative', width: '100%', maxWidth: 520, height: 100,
          overflow: 'hidden', borderRadius: 12,
          border: '1.5px solid var(--border)', background: 'var(--bg2)',
          boxShadow: won && bigWin ? '0 0 24px rgba(57,255,176,0.35)' : 'none',
        }}>
          {/* Center pointer — metallic + glow */}
          <div style={{
            position: 'absolute', left: '50%', top: 0, bottom: 0, width: 3,
            background: 'linear-gradient(180deg,#ffffff,#9aa7b5)',
            transform: 'translateX(-50%)', zIndex: 3,
            boxShadow: '0 0 8px rgba(245,166,35,0.7)',
          }} />
          <div style={{
            position: 'absolute', left: '50%', top: 1, transform: 'translateX(-50%)',
            width: 0, height: 0, borderLeft: '9px solid transparent', borderRight: '9px solid transparent',
            borderTop: '12px solid #ffffff', zIndex: 4, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
          }} />
          <div style={{
            position: 'absolute', left: '50%', bottom: 1, transform: 'translateX(-50%)',
            width: 0, height: 0, borderLeft: '9px solid transparent', borderRight: '9px solid transparent',
            borderBottom: '12px solid #ffffff', zIndex: 4, filter: 'drop-shadow(0 -1px 2px rgba(0,0,0,0.6))',
          }} />

          {/* 两端渐隐 */}
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 60, zIndex: 2, background: 'linear-gradient(90deg, var(--bg2), transparent)' }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 60, zIndex: 2, background: 'linear-gradient(270deg, var(--bg2), transparent)' }} />

          {/* 滚动条 */}
          <div style={{
            display: 'flex', gap: GAP, position: 'absolute', top: 22, left: 0,
            transform: `translateX(${-offset}px)`,
            transition: rolling ? `transform ${SPIN_MS}ms cubic-bezier(0.15,0.55,0.25,1)` : 'none',
          }}>
            {STRIP.map((v, i) => {
              const isWin = !rolling && winCell === i
              return (
                <div key={i} style={{
                  width: CELL_W, height: 56, flexShrink: 0, borderRadius: 8,
                  background: isWin ? '#39ffb0' : colorFor(v),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 800, fontFamily: "'Space Grotesk', system-ui, sans-serif",
                  color: isWin ? '#04342c' : v >= 3 ? '#04342c' : v === 0 ? '#8a97a6' : '#ffffff',
                  border: `2px solid ${isWin ? '#eafff5' : '#0e1520'}`,
                  boxShadow: isWin ? '0 0 18px rgba(57,255,176,0.95)' : 'none',
                  transform: isWin ? 'scale(1.06)' : 'scale(1)',
                  transition: 'box-shadow 0.2s, transform 0.2s',
                }}>{v}×</div>
              )
            })}
          </div>

          {/* Win FX (high mult ≥2×): burst + glow at the pointer */}
          {won && bigWin && (
            <div key={`fx-${winCell}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
              <div style={{
                position: 'absolute', left: '50%', top: '50%', width: 90, height: 90, borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(57,255,176,0.6), rgba(57,255,176,0))',
                animation: 'srGlow 0.7s ease-out forwards',
              }} />
              {Array.from({ length: 14 }).map((_, k) => {
                const a = (Math.PI * 2 * k) / 14
                const dist = 70 + (k % 3) * 14
                return (
                  <span key={k} style={{
                    position: 'absolute', left: '50%', top: '50%', width: 6, height: 6, borderRadius: '50%',
                    background: k % 2 ? '#eafff5' : '#39ffb0',
                    '--tx': `${Math.cos(a) * dist}px`, '--ty': `${Math.sin(a) * dist}px`,
                    animation: 'srParticle 0.8s ease-out forwards', animationDelay: `${(k % 4) * 0.03}s`,
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
