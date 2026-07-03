import { useState } from 'react'
import GameLayout, { Panel, BetInput, ActionButton } from '../components/GameLayout'

const COLOR = '#16C784'
const HOUSE_EDGE = 0.99
const MAX_MULT = 1000000

export default function Limbo({ balance, setBalance }) {
  const [bet, setBet] = useState(10)
  const [target, setTarget] = useState(2.0)
  const [rolling, setRolling] = useState(false)
  const [result, setResult] = useState(null)
  const [animMult, setAnimMult] = useState(null)

  const t = Math.max(1.01, target || 1.01)
  const winChance = Math.min(99, (HOUSE_EDGE / t) * 100)
  const payout = parseFloat((bet * t).toFixed(2))

  function play() {
    if (bet > balance || rolling) return
    setBalance(b => parseFloat((b - bet).toFixed(2)))
    setResult(null)
    setRolling(true)
    const r = Math.random()
    const finalMult = Math.min(MAX_MULT, Math.max(1, parseFloat((HOUSE_EDGE / r).toFixed(2))))
    let ticks = 0
    const id = setInterval(() => {
      setAnimMult(parseFloat((1 + Math.random() * Math.min(finalMult * 1.3, 20)).toFixed(2)))
      ticks++
      if (ticks >= 16) {
        clearInterval(id)
        setAnimMult(finalMult)
        const win = finalMult >= t
        const profit = win ? parseFloat((bet * t).toFixed(2)) : 0
        if (win) setBalance(b => parseFloat((b + profit).toFixed(2)))
        setResult({ mult: finalMult, win, profit })
        setRolling(false)
      }
    }, 55)
  }

  const displayMult = animMult !== null ? animMult : 1.00
  const isWin = result?.win

  return (
    <GameLayout title="Odds Climb" emoji="📈" color={COLOR}
      sidebar={
        <Panel>
          <BetInput bet={bet} setBet={setBet}
            onHalf={() => setBet(b => Math.max(1, Math.floor(b / 2)))}
            onDouble={() => setBet(b => b * 2)}
            disabled={rolling}
          />
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 8 }}>
              Target Odds
            </label>
            <input type="number" min="1.01" step="0.01" value={target}
              onChange={e => setTarget(Math.max(1.01, Number(e.target.value)))}
              disabled={rolling}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10,
                border: '1.5px solid var(--border)', fontSize: 15, fontWeight: 600,
                background: 'var(--surface2)', color: 'var(--text)' }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[1.5, 2, 5, 10].map(v => (
                <button key={v} onClick={() => setTarget(v)} disabled={rolling} style={{
                  flex: 1, padding: '6px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  background: 'var(--bg2)', color: 'var(--text2)', border: '1.5px solid var(--border)' }}>{v}×</button>
              ))}
            </div>
          </div>
          <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: '12px 14px',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <StatBox label="Win Chance" value={`${winChance.toFixed(1)}%`} color={COLOR} />
            <StatBox label="Multiplier" value={`${t.toFixed(2)}×`} color='#10B981' />
            <StatBox label="Payout" value={`$${payout.toFixed(2)}`} color='#F59E0B' />
            <StatBox label="Profit" value={`$${(payout - bet).toFixed(2)}`} color={COLOR} />
          </div>
          <ActionButton onClick={play} color={COLOR} disabled={rolling || bet > balance || bet < 1}>
            {rolling ? '📈 Climbing...' : '⚽ Kick Off'}
          </ActionButton>
          {result && (
            <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: result.win ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              color: result.win ? '#6EE7B7' : '#FCA5A5',
              fontWeight: 600, fontSize: 14, animation: 'winPop 0.4s ease' }}>
              {result.win ? '🎉' : '💔'} Final {result.mult.toFixed(2)}× — {result.win ? `Won $${result.profit.toFixed(2)}!` : 'Below target'}
            </div>
          )}
        </Panel>
      }
    >
      <Panel style={{ minHeight: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1,
          fontFamily: "'Space Grotesk', sans-serif",
          color: result ? (isWin ? '#10B981' : '#EF4444') : COLOR,
          animation: rolling ? 'pulse 0.3s ease-in-out infinite' : result ? 'winPop 0.4s ease' : 'float 3s ease-in-out infinite',
          marginBottom: 12 }}>
          {displayMult.toFixed(2)}×
        </div>
        <p style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center' }}>
          {rolling ? 'Odds climbing...' : result
            ? (isWin ? `Reached ${result.mult.toFixed(2)}× — above your ${t.toFixed(2)}× target!` : `Stopped at ${result.mult.toFixed(2)}× — needed ${t.toFixed(2)}×`)
            : 'Set target odds, kick off — win if final ≥ your target'}
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
