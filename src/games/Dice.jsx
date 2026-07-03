import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetPanel from '../components/shell/BetPanel'
import bgmUrl from '../assets/covers/bgm.mp3'

const COLOR = '#16C784'

// Which of the 3×3 grid cells (1..9) hold pips for each die value.
const PIPS = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
}

function Die({ value, size = 120 }) {
  const pips = PIPS[value] || []
  const dot = Math.round(size * 0.16)
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.16,
      background: '#f4f8ff', border: '1px solid #d3dae6',
      boxShadow: '0 8px 24px rgba(0,0,0,0.45), inset 0 -4px 10px rgba(0,0,0,0.08)',
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)',
      padding: size * 0.12, boxSizing: 'border-box', gap: size * 0.04,
    }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {pips.includes(i + 1) && (
            <div style={{ width: dot, height: dot, borderRadius: '50%', background: '#1a2230' }} />
          )}
        </div>
      ))}
    </div>
  )
}

export default function Dice({ balance, setBalance }) {
  const [bet, setBet] = useState(10)
  const [target, setTarget] = useState(4)   // total goals OVER this
  const [mode, setMode] = useState('over')  // over | under
  const [rolling, setRolling] = useState(false)
  const [result, setResult] = useState(null)
  const [roundHistory, setRoundHistory] = useState([])   // won multiplier per round (0 = loss), newest first
  const [face, setFace] = useState(4)
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)

  const audioRef = useRef({ ctx: null, muted: false })
  const bgmRef = useRef({ audio: null })

  const winChance = mode === 'over' ? (6 - target) / 6 : target / 6
  const multiplier = parseFloat((0.97 / winChance).toFixed(2))

  useEffect(() => { audioRef.current.muted = muted }, [muted])

  // ---------- SFX (Web Audio synth) ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC()
    if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx
    return ctx
  }
  // Dice rattle: a quick short click each tumble frame.
  function playTick() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'square'; o.frequency.value = 420 + Math.random() * 520
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.06)
  }
  // Landing "啪": punchy thump + short noise.
  function playLand() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(230, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.12)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.18)
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate)
    const d = nb.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const ng = ctx.createGain(); ng.gain.value = 0.09
    ns.connect(ng); ng.connect(ctx.destination); ns.start(t); ns.stop(t + 0.05)
  }
  // Win: bright rising arpeggio.
  function playWin() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[660, 880, 1180].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.09
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.13, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.3)
    })
  }
  // Lose: low descending tone.
  function playLose() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.4)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.47)
  }

  // ---------- BGM (real mp3, HTML Audio) — mirrors Breakaway ----------
  function startBgm() {
    if (bgmRef.current.audio) return
    const audio = new Audio(bgmUrl)
    audio.loop = true
    audio.volume = 0.25
    audio.play().catch(() => {})
    bgmRef.current.audio = audio
  }
  function stopBgm() {
    if (bgmRef.current.audio) {
      bgmRef.current.audio.pause()
      bgmRef.current.audio = null
    }
  }
  useEffect(() => {
    if (bgmOn) startBgm()
    else stopBgm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgmOn])
  useEffect(() => () => stopBgm(), [])

  function roll() {
    if (bet > balance || rolling || bet < 1) return
    ensureAudio()
    setBalance(b => parseFloat((b - bet).toFixed(2)))
    setResult(null)
    setRolling(true)

    let ticks = 0
    const id = setInterval(() => {
      setFace(1 + Math.floor(Math.random() * 6))
      playTick()
      ticks++
      if (ticks >= 14) {
        clearInterval(id)
        const r = 1 + Math.floor(Math.random() * 6)
        setFace(r)
        playLand()
        const win = mode === 'over' ? r > target : r <= target
        const profit = win ? parseFloat((bet * multiplier).toFixed(2)) : 0
        if (win) setBalance(b => parseFloat((b + profit).toFixed(2)))
        setResult({ roll: r, win, profit })
        setRoundHistory(h => [win ? multiplier : 0, ...h].slice(0, 20))
        setRolling(false)
        setTimeout(() => (win ? playWin() : playLose()), 150)
      }
    }, 60)
  }

  return (
    <GameLayout title="Total Goals" emoji="⚽" color={COLOR}
      sidebar={
        <Panel>
          {/* Mode toggle */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 8 }}>
              Bet Type
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['over', 'under'].map(m => (
                <button key={m} onClick={() => !rolling && setMode(m)} disabled={rolling} style={{
                  flex: 1, padding: '9px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                  border: `2px solid ${mode === m ? COLOR : 'var(--border)'}`,
                  background: mode === m ? COLOR + '15' : 'var(--surface)',
                  color: mode === m ? COLOR : 'var(--text2)',
                  cursor: rolling ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                }}>
                  {m === 'over' ? '⬆️ Over' : '⬇️ Under'}
                </button>
              ))}
            </div>
          </div>

          {/* Target slider */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 8 }}>
              {mode === 'over' ? `Goals Over: ${target}` : `Goals Under or Equal: ${target}`}
            </label>
            <input type="range" min={1} max={5} value={target}
              onChange={e => setTarget(Number(e.target.value))}
              disabled={rolling}
              style={{ width: '100%', accentColor: COLOR }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
            </div>
          </div>

          {/* Stats */}
          <div style={{
            background: 'var(--bg2)', borderRadius: 12, padding: '12px 14px',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16,
          }}>
            <StatBox label="Win Chance" value={`${(winChance * 100).toFixed(0)}%`} color={COLOR} />
            <StatBox label="Multiplier" value={`${multiplier}×`} color='#10B981' />
            <StatBox label="Payout" value={`$${(bet * multiplier).toFixed(2)}`} color='#F59E0B' />
            <StatBox label="Profit" value={`$${(bet * multiplier - bet).toFixed(2)}`} color='#16C784' />
          </div>

          {result && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: result.win ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              color: result.win ? '#6EE7B7' : '#FCA5A5',
              fontWeight: 600, fontSize: 14, animation: 'winPop 0.4s ease',
            }}>
              {result.win ? '🎉' : '💔'} {result.roll} goals — {result.win ? `Won $${result.profit.toFixed(2)}!` : 'Better luck next time!'}
            </div>
          )}
        </Panel>
      }
    >
      <Panel style={{ position: 'relative', minHeight: 320, display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center' }}>
        <RoundHistoryBar rounds={roundHistory} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        {/* Audio toggles — top-right corner (🎵 music + 🔊 sfx, independent) */}
        <button type="button" onClick={() => setBgmOn(v => !v)} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
          position: 'absolute', top: 12, right: 60, width: 40, height: 40, borderRadius: '50%',
          background: bgmOn ? 'rgba(22,199,132,0.18)' : 'var(--bg2)',
          color: bgmOn ? COLOR : 'var(--text3)',
          border: `1px solid ${bgmOn ? 'rgba(22,199,132,0.5)' : 'var(--border)'}`, fontSize: 16, cursor: 'pointer',
        }}>🎵</button>
        <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
          position: 'absolute', top: 12, right: 12, width: 40, height: 40, borderRadius: '50%',
          background: 'var(--bg2)', color: muted ? 'var(--text3)' : COLOR,
          border: '1px solid var(--border)', fontSize: 18, cursor: 'pointer',
        }}>{muted ? '🔇' : '🔊'}</button>

        {/* Big die */}
        <div style={{
          marginBottom: 28,
          animation: rolling ? 'spin 0.3s linear infinite' : result ? 'winPop 0.4s ease' : 'float 3s ease-in-out infinite',
          filter: result?.win ? 'drop-shadow(0 0 22px rgba(16,185,129,0.5))' : 'none',
        }}>
          <Die value={face} size={120} />
        </div>

        {/* Winning numbers row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {[1, 2, 3, 4, 5, 6].map(n => {
            const isWin = mode === 'over' ? n > target : n <= target
            return (
              <div key={n} style={{
                width: 40, height: 40, borderRadius: 10, fontSize: 16, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isWin ? COLOR + '20' : 'var(--bg2)',
                border: `2px solid ${isWin ? COLOR : 'var(--border)'}`,
                color: isWin ? COLOR : 'var(--text3)',
                transition: 'all 0.2s',
              }}>{n}</div>
            )
          })}
        </div>

        <p style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center' }}>
          {mode === 'over'
            ? `Win when total goals OVER ${target} (${[...Array(6)].map((_, i) => i + 1).filter(n => n > target).join(', ')})`
            : `Win when total goals ${target} OR UNDER (${[...Array(6)].map((_, i) => i + 1).filter(n => n <= target).join(', ')})`
          }
        </p>
        </div>
      </Panel>

      {/* Shell bet bay — one-shot mode, no Auto tab */}
      <div style={{ maxWidth: 480, margin: '14px auto 0' }}>
        <BetPanel
          bet={bet}
          setBet={setBet}
          max={balance}
          inputDisabled={rolling}
          chipDisabled={rolling}
          showAuto={false}
          button={rolling
            ? { state: 'waiting', label: '结算中…', disabled: true }
            : { state: 'bet', label: `下注 $${bet.toFixed(2)}`, onClick: roll, disabled: bet > balance || bet < 1 }}
        />
      </div>
    </GameLayout>
  )
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}
