import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { useIsMobile } from '../hooks/useMediaQuery'
import { COLORS, RADIUS, KENO } from '../components/shell/tokens'
import bgmUrl from '../assets/covers/bgm.mp3'

// Team Keno — visual layer is a 1:1 copy of the Spribe Keno reference shot
// (scratchpad/keno-ref.png): crimson felt, 6×6 glossy number balls, empty
// draw column, RANDOM/CLEAR pills, bottom bet band. Betting/draw logic is
// untouched in this pass (K2); BET stays disabled.
// NOTE for K2: logic pool TOTAL=40 predates the 36-ball board — RANDOM may
// select numbers 37–40 that have no visible cell until K2 aligns the pool.

const TOTAL = 40
const DRAW = 20
const GRID_N = 36   // visible 6×6 board (Spribe layout)

// Payout table: [picks][matches] = multiplier
const PAYOUTS = {
  1:  { 1: 3.8 },
  2:  { 2: 8 },
  3:  { 2: 2, 3: 26 },
  4:  { 2: 1.5, 3: 6, 4: 70 },
  5:  { 3: 3, 4: 20, 5: 200 },
  6:  { 3: 2, 4: 8, 5: 50, 6: 500 },
  7:  { 4: 5, 5: 25, 6: 100, 7: 1000 },
  8:  { 4: 3, 5: 15, 6: 50, 7: 300, 8: 3000 },
  9:  { 4: 2, 5: 8,  6: 25, 7: 100, 8: 800, 9: 5000 },
  10: { 5: 5, 6: 15, 7: 50, 8: 200, 9: 1000, 10: 10000 },
}

