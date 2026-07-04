import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, MINES } from '../components/shell/tokens'
import { useIsMobile } from '../hooks/useMediaQuery'
import bgmUrl from '../assets/covers/bgm.mp3'

// 单M1: Spribe Mines 1:1 visual replica, pitch-green skin + football icons.
// PURE UI — controls static/disabled; the existing game logic and audio
// functions below are kept untouched for the gameplay order.

const GRID = 25  // 5x5

function placeMines(count) {
  const positions = new Set()
  while (positions.size < count) {
    positions.add(Math.floor(Math.random() * GRID))
  }
  return positions
}

function calcMultiplier(gems, mines) {
  if (gems === 0) return 1
  const safe = GRID - mines
  let mult = 1
  for (let i = 0; i < gems; i++) {
    mult *= (safe - i) / (GRID - i)
  }
  return parseFloat((0.97 / mult).toFixed(2))
}

const MINE_COUNTS = [1, 3, 5, 10, 15, 20, 24]

// showcase dressing — gold footballs at the reference's star positions,
// plus one exploded tackle and two dark unexploded tackles
const SHOW_GOLD = new Set([5, 7, 11, 13, 15])
const SHOW_BOOM = 3
const SHOW_TACKLE = new Set([18, 21])

// white block-face football (opened-safe cell icon)
function Football({ size = 22, tone = '#ffffff', ink = '#3a2c00' }) {
  const patch = 'M12,2.2 L14.6,3.1 L15.2,5.6 L12,7.2 L8.8,5.6 L9.4,3.1 Z'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="11" fill={tone} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      <polygon points="12,8.6 15.2,10.9 14,14.7 10,14.7 8.8,10.9" fill={ink} />
      {[0, 72, 144, 216, 288].map(a => (
        <path key={a} d={patch} fill={ink} transform={`rotate(${a} 12 12)`} />
      ))}
    </svg>
  )
}
// slide-tackle icon: sliding boot silhouette + motion lines
function Tackle({ size = 22, tone = '#ffffff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <path d="M3 17 L13 12.5 L20 14.5 L21 17.5 L16 19 L3 19.5 Z" fill={tone} />
      <path d="M16.5 12.5 L19.5 9 L21.5 10.5 L19 13.5 Z" fill={tone} opacity="0.85" />
      <g stroke={tone} strokeWidth="1.3" opacity="0.6">
        <line x1="2" y1="12" x2="8" y2="10" />
        <line x1="3" y1="14.5" x2="9" y2="12.5" />
      </g>
    </svg>
  )
}

