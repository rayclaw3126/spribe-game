import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, HILO } from '../components/shell/tokens'
import { useIsMobile } from '../hooks/useMediaQuery'
import bgmUrl from '../assets/covers/bgm.mp3'

// 单HL1: Spribe Hi Lo 1:1 visual replica, pitch-green skin + player rating
// cards. PURE UI — controls are static/disabled; the existing game logic and
// audio functions below are kept untouched for HL2 to re-wire.

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CM', 'CDM', 'CAM', 'LW', 'RW', 'ST']
const TEAM_COLORS = ['#DC2626', '#2563EB', '#16A34A', '#CA8A04', '#EA580C', '#0891B2']
const STREAK_MULTS = [1, 1.5, 2.5, 4, 6.5, 10, 16, 25]

// static fake history — mini jersey cards with ↑/↓ badges (HL2 换真数据)
const FAKE_HISTORY = [
  { n: 7, up: true }, { n: 11, up: false }, { n: 12, up: true },
  { n: 3, up: false }, { n: 9, up: true }, { n: 13, up: true },
]

function randomCard() {
  const rank = Math.floor(Math.random() * 13)   // 0..12
  return {
    rank,
    rating: 70 + rank * 2,                        // 70..94, monotonic with rank
    pos: POSITIONS[Math.floor(Math.random() * POSITIONS.length)],
    teamColor: TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)],
  }
}

// flat block-style football jersey: body + sleeves + collar, deep green,
// big squad number (1–13) on the chest
const JERSEY_PATH = 'M35 6 L20 14 L6 30 L16 42 L26 34 L26 84 L74 84 L74 34 L84 42 L94 30 L80 14 L65 6 C 55 16, 45 16, 35 6 Z'
function Jersey({ num, w, outline = false }) {
  return (
    <svg width={w} height={w * 0.9} viewBox="0 0 100 90" style={{ display: 'block' }}>
      <path d={JERSEY_PATH}
        fill={outline ? 'none' : '#14803c'}
        stroke={outline ? HILO.outline : 'rgba(0,0,0,0.3)'}
        strokeWidth={outline ? 3 : 2} strokeLinejoin="round" />
      {num != null && (
        <text x="50" y="62" textAnchor="middle" fontSize="34" fontWeight="900"
          fill={outline ? HILO.outline : '#ffffff'}
          fontFamily="'Space Grotesk', sans-serif">{num}</text>
      )}
    </svg>
  )
}
// white card with the jersey + chest number
function JerseyCard({ num, w, h }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 10,
      background: '#ffffff', border: '1px solid rgba(0,0,0,0.25)',
      boxShadow: '0 8px 22px rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Jersey num={num} w={w * 0.74} />
    </div>
  )
}

// dark football-pattern card back
function CardBack({ w, h }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 10, boxSizing: 'border-box',
      background: `repeating-linear-gradient(45deg, ${HILO.back} 0px, ${HILO.back} 8px, ${HILO.backLine} 8px, ${HILO.backLine} 10px)`,
      border: '4px solid #ffffff', boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{ fontSize: w * 0.3, opacity: 0.55 }}>⚽</span>
    </div>
  )
}

