import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, GOAL } from '../components/shell/tokens'
import { useIsMobile } from '../hooks/useMediaQuery'
import bgmUrl from '../assets/covers/bgm.mp3'

// 单G1: Spribe Goal 1:1 visual replica. PURE UI — controls are static or
// disabled; the existing dribble game logic and audio functions below are
// kept untouched (wired to disabled controls) for the gameplay order.

const MULTS = [1.0, 1.5, 2.2, 3.5, 6.0, 10.0]   // [level] → multiplier
const MAX = 5                                     // beat 5 defenders = full score
const ANIM = 700                                  // ms per dribble
const rand = (min, max) => min + Math.random() * (max - min)

// static grid dressing — mirrors the reference shot exactly:
// white active column, one footprint dot, one ball, two bombs
const GRID_COLS = 7
const GRID_ROWS = 4
const WHITE_COL = 2
const REVEALS = { '1-0': 'dot', '1-1': 'ball', '2-0': 'bomb', '2-1': 'bomb' }

export default function Goal({ balance, setBalance }) {
  const isMobile = useIsMobile()

  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('idle')      // idle | running | done
  const [, setLevel] = useState(0)                // defenders beaten
  const [awaiting, setAwaiting] = useState(false)  // waiting for L/R choice
  const [, setMessage] = useState(null)
  const [, setFinalResult] = useState(null)
  const [, setRoundHistory] = useState([])
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)

  const animRef = useRef(null)        // { active, start, picked, defSide, pass }
  const flashRef = useRef({ a: 0, c: '34,197,94' })
  const shakeRef = useRef(0)
  const particlesRef = useRef([])
  const audioRef = useRef({ ctx: null, muted: false })
  const bgmRef = useRef({ audio: null })

  const phaseRef = useRef('idle')
  const levelRef = useRef(0)
  const timersRef = useRef([])

  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { audioRef.current.muted = muted }, [muted])

  // ---------- audio ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC()
    if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx
    return ctx
  }
  function playRun() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.16), ctx.sampleRate)
    const d = nb.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(1600, t + 0.16)
    const g = ctx.createGain(); g.gain.value = 0.05
    ns.connect(bp); bp.connect(g); g.connect(ctx.destination); ns.start(t); ns.stop(t + 0.16)
  }
  function playPass() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[720, 1040].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.07
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.13, s + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.2)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.22)
    })
  }
  function playTackle() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.3)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.36)
    const w = ctx.createOscillator(); const wg = ctx.createGain()
    w.type = 'sine'; w.frequency.setValueAtTime(1750, t); w.frequency.exponentialRampToValueAtTime(650, t + 0.4)
    wg.gain.setValueAtTime(0.0001, t); wg.gain.exponentialRampToValueAtTime(0.05, t + 0.02); wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
    w.connect(wg); wg.connect(ctx.destination); w.start(t); w.stop(t + 0.44)
  }
  function playCash() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const g = ctx.createGain(); g.gain.value = 0.001; g.connect(ctx.destination)
    ;[880, 1320].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t + i * 0.05); o.stop(t + 0.26 + i * 0.05) })
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
  }
  function playWin() {
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
  function startBgm() {
    if (bgmRef.current.audio) return
    const audio = new Audio(bgmUrl); audio.loop = true; audio.volume = 0.25
    audio.play().catch(() => {})
    bgmRef.current.audio = audio
  }
  function stopBgm() { if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null } }
  useEffect(() => { if (bgmOn) startBgm(); else stopBgm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgmOn])
  useEffect(() => () => { stopBgm(); timersRef.current.forEach(clearTimeout) }, [])

  function later(fn, ms) { const id = setTimeout(fn, ms); timersRef.current.push(id); return id }

  // ---------- flow (kept for the gameplay order — wired to disabled controls) ----------
  function start() {
    if (phaseRef.current === 'running') return
    if (bet > balance || bet < 1) return
    ensureAudio()
    setBalance(b => parseFloat((b - bet).toFixed(2)))
    levelRef.current = 0; setLevel(0)
    animRef.current = null; particlesRef.current = []; shakeRef.current = 0; flashRef.current = { a: 0, c: '34,197,94' }
    setFinalResult(null); setMessage(null)
    setPhase('running'); phaseRef.current = 'running'
    setAwaiting(true)
  }

  function choose(side) {
    if (phaseRef.current !== 'running' || !awaiting || animRef.current?.active) return
    ensureAudio()
    const defSide = Math.random() < 0.5 ? 'left' : 'right'
    const pass = side !== defSide
    setAwaiting(false)
    setMessage(null)
    animRef.current = { active: true, start: performance.now(), picked: side, defSide, pass }
    playRun()

    later(() => {
      if (animRef.current) animRef.current.active = false
      spawnParticles(pass ? '#4ade80' : '#f87171', side)
      if (pass) {
        const nl = levelRef.current + 1
        levelRef.current = nl; setLevel(nl)
        flashRef.current = { a: 0.45, c: '34,197,94' }
        if (nl >= MAX) {
          const payout = parseFloat((bet * MULTS[MAX]).toFixed(2))
          setBalance(b => parseFloat((b + payout).toFixed(2)))
          setMessage({ text: '突破成功！', tone: 'gold' })
          setFinalResult({ win: payout, level: nl })
          setRoundHistory(h => [MULTS[MAX], ...h].slice(0, 20))
          setPhase('done'); phaseRef.current = 'done'
          playWin()
        } else {
          setMessage({ text: '过人！', tone: 'good' })
          playPass()
          setAwaiting(true)
        }
      } else {
        flashRef.current = { a: 0.55, c: '239,68,68' }; shakeRef.current = 1
        setMessage({ text: '被抢断！', tone: 'bad' })
        setFinalResult({ win: 0, level: levelRef.current })
        setRoundHistory(h => [0, ...h].slice(0, 20))
        setPhase('done'); phaseRef.current = 'done'
        playTackle()
      }
    }, ANIM)
  }

  function cashOut() {
    if (phaseRef.current !== 'running' || levelRef.current < 1 || !awaiting) return
    const mult = MULTS[levelRef.current]
    const payout = parseFloat((bet * mult).toFixed(2))
    setBalance(b => parseFloat((b + payout).toFixed(2)))
    setMessage({ text: `兑现 ${mult}×`, tone: 'good' })
    setFinalResult({ win: payout, level: levelRef.current, cashed: true })
    setRoundHistory(h => [mult, ...h].slice(0, 20))
    setPhase('done'); phaseRef.current = 'done'
    playCash()
  }

  function spawnParticles(color, side) {
    const cx = side === 'left' ? 0.30 : 0.70
    for (let k = 0; k < 14; k++) {
      const ang = (Math.PI * 2 * k) / 14 + rand(-0.2, 0.2)
      const sp = rand(1.5, 4)
      particlesRef.current.push({ fx: cx, fy: 0.30, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, color: Math.random() > 0.5 ? color : '#e8edf2' })
    }
  }

  // ---------- visual layer (Spribe Goal 1:1) ----------
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: GOAL.band, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const cellFace = white => ({
    borderRadius: 6,
    background: white
      ? `linear-gradient(180deg, ${GOAL.cellWhiteTop}, ${GOAL.cellWhiteBot})`
      : `linear-gradient(180deg, ${GOAL.cellTop}, ${GOAL.cellBot})`,
    border: '1px solid rgba(0,0,0,0.18)',
    aspectRatio: '82 / 70',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  })

  return (
    <GameLayout title="Goal" emoji="🥅" color={GOAL.win}>
      <Panel style={{
        background: `radial-gradient(circle at 50% 22%, ${GOAL.bgCenter}, ${GOAL.bgOuter})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
        position: 'relative',
      }}>
        {/* left giant football line art */}
        <svg width="300" height="300" viewBox="0 0 100 100" style={{ position: 'absolute', left: -120, top: '38%', pointerEvents: 'none' }}>
          <circle cx="50" cy="50" r="48" fill="none" stroke={GOAL.line} strokeWidth="2" />
          <polygon points="50,32 66,44 60,63 40,63 34,44" fill="none" stroke={GOAL.line} strokeWidth="2" />
          <g stroke={GOAL.line} strokeWidth="2" fill="none">
            <line x1="50" y1="32" x2="50" y2="4" />
            <line x1="66" y1="44" x2="90" y2="34" />
            <line x1="60" y1="63" x2="74" y2="86" />
            <line x1="40" y1="63" x2="26" y2="86" />
            <line x1="34" y1="44" x2="10" y2="34" />
          </g>
        </svg>
        {/* right half-pitch line art */}
        <svg width="260" height="380" viewBox="0 0 130 190" style={{ position: 'absolute', right: -90, top: '18%', pointerEvents: 'none' }}>
          <rect x="30" y="5" width="130" height="180" fill="none" stroke={GOAL.line} strokeWidth="2" />
          <rect x="30" y="45" width="46" height="100" fill="none" stroke={GOAL.line} strokeWidth="2" />
          <rect x="30" y="75" width="18" height="40" fill="none" stroke={GOAL.line} strokeWidth="2" />
          <path d="M76 75 A 22 22 0 0 1 76 115" fill="none" stroke={GOAL.line} strokeWidth="2" />
        </svg>

        {/* ---- top bar ---- */}
        <div style={{
          margin: isMobile ? '-12px -12px 12px' : '-18px -18px 14px',
          padding: '8px 14px',
          background: GOAL.band,
          display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 1,
        }}>
          <span style={navPill}>GOAL ▾</span>
          <span style={{
            padding: '5px 14px', borderRadius: RADIUS.pill,
            background: GOAL.orange, color: COLORS.white,
            fontSize: 12, fontWeight: 900,
          }}>? How to Play?</span>
          {!isMobile && (
            <span style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              padding: '4px 18px', borderRadius: RADIUS.pill,
              border: `1px solid ${GOAL.gold}`, color: GOAL.gold,
              fontSize: 11, fontWeight: 900, letterSpacing: 2,
            }}>DEMO MODE</span>
          )}
          <button type="button" disabled onClick={cashOut} style={{
            marginLeft: 'auto', padding: '3px 12px', borderRadius: RADIUS.pill,
            background: GOAL.win, color: '#083a1b', border: 'none',
            fontSize: 11, fontWeight: 900, cursor: 'not-allowed',
          }}>+3.44 USD</button>
          <span style={{ color: COLORS.white, fontSize: 14, fontWeight: 900 }}>
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

        {/* ---- second row: Field selector + Next multiplier ---- */}
        <div style={{
          width: isMobile ? '100%' : 640, maxWidth: '100%', margin: '0 auto 10px',
          background: GOAL.strip, borderRadius: RADIUS.pill,
          padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 8,
          position: 'relative', zIndex: 1, boxSizing: 'border-box',
        }}>
          <span style={{
            padding: '3px 18px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.25)',
            color: COLORS.white, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
          }}>Field: ▪▪ ▾</span>
          <span style={{
            marginLeft: 'auto', padding: '3px 14px', borderRadius: RADIUS.pill,
            background: GOAL.orange, color: COLORS.white,
            fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
          }}>Next: 1.29x</span>
        </div>

        {/* ---- main 7×4 grid (static showcase — matches the reference) ---- */}
        <div style={{
          width: isMobile ? '100%' : 640, maxWidth: '100%', margin: '0 auto 10px',
          display: 'grid', gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gap: 6,
          position: 'relative', zIndex: 1,
        }}>
          {Array.from({ length: GRID_ROWS }).map((_, r) => (
            Array.from({ length: GRID_COLS }).map((_, c) => {
              const reveal = REVEALS[`${r}-${c}`]
              return (
                <div key={`${r}-${c}`} style={cellFace(c === WHITE_COL)}>
                  {reveal === 'dot' && (
                    <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
                  )}
                  {reveal === 'ball' && <span style={{ fontSize: isMobile ? 22 : 30, lineHeight: 1 }}>⚽</span>}
                  {reveal === 'bomb' && <span style={{ fontSize: isMobile ? 20 : 27, lineHeight: 1 }}>💣</span>}
                </div>
              )
            })
          ))}
        </div>

        {/* ---- RANDOM / refresh / Auto Game row ---- */}
        <div style={{
          width: isMobile ? '100%' : 640, maxWidth: '100%', margin: '0 auto 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          position: 'relative', zIndex: 1,
        }}>
          <button type="button" disabled onClick={() => choose('left')} style={{
            flex: 1, maxWidth: 260, padding: '7px 0', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.55)',
            color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 1,
            cursor: 'not-allowed',
          }}>RANDOM</button>
          <button type="button" disabled onClick={() => choose('right')} style={{
            width: 32, height: 32, borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.4)',
            color: COLORS.white, fontSize: 14, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '5px 14px 5px 6px', borderRadius: RADIUS.pill,
            background: GOAL.strip,
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
          background: GOAL.band,
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
          <button type="button" disabled title="刷新" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: GOAL.blue, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 17, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          <button type="button" disabled onClick={start} style={{
            minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
            background: GOAL.bet, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.35)',
            fontSize: 14, fontWeight: 900, letterSpacing: 1,
            cursor: 'not-allowed', opacity: 0.92,
          }}>▷ BET</button>
        </div>
      </Panel>
    </GameLayout>
  )
}
