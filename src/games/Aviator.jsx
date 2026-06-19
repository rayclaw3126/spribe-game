import { useState, useEffect, useRef } from 'react'
import GameLayout, { Panel, BetInput, ActionButton } from '../components/GameLayout'

const COLOR = '#7C3AED'

export default function Aviator({ balance, setBalance, onBack }) {
  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('idle') // idle | flying | crashed
  const [multiplier, setMultiplier] = useState(1.00)
  const [cashedOut, setCashedOut] = useState(false)
  const [cashoutMult, setCashoutMult] = useState(null)
  const [crashPoint, setCrashPoint] = useState(null)
  const [history, setHistory] = useState([2.4, 1.1, 5.6, 1.3, 8.2, 1.0, 3.1])
  const [message, setMessage] = useState(null)
  const intervalRef = useRef(null)
  const canvasRef = useRef(null)
  const frameRef = useRef(null)
  const startTimeRef = useRef(null)
  const crashRef = useRef(null)

  // Generate crash point using house edge formula
  function generateCrash() {
    const r = Math.random()
    if (r < 0.01) return 1.0
    return Math.max(1.0, (1 / (1 - r * 0.97)))
  }

  function startGame() {
    if (bet > balance) return
    setBalance(b => b - bet)
    const cp = parseFloat(generateCrash().toFixed(2))
    setCrashPoint(cp)
    crashRef.current = cp
    setMultiplier(1.00)
    setCashedOut(false)
    setCashoutMult(null)
    setMessage(null)
    setPhase('flying')
    startTimeRef.current = Date.now()

    frameRef.current = requestAnimationFrame(function tick() {
      const elapsed = (Date.now() - startTimeRef.current) / 1000
      const m = Math.pow(Math.E, elapsed * 0.35)
      const capped = parseFloat(Math.min(m, crashRef.current).toFixed(2))
      setMultiplier(capped)
      drawGraph(capped, crashRef.current)

      if (capped >= crashRef.current) {
        setPhase('crashed')
        setHistory(h => [parseFloat(crashRef.current.toFixed(2)), ...h].slice(0, 10))
        setMessage({ text: `Crashed at ${crashRef.current.toFixed(2)}×`, win: false })
        return
      }
      frameRef.current = requestAnimationFrame(tick)
    })
  }

  function cashOut() {
    if (phase !== 'flying' || cashedOut) return
    cancelAnimationFrame(frameRef.current)
    const m = multiplier
    setCashedOut(true)
    setCashoutMult(m)
    const winnings = parseFloat((bet * m).toFixed(2))
    setBalance(b => parseFloat((b + winnings).toFixed(2)))
    setMessage({ text: `Cashed out at ${m.toFixed(2)}× — Won $${winnings.toFixed(2)}!`, win: true })
    setPhase('crashed')
    setHistory(h => [parseFloat(crashPoint.toFixed(2)), ...h].slice(0, 10))
  }

  function drawGraph(current, crash) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    const pct = Math.min(current / Math.max(crash, 5), 1)
    const pts = 60
    ctx.beginPath()
    for (let i = 0; i <= pts; i++) {
      const t = (i / pts) * pct
      const x = (i / pts) * W
      const y = H - (Math.pow(Math.E, t * Math.log(Math.max(crash, 5))) / Math.max(crash, 5)) * (H - 20) - 10
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    const grad = ctx.createLinearGradient(0, 0, W, 0)
    grad.addColorStop(0, '#7C3AED88')
    grad.addColorStop(1, '#A855F7')
    ctx.strokeStyle = grad
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    ctx.stroke()

    // Plane
    const px = (pct) * W
    const py = H - (Math.pow(Math.E, pct * Math.log(Math.max(crash, 5))) / Math.max(crash, 5)) * (H - 20) - 10
    ctx.font = '28px serif'
    ctx.fillText('✈️', px - 18, py + 10)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) drawGraph(1, 5)
  }, [])

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  const isCrashed = phase === 'crashed'

  return (
    <GameLayout title="Aviator" emoji="✈️" color={COLOR}
      sidebar={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel>
            <BetInput bet={bet} setBet={setBet}
              onHalf={() => setBet(b => Math.max(1, Math.floor(b / 2)))}
              onDouble={() => setBet(b => b * 2)}
              disabled={phase === 'flying'}
            />
            {phase === 'idle' || phase === 'crashed' ? (
              <ActionButton onClick={startGame} color={COLOR}
                disabled={bet > balance || bet < 1}>
                🚀 Place Bet & Fly
              </ActionButton>
            ) : (
              <ActionButton onClick={cashOut} color='#10B981'
                disabled={cashedOut}>
                💰 Cash Out ({multiplier.toFixed(2)}×)
              </ActionButton>
            )}
            {message && (
              <div style={{
                marginTop: 14, padding: '12px 16px', borderRadius: 12,
                background: message.win ? '#D1FAE5' : '#FEE2E2',
                color: message.win ? '#065F46' : '#991B1B',
                fontWeight: 600, fontSize: 14,
                animation: 'winPop 0.4s ease',
              }}>
                {message.win ? '🎉' : '💥'} {message.text}
              </div>
            )}
          </Panel>
          <Panel>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)', marginBottom: 10 }}>
              Recent Crashes
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
      <Panel style={{ minHeight: 340 }}>
        {/* Multiplier display */}
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{
            fontSize: phase === 'crashed' && !cashedOut ? 52 : 64,
            fontWeight: 900,
            fontFamily: "'Space Grotesk', sans-serif",
            color: isCrashed && !cashedOut ? '#EF4444' : isCrashed && cashedOut ? '#10B981' : COLOR,
            lineHeight: 1,
            animation: phase === 'flying' ? 'pulse 0.8s ease-in-out infinite' : 'none',
            transition: 'color 0.3s',
          }}>
            {isCrashed && !cashedOut ? 'CRASH!' : `${multiplier.toFixed(2)}×`}
          </div>
          {phase === 'flying' && (
            <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>
              Flying... cash out before it crashes!
            </div>
          )}
          {phase === 'idle' && (
            <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>
              Place your bet and launch the plane!
            </div>
          )}
        </div>
        {/* Canvas graph */}
        <canvas ref={canvasRef} width={580} height={220}
          style={{ width: '100%', height: 220, borderRadius: 12, background: 'var(--bg2)' }}
        />
      </Panel>
    </GameLayout>
  )
}
