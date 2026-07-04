import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import { COLORS, RADIUS, LAYOUT, KENO } from '../components/shell/tokens'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useBgm } from '../components/shell/bgmManager'

// Team Keno — Spribe-aligned rules: 36-ball pool, pick up to 10, 10 balls
// drawn per round. Visual layer is the 1:1 Spribe replica from K1.

const TOTAL = 36   // number pool = the visible 6×6 board
const DRAW = 10    // balls drawn per round

// Standard keno paytable for draw-10-of-36, [picks][hits] = multiplier.
// Multipliers calibrated against the hypergeometric hit distribution
// (RTP ≈ 85–93% per pick size, matching typical Spribe-style keno).
const PAYOUTS = {
  1:  { 1: 3.4 },
  2:  { 2: 13 },
  3:  { 2: 2, 3: 35 },
  4:  { 2: 1, 3: 7, 4: 80 },
  5:  { 3: 3, 4: 22, 5: 450 },
  6:  { 3: 1, 4: 8, 5: 90, 6: 1500 },
  7:  { 4: 4, 5: 30, 6: 350, 7: 8000 },
  8:  { 4: 2, 5: 13, 6: 110, 7: 1200, 8: 10000 },
  9:  { 5: 6, 6: 60, 7: 500, 8: 5000, 9: 10000 },
  10: { 5: 3, 6: 25, 7: 150, 8: 2500, 9: 10000, 10: 10000 },
}

export default function Keno({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [bet, setBet] = useState(10)
  const [selected, setSelected] = useState([])
  const [drawn, setDrawn] = useState([])
  const [drawing, setDrawing] = useState(false)
  const [phase, setPhase] = useState('idle') // idle | drawing | done
  const [roundHistory, setRoundHistory] = useState([])   // won multiplier per round, newest first
  const [message, setMessage] = useState(null)
  const [muted, setMuted] = useState(false)
  const [bgmOn, toggleBgm] = useBgm()
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // fake feed rows (display only)
  const audioRef = useRef({ ctx: null, muted: false })

  useEffect(() => { audioRef.current.muted = muted }, [muted])

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
    setFeedBets(makeFeedBots())   // fresh fake round rides along (display only)

    // Fisher-Yates over the 36 pool, take 10 — one ball drops every ~200ms
    const pool = Array.from({ length: TOTAL }, (_, i) => i + 1)
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    const shuffled = pool.slice(0, DRAW)
    const drawResult = []

    for (let i = 0; i < shuffled.length; i++) {
      await new Promise(r => setTimeout(r, 200))
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
    // fake feed rows settle for the round: ~45% cash green, the rest grey out
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
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

  // ring sync while balls drop: hit = green ring, drawn-but-unpicked = white ring
  const ballStyle = (sel, isDrawn) => {
    const hit = sel && isDrawn
    return {
      aspectRatio: '1', borderRadius: RADIUS.pill, padding: 0,
      background: sel
        ? `radial-gradient(circle at 32% 28%, #ff7aa8, ${KENO.pill} 58%, ${KENO.bgOuter})`
        : `radial-gradient(circle at 32% 28%, #57323e, ${KENO.ball} 62%)`,
      border: hit
        ? `2px solid ${KENO.green}`
        : isDrawn
          ? '2px solid rgba(255,255,255,0.9)'
          : sel ? '2px solid rgba(255,255,255,0.85)' : `1px solid ${KENO.ballRim}`,
      boxShadow: hit
        ? `0 0 14px ${KENO.green}`
        : isDrawn
          ? '0 0 10px rgba(255,255,255,0.35)'
          : sel ? '0 0 12px rgba(255,255,255,0.3)' : 'inset 0 -6px 10px rgba(0,0,0,0.5)',
      color: COLORS.white, fontSize: 15, fontWeight: 900,
      fontFamily: "'Space Grotesk', sans-serif",
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      cursor: drawing ? 'not-allowed' : 'pointer',
      transition: 'border-color 0.12s, box-shadow 0.12s',
    }
  }
  const drawnSet = new Set(drawn)

  const gameCard = (
      <Panel style={{
        background: `radial-gradient(circle at 50% 42%, ${KENO.bgCenter}, ${KENO.bgOuter})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18,
        overflow: 'hidden', position: 'relative',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
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
          <button type="button" onClick={toggleBgm} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
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
          <style>{`
            @keyframes kenoDrop {
              from { transform: translateY(-18px) scale(0.6); opacity: 0; }
              to { transform: translateY(0) scale(1); opacity: 1; }
            }
          `}</style>
          {!isDesk && <RoundHistoryBar rounds={roundHistory} />}
          <div style={{
            padding: '6px 0', borderRadius: RADIUS.pill, marginBottom: 12,
            background: KENO.strip, textAlign: 'center',
            color: message ? (message.win ? KENO.green : '#ff8a80') : KENO.green,
            fontSize: 12, fontWeight: 800, letterSpacing: 1.5,
          }}>
            {phase === 'drawing' ? 'DRAWING…' : message ? message.text : 'PICK NUMBERS FOR START'}
          </div>

          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 14 }}>
            {/* 6×6 number balls */}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: isMobile ? 8 : 10 }}>
              {Array.from({ length: TOTAL }, (_, i) => i + 1).map(n => {
                const sel = selected.includes(n)
                return (
                  <button key={n} type="button" onClick={() => toggleNumber(n)} style={ballStyle(sel, drawnSet.has(n))}>
                    <span>{n}</span>
                    {sel && <span style={{ fontSize: 8, lineHeight: 1, marginTop: 1 }}>⚽</span>}
                  </button>
                )
              })}
            </div>

            {/* draw column — balls drop in one by one with a springy landing */}
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
              {drawn.map(n => {
                const hit = selected.includes(n)
                return (
                  <span key={n} style={{
                    width: 24, height: 24, borderRadius: RADIUS.pill,
                    background: hit ? KENO.pill : KENO.ball,
                    border: `1.5px solid ${hit ? KENO.green : 'rgba(255,255,255,0.3)'}`,
                    boxShadow: hit ? `0 0 8px ${KENO.green}` : 'none',
                    color: COLORS.white, fontSize: 11, fontWeight: 800,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    animation: 'kenoDrop 0.3s cubic-bezier(0.34,1.56,0.64,1)',
                  }}>{n}</span>
                )
              })}
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
          {(() => {
            const canBet = phase === 'idle' && selected.length > 0 && bet <= balance && bet >= 1
            const isDone = phase === 'done'
            const enabled = isDone || canBet
            return (
              <button type="button" disabled={!enabled} onClick={isDone ? reset : play} style={{
                minWidth: 200, padding: '11px 0', borderRadius: RADIUS.pill, marginLeft: 6,
                background: `linear-gradient(180deg, ${KENO.bet}, ${KENO.betDark})`,
                color: COLORS.white, border: '1px solid rgba(255,255,255,0.25)',
                fontSize: 15, fontWeight: 900, letterSpacing: 2,
                cursor: enabled ? 'pointer' : 'not-allowed',
                opacity: enabled ? 1 : 0.55,
                transition: 'opacity 0.15s',
              }}>
                {isDone ? '再来一轮' : '▷ BET'}
              </button>
            )
          })()}
        </div>
      </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Team Roulette ----
  if (isDesk) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640,
        background: COLORS.bg,
      }}>
        <div style={{
          height: LAYOUT.headerH, flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', background: COLORS.panel,
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Team Keno</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

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
    <GameLayout title="Team Keno" emoji="⚽" color={KENO.pill}>
      {gameCard}
    </GameLayout>
  )
}