export default function Keno({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const [bet, setBet] = useState(10)
  const [selected, setSelected] = useState([])
  const [drawn, setDrawn] = useState([])
  const [drawing, setDrawing] = useState(false)
  const [phase, setPhase] = useState('idle') // idle | drawing | done
  const [, setRoundHistory] = useState([])   // kept for K2 (display bookkeeping)
  const [, setMessage] = useState(null)
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)
  const audioRef = useRef({ ctx: null, muted: false })
  const bgmRef = useRef({ audio: null })

  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => {
    if (bgmOn) { if (!bgmRef.current.audio) { const a = new Audio(bgmUrl); a.loop = true; a.volume = 0.25; a.play().catch(() => {}); bgmRef.current.audio = a } }
    else if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgmOn])
  useEffect(() => () => { if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null } }, [])

  // ---------- audio (Web Audio synth) ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function playPick() {   // soft click on select/deselect
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime; const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.frequency.value = 560
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.07)
  }
  function playDraw() {   // "哒" per drawn number
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime; const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'square'; o.frequency.value = 360 + Math.random() * 130
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.06)
  }
  function playMatch() {   // bright "叮" on a hit
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[1180, 1770].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(i ? 0.05 : 0.1, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26)
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.28)
    })
  }
  function playWin() {   // celebration
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[660, 880, 1180, 1560].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.1
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.13, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.32)
    })
  }
  function playLose() {   // low tone
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime; const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.44)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.46)
  }

  function toggleNumber(n) {
    if (phase !== 'idle' || drawing) return
    ensureAudio(); playPick()
    setSelected(s =>
      s.includes(n) ? s.filter(x => x !== n) : s.length < 10 ? [...s, n] : s
    )
  }

  function clearSelection() {
    if (phase !== 'idle') return
    setSelected([])
  }

  function quickPick(count) {
    if (phase !== 'idle') return
    const nums = []
    while (nums.length < count) {
      const n = Math.floor(Math.random() * TOTAL) + 1
      if (!nums.includes(n)) nums.push(n)
    }
    setSelected(nums)
  }

  async function play() {
    if (bet > balance || selected.length === 0) return
    ensureAudio()
    setBalance(b => b - bet)
    setPhase('drawing')
    setDrawing(true)
    setDrawn([])
    setMessage(null)

    // Draw 20 numbers one by one
    const allNums = Array.from({ length: TOTAL }, (_, i) => i + 1)
    const shuffled = allNums.sort(() => Math.random() - 0.5).slice(0, DRAW)
    const drawResult = []

    for (let i = 0; i < shuffled.length; i++) {
      await new Promise(r => setTimeout(r, 80))
      drawResult.push(shuffled[i])
      setDrawn([...drawResult])
      playDraw()
      if (selected.includes(shuffled[i])) playMatch()
    }

    const matches = selected.filter(n => shuffled.includes(n)).length
    const picks = selected.length
    const payout_table = PAYOUTS[picks] || {}
    const mult = payout_table[matches] || 0
    const payout = parseFloat((bet * mult).toFixed(2))

    if (payout > 0) { setBalance(b => parseFloat((b + payout).toFixed(2))); playWin() }
    else playLose()

    const matchStr = `${matches}/${picks} matched`
    setMessage(
      payout > 0
        ? { text: `${matchStr} — ${mult}× — Won $${payout.toFixed(2)}! 🎉`, win: true }
        : { text: `${matchStr} — No win this time`, win: false }
    )
    setRoundHistory(h => [mult, ...h].slice(0, 20))
    setPhase('done')
    setDrawing(false)
  }

  function reset() {
    setPhase('idle')
    setDrawn([])
    setSelected([])
    setMessage(null)
  }

  // ---------- visual layer (Spribe 1:1) ----------
  const roundBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: KENO.pill, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const wideBtn = enabled => ({
    flex: 1, padding: '9px 0', borderRadius: RADIUS.pill,
    background: KENO.pill,
    border: '1px solid rgba(255,255,255,0.35)',
    color: enabled ? COLORS.white : 'rgba(255,255,255,0.45)',
    fontSize: 13, fontWeight: 800, letterSpacing: 1,
    cursor: enabled ? 'pointer' : 'not-allowed',
  })

  const ballStyle = sel => ({
    aspectRatio: '1', borderRadius: RADIUS.pill, padding: 0,
    background: sel
      ? `radial-gradient(circle at 32% 28%, #ff7aa8, ${KENO.pill} 58%, ${KENO.bgOuter})`
      : `radial-gradient(circle at 32% 28%, #57323e, ${KENO.ball} 62%)`,
    border: sel ? '2px solid rgba(255,255,255,0.85)' : `1px solid ${KENO.ballRim}`,
    boxShadow: sel ? '0 0 12px rgba(255,255,255,0.3)' : 'inset 0 -6px 10px rgba(0,0,0,0.5)',
    color: COLORS.white, fontSize: 15, fontWeight: 900,
    fontFamily: "'Space Grotesk', sans-serif",
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    cursor: drawing ? 'not-allowed' : 'pointer',
    transition: 'border-color 0.12s, box-shadow 0.12s',
  })

  return (
    <GameLayout title="Team Keno" emoji="⚽" color={KENO.pill}>
      <Panel style={{
        background: `radial-gradient(circle at 50% 42%, ${KENO.bgCenter}, ${KENO.bgOuter})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18,
        overflow: 'hidden', position: 'relative',
      }}>
        {/* giant side chevrons (dark X texture) */}
        <div style={{
          position: 'absolute', left: -140, top: '52%', width: 260, height: 260,
          border: `46px solid ${KENO.xDark}`, transform: 'translateY(-50%) rotate(45deg)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', right: -140, top: '52%', width: 260, height: 260,
          border: `46px solid ${KENO.xDark}`, transform: 'translateY(-50%) rotate(45deg)',
          pointerEvents: 'none',
        }} />

        {/* ---- top bar ---- */}
        <div style={{
          margin: isMobile ? '-12px -12px 14px' : '-18px -18px 16px',
          padding: '8px 14px',
          background: KENO.band,
          display: 'flex', alignItems: 'center', gap: 10,
          position: 'relative', zIndex: 1,
        }}>
          <span style={{
            padding: '5px 16px', borderRadius: RADIUS.pill,
            background: KENO.pill, border: '1px solid rgba(255,255,255,0.3)',
            color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
          }}>
            TEAM KENO ▾
          </span>
          <span style={{
            padding: '5px 14px', borderRadius: RADIUS.pill,
            background: KENO.orange, color: COLORS.white,
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

        {/* ---- board ---- */}
        <div style={{ maxWidth: 640, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <div style={{
            padding: '6px 0', borderRadius: RADIUS.pill, marginBottom: 12,
            background: KENO.strip, textAlign: 'center',
            color: KENO.green, fontSize: 12, fontWeight: 800, letterSpacing: 1.5,
          }}>
            PICK NUMBERS FOR START
          </div>

          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 14 }}>
            {/* 6×6 number balls */}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: isMobile ? 8 : 10 }}>
              {Array.from({ length: GRID_N }, (_, i) => i + 1).map(n => {
                const sel = selected.includes(n)
                return (
                  <button key={n} type="button" onClick={() => toggleNumber(n)} style={ballStyle(sel)}>
                    <span>{n}</span>
                    {sel && <span style={{ fontSize: 8, lineHeight: 1, marginTop: 1 }}>⚽</span>}
                  </button>
                )
              })}
            </div>

            {/* draw column — fills during K2's live draw, empty at rest */}
            <div style={{
              width: isMobile ? '100%' : 92,
              minHeight: isMobile ? 64 : 'auto',
              border: '1px solid rgba(255,255,255,0.22)',
              borderRadius: 10,
              background: 'rgba(0,0,0,0.12)',
              display: 'flex', flexDirection: isMobile ? 'row' : 'column',
              flexWrap: 'wrap', alignContent: 'flex-start',
              gap: 6, padding: 8, boxSizing: 'border-box',
            }}>
              {drawn.map(n => (
                <span key={n} style={{
                  width: 24, height: 24, borderRadius: RADIUS.pill,
                  background: selected.includes(n) ? KENO.pill : KENO.ball,
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: COLORS.white, fontSize: 11, fontWeight: 800,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>{n}</span>
              ))}
            </div>
          </div>

          {/* RANDOM / CLEAR */}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button type="button" onClick={() => quickPick(10)} style={wideBtn(true)}>RANDOM</button>
            <button type="button" onClick={clearSelection} style={wideBtn(selected.length > 0)}>CLEAR</button>
          </div>
        </div>

        {/* ---- bottom bet band ---- */}
        <div style={{
          margin: isMobile ? '14px -12px -12px' : '18px -18px -18px',
          padding: '12px 18px',
          background: KENO.band,
          display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center',
          position: 'relative', zIndex: 1, flexWrap: 'wrap',
        }}>
          <div style={{
            padding: '5px 22px', borderRadius: RADIUS.pill,
            background: KENO.pill, border: '1px solid rgba(255,255,255,0.3)',
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
          <button type="button" onClick={() => setBet(b => Math.max(1, b - 10))} style={roundBtn}>−</button>
          <button type="button" style={{ ...roundBtn, fontSize: 12 }} title="筹码">≡</button>
          <button type="button" onClick={() => setBet(b => b + 10)} style={roundBtn}>+</button>
          <button type="button" disabled title="自动" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: KENO.blue, color: COLORS.white,
            border: '2px solid rgba(255,255,255,0.4)',
            fontSize: 16, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          <button type="button" disabled onClick={phase === 'done' ? reset : play} style={{
            minWidth: 200, padding: '11px 0', borderRadius: RADIUS.pill, marginLeft: 6,
            background: `linear-gradient(180deg, ${KENO.bet}, ${KENO.betDark})`,
            color: COLORS.white, border: '1px solid rgba(255,255,255,0.25)',
            fontSize: 15, fontWeight: 900, letterSpacing: 2,
            cursor: 'not-allowed', opacity: 0.9,
          }}>
            ▷ BET
          </button>
        </div>
      </Panel>
    </GameLayout>
  )
}
