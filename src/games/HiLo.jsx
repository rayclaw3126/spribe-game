import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel, ActionButton } from '../components/GameLayout'
import { useIsMobile } from '../hooks/useMediaQuery'
import bgmUrl from '../assets/covers/bgm.mp3'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetPanel from '../components/shell/BetPanel'

const COLOR = '#16C784'
const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CM', 'CDM', 'CAM', 'LW', 'RW', 'ST']
const TEAM_COLORS = ['#DC2626', '#2563EB', '#16A34A', '#CA8A04', '#EA580C', '#0891B2']
const STREAK_MULTS = [1, 1.5, 2.5, 4, 6.5, 10, 16, 25]

function randomCard() {
  const rank = Math.floor(Math.random() * 13)   // 0..12
  return {
    rank,
    rating: 70 + rank * 2,                        // 70..94, monotonic with rank
    pos: POSITIONS[Math.floor(Math.random() * POSITIONS.length)],
    teamColor: TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)],
  }
}

// FIFA-style player rating card. Gold for ≥80, dark otherwise.
function PlayerCard({ card, w, h, faceDown }) {
  if (faceDown || !card) {
    return (
      <div style={{
        width: w, height: h, borderRadius: 14,
        background: 'linear-gradient(160deg,#1b2431,#0d1420)',
        border: '2px solid #2b3546',
        boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: w * 0.4, fontWeight: 900, color: '#3a4657' }}>?</span>
      </div>
    )
  }
  const gold = card.rating >= 80
  const ink = gold ? '#3a2c00' : '#e8edf2'
  const sub = gold ? '#6b5416' : '#8a97a6'
  return (
    <div style={{
      width: w, height: h, borderRadius: 14, position: 'relative', overflow: 'hidden',
      background: gold ? 'linear-gradient(160deg,#f7e08a,#d9b24a 55%,#b3862c)' : 'linear-gradient(160deg,#26303f,#141c28)',
      border: `2px solid ${gold ? '#f0d271' : '#2b3546'}`,
      boxShadow: gold ? '0 8px 26px rgba(217,178,74,0.35)' : '0 8px 22px rgba(0,0,0,0.45)',
    }}>
      {/* rating + position (top-left) */}
      <div style={{ position: 'absolute', top: 10, left: 12, lineHeight: 1 }}>
        <div style={{ fontSize: w * 0.29, fontWeight: 900, color: ink, fontFamily: "'Space Grotesk', sans-serif" }}>{card.rating}</div>
        <div style={{ fontSize: w * 0.12, fontWeight: 800, color: sub, letterSpacing: 1, marginTop: 2 }}>{card.pos}</div>
      </div>
      {/* team color chip (top-right) */}
      <div style={{ position: 'absolute', top: 12, right: 12, width: w * 0.12, height: w * 0.12, borderRadius: '50%', background: card.teamColor, border: '2px solid rgba(255,255,255,0.5)' }} />
      {/* jersey silhouette (center-lower) */}
      <div style={{ position: 'absolute', bottom: h * 0.14, left: 0, right: 0, textAlign: 'center' }}>
        <span style={{ fontSize: w * 0.5, filter: `drop-shadow(0 2px 6px rgba(0,0,0,0.3))`, opacity: 0.92 }}>👕</span>
      </div>
      {/* footer */}
      <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', fontSize: w * 0.09, fontWeight: 700, color: sub, letterSpacing: 1 }}>
        RATING
      </div>
    </div>
  )
}

