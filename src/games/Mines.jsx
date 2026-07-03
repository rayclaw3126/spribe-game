import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel, BetInput, ActionButton } from '../components/GameLayout'
import bgmUrl from '../assets/covers/bgm.mp3'
import ballUrl from '../assets/covers/ball-3d.png'

const COLOR = '#16C784'
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

export default function Mines({ balance, setBalance }) {
  const [bet, setBet] = useState(10)
  const [mineCount, setMineCount] = useState(5)
  const [phase, setPhase] = useState('idle')  // idle | playing | done
  const [mineSet, setMineSet] = useState(null)
  const [revealed, setRevealed] = useState([])
  const [exploded, setExploded] = useState(null)
  const [message, setMessage] = useState(null)
  const [cashedOut, setCashedOut] = useState(false)
  const [shaking, setShaking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)

  const audioRef = useRef({ ctx: null, muted: false })
  const bgmRef = useRef({ audio: null })
  const shakeTimer = useRef(null)

  const gems = revealed.length
  const currentMult = calcMultiplier(gems, mineCount)
  const nextMult = calcMultiplier(gems + 1, mineCount)

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
    setPhase('done')
    setRevealed(prev => {
      const mines = [...mineSet]
      return [...new Set([...prev, ...mines])]
    })
    playCash()
  }

  function getCellEmoji(idx) {
    const isMine = mineSet?.has(idx)
    const isRev = revealed.includes(idx)
    if (!isRev) return null  // hidden
    if (isMine) return idx === exploded ? '🟥' : '🛡️'   // red card where you got tackled / other defenders
    return '⚽'
  }

  return (
    <GameLayout title="Dribble" emoji="👟" color={COLOR}
      sidebar={
        <Panel>
          <BetInput bet={bet} setBet={setBet}
            onHalf={() => setBet(b => Math.max(1, Math.floor(b / 2)))}
            onDouble={() => setBet(b => b * 2)}
            disabled={phase === 'playing'}
          />

          {/* Mine count */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 8 }}>
              Defenders: {mineCount} 💣
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {MINE_COUNTS.map(n => (
                <button key={n} onClick={() => setMineCount(n)}
                  disabled={phase === 'playing'}
                  style={{
                    padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    border: `2px solid ${mineCount === n ? COLOR : 'var(--border)'}`,
                    background: mineCount === n ? COLOR + '15' : 'var(--surface)',
                    color: mineCount === n ? COLOR : 'var(--text2)',
                    cursor: phase === 'playing' ? 'not-allowed' : 'pointer',
                  }}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div style={{
            background: 'var(--bg2)', borderRadius: 12, padding: '12px 14px',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Players Beaten</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#10B981' }}>💎 {gems}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Current ×</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: COLOR }}>{currentMult}×</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Mines</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#EF4444' }}>💣 {mineCount}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Next ×</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B' }}>{nextMult}×</div>
            </div>
          </div>

          {phase === 'playing' && gems > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{
                padding: '10px 14px', borderRadius: 10, fontWeight: 700, fontSize: 15,
                background: 'rgba(16,185,129,0.15)', border: '1.5px solid rgba(16,185,129,0.4)', color: '#6EE7B7', marginBottom: 10,
              }}>
                💰 ${(bet * currentMult).toFixed(2)} ({currentMult}×)
              </div>
              <ActionButton onClick={cashOut} color='#16C784' variant="secondary">
                💸 Cash Out
              </ActionButton>
            </div>
          )}

          {phase !== 'playing' && (
            <ActionButton onClick={startGame} color={COLOR} disabled={bet > balance || bet < 1}>
              👟 {phase === 'done' ? 'Play Again' : 'Start Run'}
            </ActionButton>
          )}

          {message && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: message.win ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              color: message.win ? '#6EE7B7' : '#FCA5A5',
              fontWeight: 600, fontSize: 13, animation: 'winPop 0.4s ease',
            }}>
              {message.text}
            </div>
          )}
        </Panel>
      }
    >
      <Panel>
        <style>{`@keyframes drShake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(3px)} }`}</style>

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

        {/* Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 10,
          animation: shaking ? 'drShake 0.4s ease' : 'none',
        }}>
          {Array.from({ length: GRID }).map((_, idx) => {
            const emoji = getCellEmoji(idx)
            const isRev = revealed.includes(idx)
            const isMine = mineSet?.has(idx) && isRev
            const isGem = isRev && !isMine
            const isExploded = idx === exploded

            return (
              <button
                key={idx}
                onClick={() => revealCell(idx)}
                style={{
                  height: 72, borderRadius: 14,
                  fontSize: 28,
                  border: `2px solid ${isExploded ? '#EF4444' : isGem ? 'rgba(16,185,129,0.5)' : isMine ? 'rgba(239,68,68,0.4)' : phase === 'playing' && !isRev ? COLOR + '44' : 'var(--border)'}`,
                  background: isExploded ? 'rgba(239,68,68,0.15)' : isGem ? 'rgba(16,185,129,0.15)' : isMine ? 'rgba(239,68,68,0.1)' : phase === 'playing' && !isRev ? 'var(--bg2)' : 'var(--surface2)',
                  cursor: phase === 'playing' && !isRev ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                  animation: isRev ? 'popIn 0.3s ease' : 'none',
                  transform: phase === 'playing' && !isRev ? 'scale(1)' : 'scale(0.97)',
                  boxShadow: phase === 'playing' && !isRev ? `0 2px 8px ${COLOR}22` : 'none',
                }}
                onMouseEnter={e => phase === 'playing' && !isRev && (e.currentTarget.style.background = COLOR + '22')}
                onMouseLeave={e => phase === 'playing' && !isRev && (e.currentTarget.style.background = 'var(--bg2)')}
              >
                {isGem
                  ? <img src={ballUrl} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
                  : (emoji || (phase === 'playing' ? '?' : '·'))}
              </button>
            )
          })}
        </div>

        {phase === 'idle' && (
          <p style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 14, marginTop: 20 }}>
            Set defenders, place your bet, and start dribbling!
          </p>
        )}
      </Panel>
    </GameLayout>
  )
}
