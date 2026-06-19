import { useState, useMemo } from 'react'
import GameLayout, { Panel, BetInput, ActionButton } from '../components/GameLayout'

const COLOR = '#7C3AED'
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

  const gems = revealed.length
  const currentMult = calcMultiplier(gems, mineCount)
  const nextMult = calcMultiplier(gems + 1, mineCount)

  function startGame() {
    if (bet > balance) return
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
      setMessage({ text: `💥 Mine! You lost $${bet.toFixed(2)}`, win: false })
      setPhase('done')
      // Reveal all mines
      setRevealed([...revealed, idx])
    } else {
      const newRevealed = [...revealed, idx]
      setRevealed(newRevealed)
      const newGems = newRevealed.length
      const safe = GRID - mineCount
      if (newGems >= safe) {
        // All gems found!
        const payout = parseFloat((bet * calcMultiplier(newGems, mineCount)).toFixed(2))
        setBalance(b => parseFloat((b + payout).toFixed(2)))
        setMessage({ text: `All gems found! ${calcMultiplier(newGems, mineCount)}× — $${payout.toFixed(2)}! 🏆`, win: true })
        setPhase('done')
      } else {
        setMessage({ text: `💎 Gem! +${calcMultiplier(newGems, mineCount)}× so far`, win: true })
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
    // Reveal all mines
    setRevealed(prev => {
      const mines = [...mineSet]
      return [...new Set([...prev, ...mines])]
    })
  }

  function getCellEmoji(idx) {
    const isMine = mineSet?.has(idx)
    const isRev = revealed.includes(idx)
    if (!isRev) return null  // hidden
    if (isMine) return idx === exploded ? '💥' : '💣'
    return '💎'
  }

  return (
    <GameLayout title="Mines" emoji="💣" color={COLOR}
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
              Mine Count: {mineCount} 💣
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
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Gems Found</div>
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
                background: '#D1FAE533', border: '1.5px solid #6EE7B7', color: '#059669', marginBottom: 10,
              }}>
                💰 ${(bet * currentMult).toFixed(2)} ({currentMult}×)
              </div>
              <ActionButton onClick={cashOut} color='#059669' variant="secondary">
                💸 Cash Out
              </ActionButton>
            </div>
          )}

          {phase !== 'playing' && (
            <ActionButton onClick={startGame} color={COLOR} disabled={bet > balance || bet < 1}>
              💣 {phase === 'done' ? 'Play Again' : 'Start Game'}
            </ActionButton>
          )}

          {message && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: message.win ? '#D1FAE5' : '#FEE2E2',
              color: message.win ? '#065F46' : '#991B1B',
              fontWeight: 600, fontSize: 13, animation: 'winPop 0.4s ease',
            }}>
              {message.text}
            </div>
          )}
        </Panel>
      }
    >
      <Panel>
        {/* Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 10,
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
                  border: `2px solid ${isExploded ? '#EF4444' : isGem ? '#6EE7B7' : isMine ? '#FECACA' : phase === 'playing' && !isRev ? COLOR + '44' : 'var(--border)'}`,
                  background: isExploded ? '#FEE2E2' : isGem ? '#D1FAE5' : isMine ? '#FEE2E288' : phase === 'playing' && !isRev ? 'var(--bg2)' : 'var(--surface2)',
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
                {emoji || (phase === 'playing' ? '?' : '⬜')}
              </button>
            )
          })}
        </div>

        {phase === 'idle' && (
          <p style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 14, marginTop: 20 }}>
            Configure mines, place your bet, and start finding gems!
          </p>
        )}
      </Panel>
    </GameLayout>
  )
}
