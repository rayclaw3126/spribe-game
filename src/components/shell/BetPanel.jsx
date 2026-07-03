import { useState } from 'react'
import { COLORS, RADIUS, SPACE } from './tokens'
import ChipQuickBet from './ChipQuickBet'
import BetButton from './BetButton'

// One Spribe-style bet bay: Bet/Auto tabs on top, amount input with ½/2×,
// chip quick-bets, and the three-state BetButton. Purely presentational —
// the host wires its own state in via props. The Auto tab is a disabled
// skeleton (auto-bet toggle + auto-cashout multiplier) for a later shell run.

const inputStyle = {
  flex: 1, minWidth: 0, padding: '10px 14px', borderRadius: RADIUS.input,
  minHeight: 40, boxSizing: 'border-box',
  border: `1.5px solid ${COLORS.borderLight}`,
  background: COLORS.bg, color: COLORS.text,
  fontSize: 15, fontWeight: 600,
}
const stepBtnStyle = {
  padding: '10px 12px', borderRadius: RADIUS.input, fontSize: 13, fontWeight: 700,
  background: COLORS.surface, color: COLORS.textMuted,
  border: `1.5px solid ${COLORS.borderLight}`,
}

export default function BetPanel({ bet, setBet, max, inputDisabled, chipDisabled, button, hint }) {
  const [tab, setTab] = useState('bet')

  return (
    <div style={{
      background: COLORS.panel,
      border: `1.5px solid ${COLORS.borderLight}`,
      borderRadius: RADIUS.panel,
      padding: SPACE.lg + 2,
      boxSizing: 'border-box',
      minWidth: 0,
    }}>
      {/* Bet / Auto tabs */}
      <div style={{
        display: 'flex', gap: SPACE.xs, width: 'fit-content', margin: `0 auto ${SPACE.lg}px`,
        background: COLORS.bg, border: `1px solid ${COLORS.borderLight}`,
        borderRadius: RADIUS.pill, padding: 3,
      }}>
        {[['bet', 'Bet'], ['auto', 'Auto']].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} style={{
            padding: `5px ${SPACE.lg + 6}px`,
            borderRadius: RADIUS.pill,
            border: 'none',
            fontSize: 13, fontWeight: 800,
            background: tab === key ? COLORS.surface : 'transparent',
            color: tab === key ? COLORS.text : COLORS.textFaint,
            cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s',
          }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'bet' ? (
        <>
          <div style={{ display: 'flex', gap: SPACE.sm, marginBottom: SPACE.sm }}>
            <input
              type="number" min="1" value={bet}
              onChange={e => setBet(Math.max(1, Number(e.target.value)))}
              disabled={inputDisabled}
              style={inputStyle}
            />
            <button onClick={() => setBet(b => Math.max(1, Math.floor(b / 2)))} disabled={inputDisabled} style={stepBtnStyle}>½</button>
            <button onClick={() => setBet(b => Math.max(1, b * 2))} disabled={inputDisabled} style={stepBtnStyle}>2×</button>
          </div>
          <ChipQuickBet value={bet} max={max} onSelect={setBet} disabled={chipDisabled} />
        </>
      ) : (
        <AutoSkeleton />
      )}

      <div style={{ marginTop: SPACE.md }}>
        <BetButton
          state={button.state}
          label={button.label}
          onClick={button.onClick}
          disabled={button.disabled || tab === 'auto'}
        />
      </div>
      {hint && (
        <div style={{ marginTop: SPACE.md, color: COLORS.textMuted, fontSize: 13, lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

// Disabled skeleton for the future auto-bet shell run.
function AutoSkeleton() {
  const row = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `${SPACE.sm + 2}px ${SPACE.md}px`,
    background: COLORS.bg, border: `1.5px solid ${COLORS.border}`,
    borderRadius: RADIUS.input, marginBottom: SPACE.sm,
    opacity: 0.5, cursor: 'not-allowed',
  }
  const label = { color: COLORS.textFaint, fontSize: 13, fontWeight: 700 }
  return (
    <div title="即将开通">
      <div style={row}>
        <span style={label}>自动下注</span>
        {/* inert toggle */}
        <span style={{
          width: 36, height: 20, borderRadius: RADIUS.pill,
          background: COLORS.surface, border: `1.5px solid ${COLORS.borderLight}`,
          position: 'relative', display: 'inline-block',
        }}>
          <span style={{
            position: 'absolute', top: 2, left: 2, width: 13, height: 13,
            borderRadius: RADIUS.pill, background: COLORS.textFaint,
          }} />
        </span>
      </div>
      <div style={row}>
        <span style={label}>自动兑现</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs }}>
          <input disabled value="2.00" readOnly style={{
            width: 64, padding: '4px 8px', textAlign: 'right',
            borderRadius: RADIUS.input - 4, border: `1.5px solid ${COLORS.borderLight}`,
            background: COLORS.surface, color: COLORS.textFaint,
            fontSize: 13, fontWeight: 700,
          }} />
          <span style={label}>×</span>
        </span>
      </div>
    </div>
  )
}