export default function Mines({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const [bet, setBet] = useState(10)
  const [mineCount] = useState(3)
  const [phase, setPhase] = useState('idle')  // idle | playing | done
  const [mineSet, setMineSet] = useState(null)
  const [revealed, setRevealed] = useState([])
  const [, setExploded] = useState(null)
  const [, setMessage] = useState(null)
  const [, setRoundHistory] = useState([])
  const [cashedOut, setCashedOut] = useState(false)
  const [, setShaking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)

  const audioRef = useRef({ ctx: null, muted: false })
  const bgmRef = useRef({ audio: null })
  const shakeTimer = useRef(null)

  const gems = revealed.length
  const currentMult = calcMultiplier(gems, mineCount)

  useEffect(() => { audioRef.current.muted = muted }, [muted])

  // ---------- audio (Web Audio synth) ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function playGem() {   // safe cell — crisp blip
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1280, t + 0.08)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.18)
  }
  function playTackle() {   // hit a mine — low thud + whistle
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.3)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.36)
    const w = ctx.createOscillator(); const wg = ctx.createGain()
    w.type = 'sine'; w.frequency.setValueAtTime(1750, t); w.frequency.exponentialRampToValueAtTime(640, t + 0.42)
    wg.gain.setValueAtTime(0.0001, t); wg.gain.exponentialRampToValueAtTime(0.05, t + 0.02); wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.44)
    w.connect(wg); wg.connect(ctx.destination); w.start(t); w.stop(t + 0.46)
  }
  function playCash() {   // cash out — rising ding
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const g = ctx.createGain(); g.gain.value = 0.001; g.connect(ctx.destination)
    ;[880, 1320].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t + i * 0.05); o.stop(t + 0.28 + i * 0.05) })
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42)
  }
  function playWin() {   // all cleared — celebration
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[660, 880, 1180, 1560].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.1
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.13, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.32)
    })
  }

  // ---------- BGM ----------
  function startBgm() { if (bgmRef.current.audio) return; const a = new Audio(bgmUrl); a.loop = true; a.volume = 0.25; a.play().catch(() => {}); bgmRef.current.audio = a }
  function stopBgm() { if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null } }
  useEffect(() => { if (bgmOn) startBgm(); else stopBgm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgmOn])
  useEffect(() => () => { stopBgm(); if (shakeTimer.current) clearTimeout(shakeTimer.current) }, [])

  function triggerShake() {
    setShaking(true)
    if (shakeTimer.current) clearTimeout(shakeTimer.current)
    shakeTimer.current = setTimeout(() => setShaking(false), 420)
  }

  // ---------- game (kept for the gameplay order — wired to disabled controls) ----------
  function startGame() {
    if (bet > balance) return
    ensureAudio()
    setBalance(b => b - bet)
    setMineSet(placeMines(mineCount))
    setRevealed([])
    setExploded(null)
    setMessage(null)
    setCashedOut(false)
    setPhase('playing')
  }

  function revealCell(idx) {
    if (phase !== 'playing' || revealed.includes(idx) || cashedOut) return
    if (mineSet.has(idx)) {
      setExploded(idx)
      setMessage({ text: `💥 Tackled! You lost $${bet.toFixed(2)}`, win: false })
      setRoundHistory(h => [0, ...h].slice(0, 20))
      setPhase('done')
      setRevealed([...revealed, idx])
      playTackle()
      triggerShake()
    } else {
      const newRevealed = [...revealed, idx]
      setRevealed(newRevealed)
      const newGems = newRevealed.length
      const safe = GRID - mineCount
      if (newGems >= safe) {
        const payout = parseFloat((bet * calcMultiplier(newGems, mineCount)).toFixed(2))
        setBalance(b => parseFloat((b + payout).toFixed(2)))
        setMessage({ text: `All gems found! ${calcMultiplier(newGems, mineCount)}× — $${payout.toFixed(2)}! 🏆`, win: true })
        setRoundHistory(h => [calcMultiplier(newGems, mineCount), ...h].slice(0, 20))
        setPhase('done')
        playWin()
      } else {
        setMessage({ text: `💎 Gem! +${calcMultiplier(newGems, mineCount)}× so far`, win: true })
        playGem()
      }
    }
  }

  function cashOut() {
    if (phase !== 'playing' || gems === 0 || cashedOut) return
    const payout = parseFloat((bet * currentMult).toFixed(2))
    setBalance(b => parseFloat((b + payout).toFixed(2)))
    setCashedOut(true)
    setMessage({ text: `Cashed out ${currentMult}× — Won $${payout.toFixed(2)}!`, win: true })
    setRoundHistory(h => [currentMult, ...h].slice(0, 20))
    setPhase('done')
    setRevealed(prev => {
      const mines = [...mineSet]
      return [...new Set([...prev, ...mines])]
    })
    playCash()
  }

  // ---------- visual layer (Spribe Mines 1:1, pitch green) ----------
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: MINES.band, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const cellStyle = kind => ({
    aspectRatio: '1 / 1', width: '100%', boxSizing: 'border-box',
    borderRadius: 8, padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'default',
    ...(kind === 'gold' ? {
      background: `linear-gradient(180deg, ${MINES.goldTop}, ${MINES.goldBot})`,
      border: '1px solid rgba(0,0,0,0.25)',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    } : kind === 'boom' ? {
      background: MINES.red,
      border: '1px solid rgba(0,0,0,0.3)',
    } : kind === 'tackle' ? {
      background: MINES.tackleDark,
      border: `1px solid ${MINES.cellBorder}`,
    } : {
      background: `linear-gradient(180deg, ${MINES.cellTop}, ${MINES.cellBot})`,
      border: `1px solid ${MINES.cellBorder}`,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
    }),
  })

  return (
    <GameLayout title="Dribble" emoji="🛡️" color={MINES.progress}>
      <Panel style={{
        background: `radial-gradient(circle at 42% 30%, ${MINES.bgCenter}, ${MINES.bgOuter})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
        position: 'relative',
      }}>
        {/* left giant football line art (ref star position) */}
        <svg width="290" height="290" viewBox="0 0 100 100" style={{ position: 'absolute', left: -120, top: '34%', pointerEvents: 'none' }}>
          <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
          <polygon points="50,32 66,44 60,63 40,63 34,44" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
          <g stroke="rgba(0,0,0,0.18)" strokeWidth="2" fill="none">
            <line x1="50" y1="32" x2="50" y2="4" />
            <line x1="66" y1="44" x2="90" y2="34" />
            <line x1="60" y1="63" x2="74" y2="86" />
            <line x1="40" y1="63" x2="26" y2="86" />
            <line x1="34" y1="44" x2="10" y2="34" />
          </g>
        </svg>
        {/* right tactics-board rings line art (ref snowflake position) */}
        <svg width="260" height="260" viewBox="0 0 100 100" style={{ position: 'absolute', right: -100, top: '40%', pointerEvents: 'none' }}>
          <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
          <circle cx="50" cy="50" r="26" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
          <circle cx="50" cy="50" r="4" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
          <line x1="4" y1="50" x2="96" y2="50" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
        </svg>

        {/* ---- top bar ---- */}
        <div style={{
          margin: isMobile ? '-12px -12px 12px' : '-18px -18px 14px',
          padding: '8px 14px',
          background: MINES.band,
          display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 1,
        }}>
          <span style={navPill}>DRIBBLE ▾</span>
          <span style={{
            padding: '5px 14px', borderRadius: RADIUS.pill,
            background: MINES.orange, color: COLORS.white,
            fontSize: 12, fontWeight: 900,
          }}>? How to Play?</span>
          {!isMobile && (
            <span style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              padding: '4px 18px', borderRadius: RADIUS.pill,
              border: `1px solid ${MINES.gold}`, color: MINES.gold,
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

        {/* ---- second row: Defenders selector + Next + progress strip ---- */}
        <div style={{ width: isMobile ? '100%' : 420, maxWidth: '100%', margin: '0 auto 10px', position: 'relative', zIndex: 1 }}>
          <div style={{
            background: MINES.strip, borderRadius: RADIUS.pill,
            padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box',
          }}>
            <span style={{
              padding: '3px 18px', borderRadius: RADIUS.pill,
              background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.25)',
              color: COLORS.white, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
            }}>Defenders: {mineCount} ▾</span>
            <span style={{
              marginLeft: 'auto', padding: '3px 14px', borderRadius: RADIUS.pill,
              background: MINES.next, color: '#3a2c00',
              fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
            }}>Next: 26.55x</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: MINES.progressTrack, marginTop: 4, overflow: 'hidden' }}>
            <div style={{ width: '25%', height: '100%', background: MINES.progress }} />
          </div>
        </div>

        {/* ---- main 5×5 grid (static showcase — reference star positions) ---- */}
        <div style={{
          width: isMobile ? '100%' : 420, maxWidth: '100%', margin: '0 auto 10px',
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8,
          position: 'relative', zIndex: 1,
        }}>
          {Array.from({ length: GRID }).map((_, i) => {
            const kind = SHOW_GOLD.has(i) ? 'gold' : i === SHOW_BOOM ? 'boom' : SHOW_TACKLE.has(i) ? 'tackle' : 'hidden'
            return (
              <div key={i} style={cellStyle(kind)}>
                {kind === 'gold' && <Football size={isMobile ? 22 : 30} />}
                {kind === 'boom' && <Tackle size={isMobile ? 22 : 30} tone="#ffffff" />}
                {kind === 'tackle' && <Tackle size={isMobile ? 20 : 26} tone="rgba(255,255,255,0.45)" />}
                {kind === 'hidden' && <span style={{ width: 12, height: 12, borderRadius: '50%', background: MINES.dot }} />}
              </div>
            )
          })}
        </div>

        {/* ---- RANDOM / refresh / Auto Game row ---- */}
        <div style={{
          width: isMobile ? '100%' : 420, maxWidth: '100%', margin: '0 auto 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          position: 'relative', zIndex: 1,
        }}>
          <button type="button" disabled onClick={() => revealCell(0)} style={{
            flex: 1, maxWidth: 200, padding: '7px 0', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.55)',
            color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 1,
            cursor: 'not-allowed',
          }}>RANDOM</button>
          <button type="button" disabled onClick={() => revealCell(1)} style={{
            width: 32, height: 32, borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.4)',
            color: COLORS.white, fontSize: 14, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '5px 14px 5px 6px', borderRadius: RADIUS.pill,
            background: MINES.strip,
          }}>
            <span style={{
              width: 34, height: 18, borderRadius: RADIUS.pill,
              background: 'rgba(255,255,255,0.25)', position: 'relative', display: 'inline-block',
            }}>
              <span style={{
                position: 'absolute', left: 2, top: 2, width: 14, height: 14,
                borderRadius: '50%', background: '#9aa7b0',
              }} />
            </span>
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 800 }}>Auto Game</span>
          </span>
        </div>

        {/* ---- bottom bet band ---- */}
        <div style={{
          margin: isMobile ? '0 -12px -12px' : '0 -18px -18px',
          padding: '12px 14px',
          background: MINES.band,
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
          <button type="button" onClick={() => setBet(b => Math.max(1, b - 10))} style={circleBtn}>−</button>
          <button type="button" style={{ ...circleBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="筹码">
            {/* chip-stack icon drawn in CSS — the ≡ glyph renders as a dash in this font */}
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
            </span>
          </button>
          <button type="button" onClick={() => setBet(b => b + 10)} style={circleBtn}>+</button>
          <button type="button" disabled onClick={startGame} title="刷新" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: MINES.blue, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 17, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          <button type="button" disabled onClick={cashOut} style={{
            minWidth: isMobile ? 170 : 230, padding: '7px 0', borderRadius: RADIUS.pill,
            background: MINES.cash, color: '#3a2c00',
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 13, fontWeight: 900, letterSpacing: 0.5, lineHeight: 1.3,
            cursor: 'not-allowed', opacity: 0.92,
            display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
          }}>
            <span>CASH OUT</span>
            <span style={{ fontSize: 12, opacity: 0.9 }}>3.91 USD</span>
          </button>
        </div>
      </Panel>
    </GameLayout>
  )
}