export default function HiLo({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('idle')   // idle | playing | done
  const [currentCard, setCurrentCard] = useState(null)
  const [nextCard, setNextCard] = useState(null)
  const [revealNext, setRevealNext] = useState(false)
  const [flipping, setFlipping] = useState(false)
  const [streak, setStreak] = useState(0)
  const [currentMult, setCurrentMult] = useState(1)
  const [history, setHistory] = useState([])
  const [roundHistory, setRoundHistory] = useState([])   // final multiplier per round (0 = bust), newest first
  const [message, setMessage] = useState(null)
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

  // ---------- game ----------
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
          // advance: revealed card becomes the current one
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

  // Shell BetButton — multi-step mode: bet / live cashout while playing / back to bet.
  const shellBtn = phase === 'playing'
    ? { state: 'cashout', label: `兑现 $${(bet * currentMult).toFixed(2)}`, onClick: cashOut, disabled: flipping || streak === 0 || cashedOut }
    : { state: 'bet', label: `下注 $${Number(bet).toFixed(2)}`, onClick: startGame, disabled: bet > balance || bet < 1 }

  const CW = isMobile ? 120 : 150
  const CH = isMobile ? 168 : 210
  const fires = Math.min(streak, 5)

  return (
    <GameLayout title="Rating Hi-Lo" emoji="📊" color={COLOR}
      sidebar={
        <Panel>
          {phase === 'playing' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ActionButton onClick={() => guess('higher')} color='#16C784' disabled={flipping}>⬆️ Higher</ActionButton>
              <ActionButton onClick={() => guess('lower')} color='#EF4444' disabled={flipping}>⬇️ Lower</ActionButton>
            </div>
          ) : (
            <p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', margin: '4px 0' }}>
              下注后猜下一位球员评分更高或更低
            </p>
          )}

          {message && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: message.win ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              color: message.win ? '#6EE7B7' : '#FCA5A5',
              fontWeight: 600, fontSize: 13, animation: 'winPop 0.4s ease',
            }}>{message.win ? '✅' : '❌'} {message.text}</div>
          )}

          {/* Streak mults */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, fontWeight: 600 }}>Streak Rewards</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {STREAK_MULTS.slice(1).map((m, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderRadius: 8,
                  background: streak === i + 1 ? COLOR + '20' : 'var(--bg2)',
                  border: `1.5px solid ${streak === i + 1 ? COLOR : 'var(--border)'}`,
                  fontSize: 12, fontWeight: 600, color: streak === i + 1 ? COLOR : 'var(--text2)', transition: 'all 0.2s',
                }}>
                  <span>{i + 1} correct in a row</span><span>{m}×</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      }
    >
      <Panel style={{ position: 'relative' }}>
        {/* Round history — final multiplier per round */}
        <RoundHistoryBar rounds={roundHistory} />
        {/* audio toggles */}
        <button type="button" onClick={() => setBgmOn(v => !v)} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
          position: 'absolute', top: 14, right: 60, width: 40, height: 40, borderRadius: '50%', zIndex: 3,
          background: bgmOn ? 'rgba(22,199,132,0.18)' : 'var(--bg2)', color: bgmOn ? COLOR : 'var(--text3)',
          border: `1px solid ${bgmOn ? 'rgba(22,199,132,0.5)' : 'var(--border)'}`, fontSize: 16, cursor: 'pointer',
        }}>🎵</button>
        <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
          position: 'absolute', top: 14, right: 14, width: 40, height: 40, borderRadius: '50%', zIndex: 3,
          background: 'var(--bg2)', color: muted ? 'var(--text3)' : COLOR, border: '1px solid var(--border)', fontSize: 18, cursor: 'pointer',
        }}>{muted ? '🔇' : '🔊'}</button>

        {/* Streak + multiplier */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingRight: 96 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 2 }}>Streak</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: COLOR, display: 'flex', alignItems: 'center', gap: 4 }}>
              {streak}
              <span style={{ fontSize: 22 + streak * 2, transition: 'font-size 0.2s' }}>
                {streak > 0 ? '🔥'.repeat(fires) : ''}
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 2 }}>Multiplier</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#FCD34D', fontFamily: "'Space Grotesk', sans-serif" }}>{currentMult}×</div>
          </div>
        </div>

        {/* Cards duel */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 14 : 30, minHeight: CH + 20, marginBottom: 22 }}>
          <div style={{ textAlign: 'center' }}>
            <PlayerCard card={currentCard} w={CW} h={CH} faceDown={!currentCard} />
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)', fontWeight: 700 }}>当前球员</div>
          </div>

          <div style={{ fontSize: 34, color: 'var(--text3)' }}>→</div>

          {/* Flip card */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ perspective: 800, width: CW, height: CH }}>
              <div style={{
                width: CW, height: CH, position: 'relative', transformStyle: 'preserve-3d',
                transition: 'transform 0.55s cubic-bezier(0.2,0.7,0.3,1)',
                transform: `rotateY(${revealNext ? 180 : 0}deg)`,
              }}>
                <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
                  <PlayerCard faceDown w={CW} h={CH} />
                </div>
                <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                  <PlayerCard card={nextCard} w={CW} h={CH} faceDown={!nextCard} />
                </div>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)', fontWeight: 700 }}>下一个？</div>
          </div>
        </div>

        {/* History row */}
        {history.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {history.map((h, i) => (
              <div key={i} style={{
                width: 44, height: 58, borderRadius: 8, background: 'var(--surface)',
                border: `2px solid ${h.correct ? '#6EE7B7' : '#FCA5A5'}`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden',
              }}>
                <div style={{ width: '100%', height: 8, background: h.card.teamColor }} />
                <span style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{h.card.rating}</span>
              </div>
            ))}
          </div>
        )}

        {phase === 'idle' && (
          <p style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 14, marginTop: 16 }}>
            Deal the players and guess whose rating is higher or lower!
          </p>
        )}
      </Panel>

      {/* Shell bet bay — multi-step mode, no Auto tab */}
      <div style={{ maxWidth: isMobile ? '100%' : 480, margin: '14px auto 0' }}>
        <BetPanel
          bet={bet}
          setBet={setBet}
          max={balance}
          inputDisabled={phase === 'playing'}
          chipDisabled={phase === 'playing'}
          showAuto={false}
          button={shellBtn}
        />
      </div>
    </GameLayout>
  )
}
