import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel, BetInput, ActionButton } from '../components/GameLayout'
import { useIsMobile } from '../hooks/useMediaQuery'
import bgmUrl from '../assets/covers/bgm.mp3'

const COLOR = '#16C784'
const TEAMS = ['MUN','MCI','ARS','CHE','LIV','TOT','NEW','AVL','RMA','BAR','ATM','SEV','VAL','VIL','JUV','INT','MIL','NAP','ROM','LAZ','BAY','BVB','RBL','B04','FRA','PSG','MAR','LYO','MON','LIL','BEN','POR','SPO','AJA','PSV','FEY','CEL','RAN','GAL','FEN']
const TOTAL = 40
const DRAW = 20

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
  const [message, setMessage] = useState(null)
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)
  const timerRef = useRef(null)
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
  function playDraw() {   // "哒" per drawn team
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
    setPhase('done')
    setDrawing(false)
  }

  function reset() {
    setPhase('idle')
    setDrawn([])
    setSelected([])
    setMessage(null)
  }

  const matches = drawn.filter(n => selected.includes(n)).length
  const picks = selected.length
  const bestPayout = PAYOUTS[picks]
    ? Math.max(...Object.values(PAYOUTS[picks]))
    : 0

  return (
    <GameLayout title="Team Keno" emoji="⚽" color={COLOR}
      sidebar={
        <Panel>
          <BetInput bet={bet} setBet={setBet}
            onHalf={() => setBet(b => Math.max(1, Math.floor(b / 2)))}
            onDouble={() => setBet(b => b * 2)}
            disabled={phase !== 'idle'}
          />

          {/* Quick pick */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 8 }}>
              Quick Pick
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[1,3,5,7,10].map(n => (
                <button key={n} onClick={() => quickPick(n)}
                  disabled={phase !== 'idle'}
                  style={{
                    padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    background: 'var(--bg2)', color: 'var(--text2)',
                    border: '1.5px solid var(--border)',
                    cursor: phase !== 'idle' ? 'not-allowed' : 'pointer',
                  }}>
                  Pick {n}
                </button>
              ))}
              <button onClick={clearSelection} disabled={phase !== 'idle'} style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                background: 'rgba(239,68,68,0.15)', color: '#FCA5A5',
                border: '1.5px solid rgba(239,68,68,0.35)',
                cursor: phase !== 'idle' ? 'not-allowed' : 'pointer',
              }}>Clear</button>
            </div>
          </div>

          {/* Selection info */}
          <div style={{
            background: 'var(--bg2)', borderRadius: 12, padding: '12px 14px',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Selected</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: COLOR }}>{selected.length}/10</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Matched</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#10B981' }}>{matches}/{picks}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Best Win</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#F59E0B' }}>{bestPayout > 0 ? `${bestPayout}×` : '—'}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Drawn</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>{drawn.length}/{DRAW}</div>
            </div>
          </div>

          {phase === 'idle' ? (
            <ActionButton onClick={play} color={COLOR} disabled={selected.length === 0 || bet > balance || bet < 1}>
              ⚽ Play Team Keno
            </ActionButton>
          ) : phase === 'done' ? (
            <ActionButton onClick={reset} color={COLOR}>
              🔄 Play Again
            </ActionButton>
          ) : (
            <div style={{
              padding: '12px 16px', borderRadius: 12, background: COLOR + '15',
              fontWeight: 600, fontSize: 14, color: COLOR, textAlign: 'center',
            }}>
              Drawing... {drawn.length}/{DRAW}
            </div>
          )}

          {message && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: message.win ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              color: message.win ? '#6EE7B7' : '#FCA5A5',
              fontWeight: 600, fontSize: 13, animation: 'winPop 0.4s ease',
            }}>
              {message.win ? '🎉' : '🎯'} {message.text}
            </div>
          )}

          {/* Payout table */}
          {picks > 0 && PAYOUTS[picks] && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, fontWeight: 600 }}>
                Payouts for {picks} picks
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {Object.entries(PAYOUTS[picks]).map(([m, mult]) => (
                  <div key={m} style={{
                    display: 'flex', justifyContent: 'space-between',
                    padding: '5px 10px', borderRadius: 8,
                    background: Number(m) === matches && phase === 'done' ? COLOR + '20' : 'var(--bg2)',
                    border: `1.5px solid ${Number(m) === matches && phase === 'done' ? COLOR : 'var(--border)'}`,
                    fontSize: 12, fontWeight: 600,
                    color: Number(m) === matches && phase === 'done' ? COLOR : 'var(--text2)',
                  }}>
                    <span>Match {m}</span>
                    <span>{mult}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      }
    >
      <Panel>
        {/* Audio toggles */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
          <button type="button" onClick={() => setBgmOn(v => !v)} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
            width: 38, height: 38, borderRadius: '50%',
            background: bgmOn ? 'rgba(22,199,132,0.18)' : 'var(--bg2)', color: bgmOn ? COLOR : 'var(--text3)',
            border: `1px solid ${bgmOn ? 'rgba(22,199,132,0.5)' : 'var(--border)'}`, fontSize: 15, cursor: 'pointer',
          }}>🎵</button>
          <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
            width: 38, height: 38, borderRadius: '50%',
            background: 'var(--bg2)', color: muted ? 'var(--text3)' : COLOR, border: '1px solid var(--border)', fontSize: 16, cursor: 'pointer',
          }}>{muted ? '🔇' : '🔊'}</button>
        </div>

        {/* Number grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(4, 1fr)' : 'repeat(8, 1fr)',
          gap: 6,
        }}>
          {Array.from({ length: TOTAL }, (_, i) => i + 1).map(n => {
            const isSelected = selected.includes(n)
            const isDrawn = drawn.includes(n)
            const isMatch = isSelected && isDrawn

            return (
              <button
                key={n}
                onClick={() => toggleNumber(n)}
                style={{
                  aspectRatio: '1',
                  borderRadius: 10,
                  fontSize: isMobile ? 11 : 12, fontWeight: 700,
                  border: `2px solid ${isMatch ? '#10B981' : isDrawn ? 'var(--border)' : isSelected ? COLOR : 'var(--border)'}`,
                  background: isMatch ? '#D1FAE5' : isDrawn ? 'var(--bg2)' : isSelected ? COLOR + '20' : 'var(--surface)',
                  color: isMatch ? '#065F46' : isDrawn ? 'var(--text3)' : isSelected ? COLOR : 'var(--text3)',
                  cursor: phase === 'idle' ? 'pointer' : 'default',
                  transition: 'all 0.15s',
                  animation: isDrawn && !isMatch ? 'popIn 0.25s ease' : isMatch ? 'winPop 0.35s ease' : 'none',
                  transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                }}
                onMouseEnter={e => phase === 'idle' && !isSelected && (e.currentTarget.style.background = COLOR + '12')}
                onMouseLeave={e => phase === 'idle' && !isSelected && (e.currentTarget.style.background = 'var(--surface)')}
              >
                {TEAMS[n - 1]}
              </button>
            )
          })}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
          {[
            { color: COLOR + '20', border: COLOR, label: 'Selected' },
            { color: 'var(--bg2)', border: 'var(--border)', label: 'Drawn' },
            { color: '#D1FAE5', border: '#10B981', label: 'Match!' },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text3)' }}>
              <div style={{ width: 14, height: 14, borderRadius: 4, background: item.color, border: `2px solid ${item.border}` }} />
              {item.label}
            </div>
          ))}
        </div>

        {phase === 'idle' && selected.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 14, marginTop: 16 }}>
            Pick 1–10 winning teams, then press Play!
          </p>
        )}
      </Panel>
    </GameLayout>
  )
}
