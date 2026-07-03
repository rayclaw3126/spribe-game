import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, HOTLINE } from '../components/shell/tokens'
import { useIsMobile } from '../hooks/useMediaQuery'
import bgmUrl from '../assets/covers/bgm.mp3'

const VALS = [0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2]
const CELL_W = 72
const GAP = 8
const STEP = CELL_W + GAP
const SPIN_MS = 4000

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
  const [, setRoundHistory] = useState([])   // landed multiplier per round (display bookkeeping)
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
      setRoundHistory(h => [mult, ...h].slice(0, 20))
      setWinCell(landCell)
      setRolling(false)
      if (mult >= 3) { playWin(); playBig() }
      else if (payout > 0) playWin()
      else playLose()
    }, 4200)
  }
  const isMobile = useIsMobile()
  const won = result && result.win
  const bigWin = result && result.mult >= 2

  // ---------- visual layer (Spribe Hotline 1:1) ----------
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
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

  // card face: red / navy alternating, golden fire for the top multiplier
  const cardFace = v => v >= 3
    ? { background: `radial-gradient(circle at 50% 35%, ${HOTLINE.gold}, ${HOTLINE.fire} 55%, ${HOTLINE.fireDeep})`, border: `2px solid ${HOTLINE.gold}` }
    : v > 0
      ? { background: `linear-gradient(160deg, ${HOTLINE.cardRed}, ${HOTLINE.cardRedDeep})`, border: '2px solid rgba(255,255,255,0.25)' }
      : { background: HOTLINE.cardNavy, border: '2px solid rgba(0,0,0,0.3)' }

  return (
    <GameLayout title="Streak Roll" emoji="🎯" color={HOTLINE.blue}>
      <Panel style={{
        background: `radial-gradient(circle at 50% 30%, ${HOTLINE.bgCenter}, ${HOTLINE.bgOuter})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
      }}>
        {/* ---- top bar ---- */}
        <div style={{
          margin: isMobile ? '-12px -12px 14px' : '-18px -18px 16px',
          padding: '8px 14px',
          background: HOTLINE.bar,
          display: 'flex', alignItems: 'center', gap: 10, position: 'relative',
        }}>
          <span style={navPill}>STREAK ROLL ▾</span>
          <span style={{
            padding: '5px 14px', borderRadius: RADIUS.pill,
            background: HOTLINE.orange, color: COLORS.white,
            fontSize: 12, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 15, height: 15, borderRadius: RADIUS.pill,
              background: 'rgba(0,0,0,0.3)', fontSize: 10, fontWeight: 900,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>?</span>
            How to Play?
          </span>
          {!isMobile && (
            <span style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              padding: '4px 18px', borderRadius: RADIUS.pill,
              background: 'rgba(255,179,0,0.18)', border: `1px solid ${HOTLINE.gold}`,
              color: HOTLINE.gold, fontSize: 11, fontWeight: 900, letterSpacing: 2,
            }}>DEMO MODE</span>
          )}
          <span style={{ marginLeft: 'auto', color: COLORS.white, fontSize: 13, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ opacity: 0.7, fontSize: 11 }}>USD</span>
          </span>
          <button type="button" onClick={() => setBgmOn(v => !v)} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
            width: 30, height: 30, borderRadius: RADIUS.pill,
            background: bgmOn ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.3)',
            color: COLORS.white, border: `1px solid rgba(255,255,255,${bgmOn ? 0.6 : 0.25})`,
            fontSize: 13, cursor: 'pointer',
          }}>🎵</button>
          <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
            width: 30, height: 30, borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.3)', color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.25)',
            fontSize: 14, cursor: 'pointer',
          }}>{muted ? '🔇' : '🔊'}</button>
        </div>

        <style>{`
          @keyframes srParticle { from { transform: translate(0,0); opacity:1 } to { transform: translate(var(--tx), var(--ty)); opacity:0 } }
          @keyframes srGlow { from { transform: translate(-50%,-50%) scale(0.4); opacity:0.85 } to { transform: translate(-50%,-50%) scale(2.3); opacity:0 } }
        `}</style>

        {/* ---- thin progress row: bead left, small button right ---- */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 720, margin: '0 auto 18px' }}>
          <span style={{ width: 10, height: 10, borderRadius: RADIUS.pill, background: 'rgba(255,255,255,0.8)', flex: '0 0 auto' }} />
          <div style={{ flex: 1, height: 6, borderRadius: RADIUS.pill, background: HOTLINE.bar }} />
          <button type="button" disabled style={{
            padding: '3px 12px', borderRadius: RADIUS.pill, flex: '0 0 auto',
            background: HOTLINE.blue, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 11, fontWeight: 900, cursor: 'not-allowed',
          }}>⟲˅</button>
        </div>

        {/* ---- card strip band ---- */}
        <div style={{
          background: HOTLINE.band, borderRadius: 14,
          padding: '10px 0 10px', margin: '0 auto', maxWidth: 860,
        }}>
          <div style={tri(false)} />
          <div ref={viewRef} style={{
            position: 'relative', width: '100%', height: 96,
            overflow: 'hidden', margin: '8px 0',
          }}>
            {/* fade edges */}
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 60, zIndex: 2, background: `linear-gradient(90deg, ${HOTLINE.band}, transparent)` }} />
            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 60, zIndex: 2, background: `linear-gradient(270deg, ${HOTLINE.band}, transparent)` }} />

            {/* rolling strip — same offset/transition mechanics as before */}
            <div style={{
              display: 'flex', gap: GAP, position: 'absolute', top: 12, left: 0,
              transform: `translateX(${-offset}px)`,
              transition: rolling ? `transform ${SPIN_MS}ms cubic-bezier(0.15,0.55,0.25,1)` : 'none',
            }}>
              {STRIP.map((v, i) => {
                const isWin = !rolling && winCell === i
                return (
                  <div key={i} style={{
                    width: CELL_W, height: 72, flexShrink: 0, borderRadius: 10,
                    ...cardFace(v),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: isWin ? `0 0 18px ${HOTLINE.gold}` : '0 2px 6px rgba(0,0,0,0.3)',
                    transform: isWin ? 'scale(1.06)' : 'scale(1)',
                    transition: 'box-shadow 0.2s, transform 0.2s',
                    fontSize: v >= 3 ? 26 : 8, lineHeight: 1,
                  }}>
                    {v >= 3
                      ? '🔥'
                      : v > 0
                        ? <span style={{ fontSize: 8 }}>⚽</span>
                        : <span style={{ fontSize: 8, opacity: 0.35 }}>⚽</span>}
                  </div>
                )
              })}
            </div>

            {/* center golden selection frame */}
            <div style={{
              position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
              width: CELL_W + 14, height: 88, borderRadius: 12,
              border: `3px solid ${HOTLINE.gold}`,
              boxShadow: `0 0 12px rgba(255,213,79,0.45)`,
              pointerEvents: 'none', zIndex: 3,
            }} />

            {/* win FX (high mult ≥2×): burst + glow at the pointer */}
            {won && bigWin && (
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

        {/* ---- High risk mode toggle (disabled placeholder) ---- */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '5px 16px', borderRadius: RADIUS.pill,
            background: HOTLINE.bar, border: '1px solid rgba(255,255,255,0.25)',
            color: COLORS.white, fontSize: 12, fontWeight: 800, opacity: 0.6, cursor: 'not-allowed',
          }}>
            <span style={{
              width: 30, height: 16, borderRadius: RADIUS.pill, position: 'relative',
              background: 'rgba(255,255,255,0.2)', display: 'inline-block',
            }}>
              <span style={{ position: 'absolute', top: 2, left: 2, width: 12, height: 12, borderRadius: RADIUS.pill, background: 'rgba(255,255,255,0.7)' }} />
            </span>
            High risk mode
          </span>
        </div>

        {/* ---- bottom bet band ---- */}
        <div style={{
          margin: isMobile ? '14px -12px -12px' : '18px -18px -18px',
          padding: '12px 18px',
          background: HOTLINE.bar,
          display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
        }}>
          <div style={{
            padding: '5px 22px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
            textAlign: 'center',
          }}>
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
            <input
              type="number" min="1" value={bet}
              onChange={e => setBet(Math.max(1, Number(e.target.value)))}
              style={{
                width: 72, background: 'transparent', border: 'none', textAlign: 'center',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" onClick={() => setBet(b => Math.max(1, b - 10))} style={circleBtn}>−</button>
          <button type="button" style={{ ...circleBtn, fontSize: 12 }} title="筹码">≡</button>
          <button type="button" onClick={() => setBet(b => b + 10)} style={circleBtn}>+</button>
          <button type="button" disabled title="自动" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: HOTLINE.blue, color: COLORS.white,
            border: '2px solid rgba(255,255,255,0.4)',
            fontSize: 16, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          {/* three bet buttons — wired up in H2; roll kept referenced but unreachable */}
          <button type="button" disabled onClick={roll} style={betBigBtn(`linear-gradient(160deg, ${HOTLINE.cardRed}, ${HOTLINE.cardRedDeep})`, COLORS.white)}>
            <span>RED</span><span>X2</span>
          </button>
          <button type="button" disabled style={betBigBtn(`radial-gradient(circle at 50% 30%, ${HOTLINE.gold}, ${HOTLINE.fireDeep})`, COLORS.white)}>
            <span>🔥</span><span>X32</span>
          </button>
          <button type="button" disabled style={betBigBtn(HOTLINE.black, COLORS.white)}>
            <span>BLACK</span><span>X2</span>
          </button>
        </div>
      </Panel>
    </GameLayout>
  )
}
