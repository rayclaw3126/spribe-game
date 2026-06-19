import { useState, useEffect, useRef } from 'react'
import GameLayout, { Panel, BetInput, ActionButton } from '../components/GameLayout'

const COLOR = '#EA580C'

function generatePop() {
  // Pop point between 1.01 and ~30 (skewed toward lower)
  const r = Math.random()
  if (r < 0.03) return 1.01
  return parseFloat((1 + Math.pow(-Math.log(1 - r * 0.97), 0.7) * 3).toFixed(2))
}

export default function Balloon({ balance, setBalance }) {
  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('idle')   // idle | inflating | popped
  const [multiplier, setMultiplier] = useState(1.00)
  const [popPoint, setPopPoint] = useState(null)
  const [cashedOut, setCashedOut] = useState(false)
  const [cashoutMult, setCashoutMult] = useState(null)
  const [message, setMessage] = useState(null)
  const [history, setHistory] = useState([3.2, 1.5, 8.7, 1.1, 2.4, 14.2, 1.0, 5.5])
  const frameRef = useRef(null)
  const startRef = useRef(null)
  const popRef = useRef(null)

  const SIZE_MIN = 60, SIZE_MAX = 240
  const balloonSize = Math.min(SIZE_MIN + (multiplier - 1) * 18, SIZE_MAX)
  const isInflating = phase === 'inflating'
  const isPopped = phase === 'popped'

  function startGame() {
    if (bet > balance) return
    setBalance(b => b - bet)
    const pp = generatePop()
    setPopPoint(pp)
    popRef.current = pp
    setMultiplier(1.00)
    setCashedOut(false)
    setCashoutMult(null)
    setMessage(null)
    setPhase('inflating')
    startRef.current = Date.now()

    frameRef.current = requestAnimationFrame(function tick() {
      const elapsed = (Date.now() - startRef.current) / 1000
      const m = parseFloat((1 + elapsed * 0.6 + elapsed * elapsed * 0.1).toFixed(2))
      setMultiplier(m)

      if (m >= popRef.current) {
        setPhase('popped')
        setHistory(h => [parseFloat(popRef.current.toFixed(2)), ...h].slice(0, 10))
        setMessage({ text: `Balloon popped at ${popRef.current.toFixed(2)}×! 💥`, win: false })
        return
      }
      frameRef.current = requestAnimationFrame(tick)
    })
  }

  function cashOut() {
    if (phase !== 'inflating' || cashedOut) return
    cancelAnimationFrame(frameRef.current)
    const m = multiplier
    setCashedOut(true)
    setCashoutMult(m)
    const payout = parseFloat((bet * m).toFixed(2))
    setBalance(b => parseFloat((b + payout).toFixed(2)))
    setMessage({ text: `Cashed out ${m.toFixed(2)}× — Won $${payout.toFixed(2)}! 🎉`, win: true })
    setHistory(h => [parseFloat(m.toFixed(2)), ...h].slice(0, 10))
    setPhase('popped')
  }

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  // Balloon color based on size (green → yellow → red)
  const ratio = (balloonSize - SIZE_MIN) / (SIZE_MAX - SIZE_MIN)
  const r = Math.round(34 + ratio * 221)
  const g = Math.round(197 - ratio * 110)
  const b2 = Math.round(94 - ratio * 94)
  const balloonColor = `rgb(${r},${g},${b2})`
  const glowColor = isPopped && !cashedOut ? '#EF4444' : cashedOut ? '#10B981' : balloonColor

  return (
    <GameLayout title="Balloon" emoji="🎈" color={COLOR}
      sidebar={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel>
            <BetInput bet={bet} setBet={setBet}
              onHalf={() => setBet(b => Math.max(1, Math.floor(b / 2)))}
              onDouble={() => setBet(b => b * 2)}
              disabled={phase === 'inflating'}
            />

            {phase === 'idle' || phase === 'popped' ? (
              <ActionButton onClick={startGame} color={COLOR} disabled={bet > balance || bet < 1}>
                🎈 {phase === 'popped' ? 'New Balloon' : 'Inflate & Bet'}
              </ActionButton>
            ) : (
              <ActionButton onClick={cashOut} color='#10B981' disabled={cashedOut}>
                💰 Pop & Cash Out ({multiplier.toFixed(2)}×)
              </ActionButton>
            )}

            {message && (
              <div style={{
                marginTop: 14, padding: '12px 16px', borderRadius: 12,
                background: message.win ? '#D1FAE5' : '#FEE2E2',
                color: message.win ? '#065F46' : '#991B1B',
                fontWeight: 600, fontSize: 13, animation: 'winPop 0.4s ease',
              }}>
                {message.win ? '🎉' : '💥'} {message.text}
              </div>
            )}
          </Panel>

          <Panel>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)', marginBottom: 10 }}>
              Recent Pops
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {history.map((v, i) => (
                <span key={i} style={{
                  padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  background: v < 2 ? '#FEE2E2' : v < 5 ? '#FEF3C7' : '#D1FAE5',
                  color: v < 2 ? '#991B1B' : v < 5 ? '#92400E' : '#065F46',
                }}>{v.toFixed(2)}×</span>
              ))}
            </div>
          </Panel>
        </div>
      }
    >
      <Panel style={{ minHeight: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {/* Multiplier */}
        <div style={{
          fontSize: 56, fontWeight: 900,
          fontFamily: "'Space Grotesk', sans-serif",
          color: isPopped && !cashedOut ? '#EF4444' : cashedOut ? '#10B981' : COLOR,
          lineHeight: 1, marginBottom: 8,
          transition: 'color 0.3s',
          animation: isInflating ? 'pulse 1s ease-in-out infinite' : 'none',
        }}>
          {isPopped && !cashedOut ? '💥 POP!' : `${multiplier.toFixed(2)}×`}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 32 }}>
          {phase === 'idle' && 'Place your bet and inflate!'}
          {isInflating && 'Inflating... cash out before it pops!'}
          {isPopped && cashedOut && `Cashed out safely at ${cashoutMult?.toFixed(2)}×`}
          {isPopped && !cashedOut && `It popped at ${popPoint?.toFixed(2)}×`}
        </div>

        {/* Balloon */}
        <div style={{ position: 'relative', width: SIZE_MAX + 40, height: SIZE_MAX + 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          {/* String */}
          <div style={{
            position: 'absolute', bottom: 0, left: '50%',
            width: 2, height: 60,
            background: 'linear-gradient(to bottom, #9CA3AF, transparent)',
            transform: 'translateX(-50%)',
          }} />

          {/* Balloon body */}
          {!(isPopped && !cashedOut) ? (
            <div style={{
              position: 'absolute',
              bottom: 60,
              left: '50%',
              transform: 'translateX(-50%)',
              width: balloonSize,
              height: balloonSize * 1.2,
              borderRadius: '50% 50% 45% 45%',
              background: `radial-gradient(circle at 35% 35%, ${balloonColor}dd, ${balloonColor})`,
              boxShadow: `0 0 ${Math.round(ratio * 30 + 10)}px ${glowColor}66, inset -8px -8px 20px ${balloonColor}88`,
              transition: isInflating ? 'none' : 'all 0.3s',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {/* Shine */}
              <div style={{
                position: 'absolute', top: '18%', left: '25%',
                width: '25%', height: '18%',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.45)',
                transform: 'rotate(-30deg)',
              }} />
              <span style={{ fontSize: Math.round(balloonSize * 0.3), opacity: 0.6 }}>
                {ratio > 0.7 ? '😰' : ratio > 0.4 ? '😊' : '😄'}
              </span>
            </div>
          ) : (
            <div style={{
              position: 'absolute', bottom: 60, left: '50%',
              transform: 'translateX(-50%)',
              fontSize: 80, animation: 'winPop 0.4s ease',
            }}>💥</div>
          )}
        </div>

        {/* Danger bar */}
        {isInflating && (
          <div style={{ width: 260, marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>
              <span>Safe</span>
              <span>Danger</span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: 'var(--bg2)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 99,
                width: `${Math.min(ratio * 100, 100)}%`,
                background: `linear-gradient(90deg, #10B981, #F59E0B, #EF4444)`,
                transition: 'width 0.1s',
              }} />
            </div>
          </div>
        )}
      </Panel>
    </GameLayout>
  )
}
