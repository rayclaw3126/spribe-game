import { useState } from 'react'
import GameLayout, { Panel, BetInput, ActionButton } from '../components/GameLayout'

const COLOR = '#059669'
const COLS = 5
const ROWS = 3

// Each column has 1 keeper hidden behind one of the 3 cells
function generateKeepers() {
  return Array.from({ length: COLS }, () => Math.floor(Math.random() * ROWS))
}

// Multipliers increase per column advanced
const COL_MULTS = [1.4, 2.0, 3.0, 5.0, 10.0]

export default function Goal({ balance, setBalance }) {
  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('idle')   // idle | playing | done
  const [keepers, setKeepers] = useState(null)
  const [currentCol, setCurrentCol] = useState(0)
  const [picks, setPicks] = useState([])       // [{col, row, hit}]
  const [revealed, setRevealed] = useState([]) // flat indices revealed
  const [message, setMessage] = useState(null)
  const [cashedOut, setCashedOut] = useState(false)
  const [currentMult, setCurrentMult] = useState(1)

  function startGame() {
    if (bet > balance) return
    setBalance(b => b - bet)
    setKeepers(generateKeepers())
    setCurrentCol(0)
    setPicks([])
    setRevealed([])
    setMessage(null)
    setCashedOut(false)
    setCurrentMult(1)
    setPhase('playing')
  }

  function pickCell(col, row) {
    if (phase !== 'playing' || col !== currentCol) return

    const keeperRow = keepers[col]
    const hit = row === keeperRow
    const idx = col * ROWS + row

    setRevealed(r => [...r, idx])
    setPicks(p => [...p, { col, row, hit }])

    if (hit) {
      // Reveal all keepers
      const allKeepers = keepers.map((kr, c) => c * ROWS + kr)
      setRevealed(allKeepers)
      setMessage({ text: `Goalkeeper blocked it! Lost $${bet.toFixed(2)}`, win: false })
      setPhase('done')
    } else {
      const nextCol = col + 1
      const mult = COL_MULTS[col]
      setCurrentMult(mult)
      if (nextCol >= COLS) {
        // Scored all goals!
        const payout = parseFloat((bet * COL_MULTS[COLS - 1]).toFixed(2))
        setBalance(b => parseFloat((b + payout).toFixed(2)))
        setMessage({ text: `FULL SCORE! Won $${payout.toFixed(2)}! 🏆`, win: true })
        setPhase('done')
        const allKeepers = keepers.map((kr, c) => c * ROWS + kr)
        setRevealed(allKeepers)
      } else {
        setCurrentCol(nextCol)
      }
    }
  }

  function cashOut() {
    if (phase !== 'playing' || currentCol === 0 || cashedOut) return
    const mult = COL_MULTS[currentCol - 1]
    const payout = parseFloat((bet * mult).toFixed(2))
    setBalance(b => parseFloat((b + payout).toFixed(2)))
    setCashedOut(true)
    setMessage({ text: `Cashed out ${mult}× — Won $${payout.toFixed(2)}!`, win: true })
    const allKeepers = keepers.map((kr, c) => c * ROWS + kr)
    setRevealed(allKeepers)
    setPhase('done')
  }

  function getCellState(col, row) {
    const idx = col * ROWS + row
    const pick = picks.find(p => p.col === col && p.row === row)
    const isKeeper = keepers && keepers[col] === row && revealed.includes(idx)
    const isGoal = pick && !pick.hit
    const isMiss = pick && pick.hit
    return { isKeeper, isGoal, isMiss, isRevealed: revealed.includes(idx) }
  }

  const phasePlaying = phase === 'playing'
  const nextMult = phasePlaying ? COL_MULTS[currentCol] : null

  return (
    <GameLayout title="Goal" emoji="⚽" color={COLOR}
      sidebar={
        <Panel>
          <BetInput bet={bet} setBet={setBet}
            onHalf={() => setBet(b => Math.max(1, Math.floor(b / 2)))}
            onDouble={() => setBet(b => b * 2)}
            disabled={phasePlaying}
          />

          {phasePlaying && currentCol > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>
                Current winnings if you cash out:
              </div>
              <div style={{
                padding: '10px 14px', borderRadius: 10, fontWeight: 700, fontSize: 16,
                background: '#D1FAE533', border: '1.5px solid #6EE7B7', color: COLOR, marginBottom: 10,
              }}>
                💰 ${(bet * COL_MULTS[currentCol - 1]).toFixed(2)} ({COL_MULTS[currentCol - 1]}×)
              </div>
              <ActionButton onClick={cashOut} color={COLOR} variant="secondary" disabled={cashedOut}>
                🏃 Cash Out Now
              </ActionButton>
            </div>
          )}

          {phase === 'idle' || phase === 'done' ? (
            <ActionButton onClick={startGame} color={COLOR} disabled={bet > balance || bet < 1}>
              ⚽ {phase === 'done' ? 'Play Again' : 'Start Game'}
            </ActionButton>
          ) : null}

          {message && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: message.win ? '#D1FAE5' : '#FEE2E2',
              color: message.win ? '#065F46' : '#991B1B',
              fontWeight: 600, fontSize: 14, animation: 'winPop 0.4s ease',
            }}>
              {message.win ? '🎉' : '💔'} {message.text}
            </div>
          )}

          {/* Multiplier ladder */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, fontWeight: 600 }}>Multiplier Ladder</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {COL_MULTS.slice().reverse().map((m, i) => {
                const col = COLS - 1 - i
                const active = phasePlaying && col === currentCol
                const done = picks.some(p => p.col === col)
                return (
                  <div key={col} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 8,
                    background: active ? COLOR + '20' : done ? '#F0FDF4' : 'var(--bg2)',
                    border: `1.5px solid ${active ? COLOR : done ? '#6EE7B7' : 'var(--border)'}`,
                    fontSize: 13, fontWeight: 600, color: active ? COLOR : done ? '#065F46' : 'var(--text3)',
                    transition: 'all 0.2s',
                  }}>
                    <span>{active ? '▶' : done ? '✓' : ' '}</span>
                    <span>Column {col + 1}</span>
                    <span style={{ marginLeft: 'auto' }}>{m}×</span>
                  </div>
                )
              })}
            </div>
          </div>
        </Panel>
      }
    >
      <Panel>
        {/* Pitch */}
        <div style={{
          background: 'linear-gradient(180deg, #064E3B, #065F46)',
          borderRadius: 16, padding: 24, position: 'relative', overflow: 'hidden',
        }}>
          {/* Grass lines */}
          {[0,1,2,3,4].map(i => (
            <div key={i} style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${(i / COLS) * 100}%`,
              width: `${100 / COLS}%`,
              background: i % 2 === 0 ? '#065F4620' : 'transparent',
            }} />
          ))}

          {/* Column headers */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, position: 'relative', zIndex: 1 }}>
            {COL_MULTS.map((m, c) => (
              <div key={c} style={{
                flex: 1, textAlign: 'center',
                fontSize: 12, fontWeight: 700,
                color: phasePlaying && c === currentCol ? '#FCD34D' : '#ffffff66',
                transition: 'color 0.2s',
              }}>{m}×</div>
            ))}
          </div>

          {/* Grid */}
          <div style={{ display: 'flex', gap: 10, position: 'relative', zIndex: 1 }}>
            {Array.from({ length: COLS }).map((_, col) => (
              <div key={col} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Array.from({ length: ROWS }).map((_, row) => {
                  const { isKeeper, isGoal, isMiss, isRevealed } = getCellState(col, row)
                  const isActive = phasePlaying && col === currentCol
                  const isPast = col < currentCol || phase === 'done'

                  return (
                    <button
                      key={row}
                      onClick={() => pickCell(col, row)}
                      style={{
                        height: 70, borderRadius: 12, fontSize: 28,
                        border: `2px solid ${isActive ? '#FCD34D88' : 'transparent'}`,
                        background: isKeeper ? '#EF444433' : isGoal ? '#10B98133' : '#ffffff15',
                        cursor: isActive ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.2s',
                        transform: isActive ? 'scale(1)' : 'scale(0.97)',
                        animation: isRevealed ? 'popIn 0.35s ease' : 'none',
                        boxShadow: isActive ? '0 0 12px #FCD34D44' : 'none',
                      }}
                      onMouseEnter={e => isActive && (e.currentTarget.style.background = '#ffffff30')}
                      onMouseLeave={e => isActive && (e.currentTarget.style.background = isKeeper ? '#EF444433' : isGoal ? '#10B98133' : '#ffffff15')}
                    >
                      {isKeeper ? '🧤' : isGoal ? '⚽' : isActive ? '❓' : isPast ? '✓' : '⬜'}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Status */}
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          {phase === 'idle' && <p style={{ color: 'var(--text3)', fontSize: 14 }}>Place your bet and kick off!</p>}
          {phasePlaying && (
            <p style={{ color: COLOR, fontWeight: 600, fontSize: 14 }}>
              ⚽ Pick a cell in column {currentCol + 1} — avoid the goalkeeper!
            </p>
          )}
        </div>
      </Panel>
    </GameLayout>
  )
}
