import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel, BetInput, ActionButton } from '../components/GameLayout'

const COLOR = '#D97706'
const ROWS = 10
const COLS = ROWS + 1

const MULTIPLIERS = [10, 4, 2, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 2, 4, 10]

const BUCKET_COLORS = [
  '#7C3AED','#8B5CF6','#A78BFA','#C4B5FD','#DDD6FE',
  '#EDE9FE','#DDD6FE','#C4B5FD','#A78BFA','#8B5CF6',
  '#7C3AED','#6D28D9','#5B21B6',
]

export default function Plinko({ balance, setBalance }) {
  const [bet, setBet] = useState(10)
  const [dropping, setDropping] = useState(false)
  const [ballPos, setBallPos] = useState(null)
  const [lastBucket, setLastBucket] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [history, setHistory] = useState([])
  const canvasRef = useRef(null)

  const W = 520, H = 440
  const paddingX = 40, paddingY = 30
  const availW = W - paddingX * 2
  const availH = H - paddingY * 2 - 50 // leave room for buckets

  function getPegPos(row, col) {
    const cols = row + 1
    const startX = paddingX + (availW / 2) - ((cols - 1) * (availW / (ROWS + 1)) / 2)
    const x = startX + col * (availW / (ROWS + 1))
    const y = paddingY + (row / (ROWS - 1)) * availH
    return { x, y }
  }

  function drawBoard(activeBall = null, activeBucket = null) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)

    // Background
    ctx.fillStyle = '#F5F3FF'
    ctx.fillRect(0, 0, W, H)

    // Draw pegs
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col <= row; col++) {
        const { x, y } = getPegPos(row, col)
        ctx.beginPath()
        ctx.arc(x, y, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#7C3AED44'
        ctx.fill()
        ctx.strokeStyle = '#7C3AED'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }

    // Draw buckets
    const bucketW = availW / COLS
    for (let i = 0; i < COLS; i++) {
      const bx = paddingX + i * bucketW
      const by = H - 50
      const isActive = activeBucket === i
      const mult = MULTIPLIERS[i] ?? 1
      ctx.fillStyle = isActive ? BUCKET_COLORS[i] : BUCKET_COLORS[i] + '55'
      ctx.beginPath()
      ctx.roundRect(bx + 2, by, bucketW - 4, 40, 6)
      ctx.fill()
      ctx.fillStyle = isActive ? '#fff' : BUCKET_COLORS[i]
      ctx.font = `bold ${mult >= 4 ? 11 : 10}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(`${mult}×`, bx + bucketW / 2, by + 26)
    }

    // Draw ball
    if (activeBall) {
      ctx.beginPath()
      ctx.arc(activeBall.x, activeBall.y, 9, 0, Math.PI * 2)
      const grad = ctx.createRadialGradient(activeBall.x - 3, activeBall.y - 3, 1, activeBall.x, activeBall.y, 9)
      grad.addColorStop(0, '#FCD34D')
      grad.addColorStop(1, '#F59E0B')
      ctx.fillStyle = grad
      ctx.fill()
      ctx.strokeStyle = '#D97706'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }

  useEffect(() => { drawBoard() }, [])

  async function dropBall() {
    if (bet > balance || dropping) return
    setBalance(b => b - bet)
    setDropping(true)
    setLastResult(null)

    // Simulate path
    let col = 0
    const path = [{ row: -1, x: W / 2, y: paddingY - 20 }]
    for (let row = 0; row < ROWS; row++) {
      const goRight = Math.random() > 0.5
      if (goRight) col++
      const { x, y } = getPegPos(row, col - (goRight ? 1 : 0))
      const pegPos = getPegPos(row, goRight ? col : col)
      path.push({ row, x: pegPos.x + (goRight ? 14 : -14), y: pegPos.y + 6 })
    }

    // Final bucket
    const bucketIdx = Math.min(col, COLS - 1)
    const bucketX = paddingX + bucketIdx * (availW / COLS) + (availW / COLS) / 2
    path.push({ row: ROWS, x: bucketX, y: H - 30 })

    // Animate
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i], to = path[i + 1]
      const steps = 12
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const cx = from.x + (to.x - from.x) * t
        const cy = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * 8
        drawBoard({ x: cx, y: cy }, i === path.length - 2 && s === steps ? bucketIdx : null)
        await new Promise(r => setTimeout(r, 22))
      }
    }

    const mult = MULTIPLIERS[bucketIdx] ?? 1
    const payout = parseFloat((bet * mult).toFixed(2))
    if (payout > 0) setBalance(b => parseFloat((b + payout).toFixed(2)))
    setLastBucket(bucketIdx)
    setLastResult({ mult, payout, win: mult >= 1 })
    setHistory(h => [{ mult, bucketIdx }, ...h].slice(0, 8))
    drawBoard({ x: W / 2, y: H - 30 }, bucketIdx)
    setTimeout(() => { drawBoard(null, bucketIdx); setDropping(false) }, 800)
  }

  return (
    <GameLayout title="Plinko" emoji="🔮" color={COLOR}
      sidebar={
        <Panel>
          <BetInput bet={bet} setBet={setBet}
            onHalf={() => setBet(b => Math.max(1, Math.floor(b / 2)))}
            onDouble={() => setBet(b => b * 2)}
            disabled={dropping}
          />

          {/* Multiplier reference */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, fontWeight: 600 }}>Bucket Multipliers</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {MULTIPLIERS.map((m, i) => (
                <span key={i} style={{
                  padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: lastBucket === i ? BUCKET_COLORS[i] : BUCKET_COLORS[i] + '33',
                  color: lastBucket === i ? '#fff' : BUCKET_COLORS[i],
                  transition: 'all 0.3s',
                }}>{m}×</span>
              ))}
            </div>
          </div>

          <ActionButton onClick={dropBall} color={COLOR} disabled={dropping || bet > balance || bet < 1}>
            {dropping ? '🔮 Dropping...' : '🔮 Drop Ball'}
          </ActionButton>

          {lastResult && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: lastResult.win ? '#D1FAE5' : '#FEE2E2',
              color: lastResult.win ? '#065F46' : '#991B1B',
              fontWeight: 600, fontSize: 14, animation: 'winPop 0.4s ease',
            }}>
              {lastResult.win ? '🎉' : '💔'} {lastResult.mult}× — ${lastResult.payout.toFixed(2)}
            </div>
          )}

          {history.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, fontWeight: 600 }}>History</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {history.map((h, i) => (
                  <span key={i} style={{
                    padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: h.mult >= 2 ? '#D1FAE5' : h.mult >= 1 ? '#FEF3C7' : '#FEE2E2',
                    color: h.mult >= 2 ? '#065F46' : h.mult >= 1 ? '#92400E' : '#991B1B',
                  }}>{h.mult}×</span>
                ))}
              </div>
            </div>
          )}
        </Panel>
      }
    >
      <Panel style={{ padding: 12 }}>
        <canvas ref={canvasRef} width={W} height={H}
          style={{ width: '100%', borderRadius: 12, display: 'block' }}
        />
      </Panel>
    </GameLayout>
  )
}
