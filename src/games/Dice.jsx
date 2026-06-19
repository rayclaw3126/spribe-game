import { useState } from 'react'
import GameLayout, { Panel, BetInput, ActionButton } from '../components/GameLayout'

const COLOR = '#2563EB'

const FACES = ['⚀','⚁','⚂','⚃','⚄','⚅']

export default function Dice({ balance, setBalance }) {
  const [bet, setBet] = useState(10)
  const [target, setTarget] = useState(4)   // roll OVER this
  const [mode, setMode] = useState('over')  // over | under
  const [rolling, setRolling] = useState(false)
  const [result, setResult] = useState(null)
  const [animFace, setAnimFace] = useState(null)

  const winChance = mode === 'over'
    ? (6 - target) / 6
    : target / 6
  const multiplier = parseFloat((0.97 / winChance).toFixed(2))

  function roll() {
    if (bet > balance || rolling) return
    setBalance(b => b - bet)
    setResult(null)
    setRolling(true)

    let ticks = 0
    const max = 14
    const id = setInterval(() => {
      setAnimFace(Math.floor(Math.random() * 6))
      ticks++
      if (ticks >= max) {
        clearInterval(id)
        const roll = Math.floor(Math.random() * 6) + 1
        setAnimFace(roll - 1)
        const win = mode === 'over' ? roll > target : roll <= target
        const profit = win ? parseFloat((bet * multiplier).toFixed(2)) : 0
        if (win) setBalance(b => parseFloat((b + profit).toFixed(2)))
        setResult({ roll, win, profit })
        setRolling(false)
      }
    }, 60)
  }

  return (
    <GameLayout title="Dice" emoji="🎲" color={COLOR}
      sidebar={
        <Panel>
          <BetInput bet={bet} setBet={setBet}
            onHalf={() => setBet(b => Math.max(1, Math.floor(b / 2)))}
            onDouble={() => setBet(b => b * 2)}
            disabled={rolling}
          />

          {/* Mode toggle */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 8 }}>
              Bet Type
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['over','under'].map(m => (
                <button key={m} onClick={() => setMode(m)} style={{
                  flex: 1, padding: '9px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                  border: `2px solid ${mode === m ? COLOR : 'var(--border)'}`,
                  background: mode === m ? COLOR + '15' : 'var(--surface)',
                  color: mode === m ? COLOR : 'var(--text2)',
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
              {mode === 'over' ? `Roll Over: ${target}` : `Roll Under or Equal: ${target}`}
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
            <StatBox label="Profit" value={`$${(bet * multiplier - bet).toFixed(2)}`} color='#7C3AED' />
          </div>

          <ActionButton onClick={roll} color={COLOR} disabled={rolling || bet > balance || bet < 1}>
            {rolling ? '🎲 Rolling...' : '🎲 Roll Dice'}
          </ActionButton>

          {result && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: result.win ? '#D1FAE5' : '#FEE2E2',
              color: result.win ? '#065F46' : '#991B1B',
              fontWeight: 600, fontSize: 14,
              animation: 'winPop 0.4s ease',
            }}>
              {result.win ? '🎉' : '💔'} Rolled {result.roll} — {result.win ? `Won $${result.profit.toFixed(2)}!` : 'Better luck next time!'}
            </div>
          )}
        </Panel>
      }
    >
      <Panel style={{ minHeight: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {/* Big die display */}
        <div style={{
          fontSize: 120,
          lineHeight: 1,
          animation: rolling ? 'spin 0.3s linear infinite' : result ? 'winPop 0.4s ease' : 'float 3s ease-in-out infinite',
          filter: result?.win ? 'drop-shadow(0 0 20px #10B98188)' : rolling ? 'none' : 'drop-shadow(0 4px 12px rgba(37,99,235,0.2))',
          marginBottom: 24,
        }}>
          {animFace !== null ? FACES[animFace] : '🎲'}
        </div>

        {/* Dice faces row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {[1,2,3,4,5,6].map(n => {
            const isTarget = mode === 'over' ? n > target : n <= target
            return (
              <div key={n} style={{
                width: 44, height: 44, borderRadius: 10, fontSize: 26,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isTarget ? COLOR + '20' : 'var(--bg2)',
                border: `2px solid ${isTarget ? COLOR : 'var(--border)'}`,
                color: isTarget ? COLOR : 'var(--text3)',
                transition: 'all 0.2s',
              }}>
                {FACES[n - 1]}
              </div>
            )
          })}
        </div>

        <p style={{ color: 'var(--text3)', fontSize: 14 }}>
          {mode === 'over'
            ? `Win when rolling OVER ${target} (${[...Array(6)].map((_,i) => i+1).filter(n => n > target).join(', ')})`
            : `Win when rolling ${target} OR UNDER (${[...Array(6)].map((_,i) => i+1).filter(n => n <= target).join(', ')})`
          }
        </p>
      </Panel>
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
