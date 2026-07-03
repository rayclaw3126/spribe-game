import { useState } from 'react'
import GameLayout, { Panel, BetInput, ActionButton } from '../components/GameLayout'

const COLOR = '#16C784'
const ROWS = 8
const DIFFS = { easy: { cols: 4, traps: 1 }, medium: { cols: 3, traps: 1 }, hard: { cols: 2, traps: 1 } }
const factorOf = d => 0.99 * DIFFS[d].cols / (DIFFS[d].cols - DIFFS[d].traps)

function generateTraps(cols, traps) {
  return Array.from({ length: ROWS }, () => {
    const s = new Set()
    while (s.size < traps) s.add(Math.floor(Math.random() * cols))
    return s
  })
}

export default function Tower({ balance, setBalance }) {
  const [bet, setBet] = useState(10)
  const [diff, setDiff] = useState('medium')
  const [phase, setPhase] = useState('idle')
  const [traps, setTraps] = useState(null)
  const [currentRow, setCurrentRow] = useState(0)
  const [picks, setPicks] = useState([])
  const [reveal, setReveal] = useState(false)
  const [message, setMessage] = useState(null)
  const [cashedOut, setCashedOut] = useState(false)

  const cfg = DIFFS[diff]
  const factor = factorOf(diff)
  const currentMult = parseFloat((factor ** currentRow).toFixed(2))
  const playing = phase === 'playing'

  function startGame() {
    if (bet > balance) return
    setBalance(b => parseFloat((b - bet).toFixed(2)))
    setTraps(generateTraps(cfg.cols, cfg.traps))
    setCurrentRow(0); setPicks([]); setReveal(false); setMessage(null); setCashedOut(false)
    setPhase('playing')
  }

  function pickCell(row, col) {
    if (phase !== 'playing' || row !== currentRow) return
    const hit = traps[row].has(col)
    setPicks(p => [...p, { row, col, hit }])
    if (hit) {
      setReveal(true)
      setMessage({ text: `Tackled on row ${row + 1}! Lost $${bet.toFixed(2)}`, win: false })
      setPhase('done')
    } else {
      const nextRow = row + 1
      if (nextRow >= ROWS) {
        const payout = parseFloat((bet * factor ** ROWS).toFixed(2))
        setBalance(b => parseFloat((b + payout).toFixed(2)))
        setReveal(true)
        setMessage({ text: `TOP! Won $${payout.toFixed(2)}! 🏆`, win: true })
        setPhase('done')
      } else setCurrentRow(nextRow)
    }
  }

  function cashOut() {
    if (phase !== 'playing' || currentRow === 0 || cashedOut) return
    const payout = parseFloat((bet * currentMult).toFixed(2))
    setBalance(b => parseFloat((b + payout).toFixed(2)))
    setCashedOut(true); setReveal(true)
    setMessage({ text: `Cashed out ${currentMult}× — Won $${payout.toFixed(2)}!`, win: true })
    setPhase('done')
  }

  return (
    <GameLayout title="Striker Tower" emoji="🏆" color={COLOR}
      sidebar={
        <Panel>
          <BetInput bet={bet} setBet={setBet}
            onHalf={() => setBet(b => Math.max(1, Math.floor(b / 2)))}
            onDouble={() => setBet(b => b * 2)}
            disabled={playing}
          />
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 8 }}>Difficulty</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.keys(DIFFS).map(d => (
                <button key={d} onClick={() => !playing && setDiff(d)} disabled={playing} style={{
                  flex: 1, padding: '9px', borderRadius: 10, fontSize: 12, fontWeight: 700, textTransform: 'capitalize',
                  border: `2px solid ${diff === d ? COLOR : 'var(--border)'}`,
                  background: diff === d ? COLOR + '20' : 'var(--surface)',
                  color: diff === d ? COLOR : 'var(--text2)',
                  cursor: playing ? 'not-allowed' : 'pointer' }}>{d}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
              {cfg.cols} lanes · {cfg.traps} defender · {factor.toFixed(2)}×/row
            </div>
          </div>
          {playing && currentRow > 0 && !cashedOut && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Cash out now for:</div>
              <div style={{ padding: '10px 14px', borderRadius: 10, fontWeight: 700, fontSize: 16, marginBottom: 10,
                background: 'rgba(16,185,129,0.12)', border: '1.5px solid rgba(16,185,129,0.4)', color: '#6EE7B7' }}>
                💰 ${(bet * currentMult).toFixed(2)} ({currentMult}×)
              </div>
              <ActionButton onClick={cashOut} color={COLOR} variant="secondary">🏃 Cash Out Now</ActionButton>
            </div>
          )}
          {(phase === 'idle' || phase === 'done') && (
            <ActionButton onClick={startGame} color={COLOR} disabled={bet > balance || bet < 1}>
              🏆 {phase === 'done' ? 'Play Again' : 'Start Climb'}
            </ActionButton>
          )}
          {message && (
            <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: message.win ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              color: message.win ? '#6EE7B7' : '#FCA5A5',
              fontWeight: 600, fontSize: 14, animation: 'winPop 0.4s ease' }}>
              {message.win ? '🎉' : '💔'} {message.text}
            </div>
          )}
        </Panel>
      }
    >
      <Panel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420, margin: '0 auto' }}>
          {Array.from({ length: ROWS }).map((_, r) => {
            const row = ROWS - 1 - r
            const isCurrent = playing && row === currentRow
            const isPast = row < currentRow || (phase === 'done' && picks.some(p => p.row === row))
            const rowMult = parseFloat((factor ** (row + 1)).toFixed(2))
            return (
              <div key={row} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 52, fontSize: 12, fontWeight: 700, textAlign: 'right',
                  color: isCurrent ? COLOR : isPast ? '#6EE7B7' : 'var(--text3)' }}>{rowMult}×</div>
                <div style={{ flex: 1, display: 'flex', gap: 8 }}>
                  {Array.from({ length: cfg.cols }).map((_, col) => {
                    const pick = picks.find(p => p.row === row && p.col === col)
                    const isTrap = traps && traps[row] && traps[row].has(col)
                    const showTrap = reveal && isTrap
                    const isSafePick = pick && !pick.hit
                    const isHitPick = pick && pick.hit
                    let content = '', bg = 'var(--bg2)', bd = 'var(--border)'
                    if (isCurrent) { content = '❓'; bd = COLOR }
                    else if (isSafePick) { content = '⚽'; bg = 'rgba(16,185,129,0.2)'; bd = 'rgba(16,185,129,0.5)' }
                    else if (isHitPick) { content = '🛡️'; bg = 'rgba(239,68,68,0.25)'; bd = 'rgba(239,68,68,0.5)' }
                    else if (showTrap) { content = '🛡️'; bg = 'rgba(239,68,68,0.12)' }
                    else if (isPast) { content = '·' }
                    else { content = '🔒' }
                    return (
                      <button key={col} onClick={() => pickCell(row, col)} style={{
                        flex: 1, height: 42, borderRadius: 10, fontSize: 20,
                        border: `2px solid ${bd}`, background: bg,
                        cursor: isCurrent ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: !isCurrent && !isPast && !showTrap && !pick ? 0.45 : 1,
                        transition: 'all 0.15s', boxShadow: isCurrent ? `0 0 10px ${COLOR}33` : 'none' }}
                        onMouseEnter={e => isCurrent && (e.currentTarget.style.background = COLOR + '22')}
                        onMouseLeave={e => isCurrent && (e.currentTarget.style.background = 'var(--bg2)')}>
                        {content}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          {phase === 'idle' && <p style={{ color: 'var(--text3)', fontSize: 14 }}>Pick difficulty and start climbing!</p>}
          {playing && <p style={{ color: COLOR, fontWeight: 600, fontSize: 14 }}>⚽ Pick a lane on row {currentRow + 1} — avoid the defender!</p>}
        </div>
      </Panel>
    </GameLayout>
  )
}