export default function HiLo({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('idle')   // idle | playing | done
  const [currentCard, setCurrentCard] = useState(null)
  const [, setNextCard] = useState(null)
  const [, setRevealNext] = useState(false)
  const [flipping, setFlipping] = useState(false)
  const [streak, setStreak] = useState(0)
  const [currentMult, setCurrentMult] = useState(1)
  const [, setHistory] = useState([])
  const [, setRoundHistory] = useState([])   // final multiplier per round (0 = bust), newest first
  const [, setMessage] = useState(null)
  const [cashedOut, setCashedOut] = useState(false)
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)

  const audioRef = useRef({ ctx: null, muted: false })
  const bgmRef = useRef({ audio: null })
  const timersRef = useRef([])

  useEffect(() => { audioRef.current.muted = muted }, [muted])
  function later(fn, ms) { const id = setTimeout(fn, ms); timersRef.current.push(id); return id }

  // ---------- audio ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function playFlip() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate)
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400
    const g = ctx.createGain(); g.gain.value = 0.05
    ns.connect(bp); bp.connect(g); g.connect(ctx.destination); ns.start(t); ns.stop(t + 0.1)
  }
  function playCorrect() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[720, 960, 1280].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.07
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.12, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.24)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.26)
    })
  }
  function playWrong() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.44)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.46)
  }
  function playCash() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const g = ctx.createGain(); g.gain.value = 0.001; g.connect(ctx.destination)
    ;[880, 1320].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t + i * 0.05); o.stop(t + 0.28 + i * 0.05) })
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42)
  }

  // ---------- BGM ----------
  function startBgm() { if (bgmRef.current.audio) return; const a = new Audio(bgmUrl); a.loop = true; a.volume = 0.25; a.play().catch(() => {}); bgmRef.current.audio = a }
  function stopBgm() { if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null } }
  useEffect(() => { if (bgmOn) startBgm(); else stopBgm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgmOn])
  useEffect(() => () => { stopBgm(); timersRef.current.forEach(clearTimeout) }, [])

  // ---------- game (kept for HL2 — not wired to the static UI) ----------
  function startGame() {
    if (bet > balance || bet < 1) return
    ensureAudio()
    setBalance(b => parseFloat((b - bet).toFixed(2)))
    setCurrentCard(randomCard())
    setNextCard(null); setRevealNext(false); setFlipping(false)
    setStreak(0); setCurrentMult(1); setHistory([]); setMessage(null); setCashedOut(false)
    setPhase('playing')
  }

  function guess(direction) {
    if (phase !== 'playing' || flipping) return
    ensureAudio()
    const next = randomCard()
    const correct = direction === 'higher' ? next.rank > currentCard.rank : next.rank < currentCard.rank
    setNextCard(next); setRevealNext(true); setFlipping(true)
    playFlip()

    later(() => {
      setHistory(h => [...h, { card: currentCard, correct }].slice(-8))
      if (!correct) {
        playWrong()
        setMessage({ text: `Wrong! It was ${next.rating}. Streak lost.`, win: false })
        setRoundHistory(rh => [0, ...rh].slice(0, 20))
        setStreak(0); setPhase('done'); setFlipping(false)
      } else {
        playCorrect()
        const newStreak = streak + 1
        const mult = STREAK_MULTS[Math.min(newStreak, STREAK_MULTS.length - 1)]
        setStreak(newStreak); setCurrentMult(mult)
        if (newStreak >= 7) {
          const payout = parseFloat((bet * 25).toFixed(2))
          setBalance(b => parseFloat((b + payout).toFixed(2)))
          setMessage({ text: `MAX STREAK! 25× — Won $${payout.toFixed(2)}! 🏆`, win: true })
          setRoundHistory(rh => [25, ...rh].slice(0, 20))
          setPhase('done'); setFlipping(false)
        } else {
          setMessage({ text: `Correct! ${next.rating} — keep going!`, win: true })
          setCurrentCard(next); setNextCard(null); setRevealNext(false); setFlipping(false)
        }
      }
    }, 620)
  }

  function cashOut() {
    if (phase !== 'playing' || streak === 0 || cashedOut || flipping) return
    const payout = parseFloat((bet * currentMult).toFixed(2))
    setBalance(b => parseFloat((b + payout).toFixed(2)))
    setCashedOut(true)
    setMessage({ text: `Cashed out ${currentMult}× — Won $${payout.toFixed(2)}!`, win: true })
    setRoundHistory(rh => [currentMult, ...rh].slice(0, 20))
    setPhase('done')
    playCash()
  }

  // ---------- visual layer (Spribe Hi Lo 1:1, pitch green) ----------
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.35)', color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const CW = isMobile ? 96 : 118
  const CH = isMobile ? 126 : 155
  const choicePill = bg => ({
    minWidth: isMobile ? 130 : 156, padding: '9px 0', borderRadius: RADIUS.pill,
    background: bg, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.45)',
    fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
    cursor: 'not-allowed', opacity: 0.92,
  })

  return (
    <GameLayout title="Rating Hi-Lo" emoji="📊" color={HILO.green}>
      <Panel style={{
        background: `radial-gradient(circle at 50% 34%, ${HILO.bgCenter}, ${HILO.bgOuter})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
        position: 'relative',
      }}>
        {/* giant corner rating-card line art (ref A/K positions) */}
        <div style={{
          position: 'absolute', left: -50, top: '32%', width: 170, height: 240,
          border: `3px solid ${HILO.outline}`, borderRadius: 18,
          transform: 'rotate(-14deg)', pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Jersey num={13} w={120} outline />
        </div>
        <div style={{
          position: 'absolute', right: -50, bottom: '10%', width: 170, height: 240,
          border: `3px solid ${HILO.outline}`, borderRadius: 18,
          transform: 'rotate(14deg)', pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Jersey num={1} w={120} outline />
        </div>

        {/* ---- top bar ---- */}
        <div style={{
          margin: isMobile ? '-12px -12px 12px' : '-18px -18px 14px',
          padding: '8px 14px',
          background: HILO.band,
          display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
        }}>
          <span style={navPill}>RATING HI-LO ▾</span>
          <span style={{
            padding: '5px 14px', borderRadius: RADIUS.pill,
            background: HILO.orange, color: COLORS.white,
            fontSize: 12, fontWeight: 900,
          }}>? How to Play?</span>
          {!isMobile && (
            <span style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              padding: '4px 18px', borderRadius: RADIUS.pill,
              border: `1px solid ${HILO.gold}`, color: HILO.gold,
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

        {/* ---- upper region: history strip + card-count badge ---- */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', marginBottom: isMobile ? 16 : 22, position: 'relative', zIndex: 1 }}>
          <div style={{
            flex: 1, minWidth: 0, background: HILO.band, borderRadius: 8,
            padding: '6px 8px', display: 'flex', gap: 6, alignItems: 'center', overflow: 'hidden',
          }}>
            {(isMobile ? FAKE_HISTORY.slice(0, 4) : FAKE_HISTORY).map((h, i) => (
              <div key={i} style={{
                position: 'relative', width: 34, height: 46, borderRadius: 5, flex: '0 0 auto',
                background: '#ffffff', border: '1px solid rgba(0,0,0,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Jersey num={h.n} w={26} />
                <span style={{
                  position: 'absolute', top: -5, left: -5, width: 15, height: 15, borderRadius: '50%',
                  background: h.up ? HILO.badgeUp : HILO.badgeDown, color: COLORS.white,
                  fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid rgba(255,255,255,0.6)',
                }}>{h.up ? '↑' : '↓'}</span>
              </div>
            ))}
          </div>
          <div style={{
            flex: '0 0 auto', background: HILO.band, borderRadius: 8,
            padding: '6px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: COLORS.white, fontSize: 14, fontWeight: 900 }}>
              <span style={{ width: 11, height: 15, borderRadius: 2, background: '#ffffff', border: '1px solid rgba(0,0,0,0.4)', display: 'inline-block' }} />
              6
            </span>
            <button type="button" disabled onClick={cashOut} style={{
              padding: '2px 10px', borderRadius: 4,
              background: HILO.green, color: '#083a1b', border: 'none',
              fontSize: 12, fontWeight: 900, cursor: 'not-allowed',
            }}>27.64x</button>
          </div>
        </div>

        {/* ---- center: hi/lo minis + face card + deck + skip ---- */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: isMobile ? 12 : 22, marginBottom: isMobile ? 16 : 22, position: 'relative', zIndex: 1,
        }}>
          {/* mini hi/lo indicators — up = higher rating, down = lower rating */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <button type="button" disabled onClick={() => guess('higher')} style={{
              width: 30, height: 42, borderRadius: 5, background: '#ffffff',
              border: '1px solid rgba(0,0,0,0.3)', cursor: 'not-allowed', padding: '2px 0 0',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}>
              <Jersey num={13} w={20} />
              <span style={{ color: HILO.badgeUp, fontSize: 11, fontWeight: 900, lineHeight: 1 }}>↑</span>
            </button>
            <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 900 }}>∨</span>
            <button type="button" disabled onClick={() => guess('lower')} style={{
              width: 30, height: 42, borderRadius: 5, background: '#ffffff',
              border: '1px solid rgba(0,0,0,0.3)', cursor: 'not-allowed', padding: '2px 0 0',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}>
              <Jersey num={1} w={20} />
              <span style={{ color: HILO.badgeDown, fontSize: 11, fontWeight: 900, lineHeight: 1 }}>↓</span>
            </button>
          </div>

          {/* face-up jersey number card */}
          <JerseyCard num={9} w={CW} h={CH} />

          {/* face-down deck: 3 offset backs + skip button below */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative', width: CW + 10, height: CH + 8 }}>
              <div style={{ position: 'absolute', left: 10, top: 8 }}><CardBack w={CW} h={CH} /></div>
              <div style={{ position: 'absolute', left: 5, top: 4 }}><CardBack w={CW} h={CH} /></div>
              <div style={{ position: 'absolute', left: 0, top: 0 }}><CardBack w={CW} h={CH} /></div>
            </div>
            <button type="button" disabled title="换一张" style={{
              width: 36, height: 36, borderRadius: RADIUS.pill,
              background: 'rgba(0,0,0,0.35)', color: COLORS.white,
              border: '1px solid rgba(255,255,255,0.35)',
              fontSize: 15, fontWeight: 900, cursor: 'not-allowed',
            }}>⟲</button>
          </div>
        </div>

        {/* ---- choice pills + static payout labels ---- */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: isMobile ? 12 : 26,
          marginBottom: 4, position: 'relative', zIndex: 1, flexWrap: 'wrap',
        }}>
          <div style={{ textAlign: 'center' }}>
            <button type="button" disabled style={choicePill(HILO.low)}>⌄ LOW OR SAME</button>
            <div style={{ marginTop: 6, color: COLORS.white, fontSize: 12, fontWeight: 800, opacity: 0.9 }}>44.92x</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <button type="button" disabled style={choicePill(HILO.high)}>⌃ HIGH OR SAME</button>
            <div style={{ marginTop: 6, color: COLORS.white, fontSize: 12, fontWeight: 800, opacity: 0.9 }}>59.90x</div>
          </div>
        </div>

        {/* ---- bottom bet band ---- */}
        <div style={{
          margin: isMobile ? '12px -12px -12px' : '14px -18px -18px',
          padding: '12px 14px',
          background: HILO.band,
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
          <button type="button" disabled onClick={startGame} style={{
            minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
            background: HILO.bet, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.35)',
            fontSize: 14, fontWeight: 900, letterSpacing: 1,
            cursor: 'not-allowed', opacity: 0.92,
          }}>▷ BET</button>
        </div>
      </Panel>
    </GameLayout>
  )
}
