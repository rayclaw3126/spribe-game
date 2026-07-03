import { useState } from 'react'
import { COLORS, RADIUS, SPACE } from './tokens'
import ChipQuickBet from './ChipQuickBet'
import BetButton from './BetButton'

// One Spribe-style bet bay: Bet/Auto tabs on top, amount input with ½/2×,
// chip quick-bets, and the three-state BetButton. Purely presentational —
// the host wires its own state in via props. The Auto tab exposes auto-bet
// and auto-cashout controls through the `auto` prop:
//   { betOn, cashOn, cashMult, onToggleBet, onToggleCash, onCashMult }

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

export default function BetPanel({ bet, setBet, max, inputDisabled, chipDisabled, button, hint, auto }) {
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
        <AutoControls auto={auto} />
      )}

      <div style={{ marginTop: SPACE.md }}>
        <BetButton
          state={button.state}
          label={button.label}
          onClick={button.onClick}
          disabled={button.disabled}
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

function Toggle({ on, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      width: 36, height: 20, borderRadius: RADIUS.pill, padding: 0,
      background: on ? COLORS.greenTint : COLORS.surface,
      border: `1.5px solid ${on ? COLORS.green : COLORS.borderLight}`,
      position: 'relative', display: 'inline-block', cursor: 'pointer',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 19 : 2, width: 13, height: 13,
        borderRadius: RADIUS.pill,
        background: on ? COLORS.green : COLORS.textFaint,
        transition: 'left 0.15s ease',
      }} />
    </button>
  )
}

// Auto-bet + auto-cashout controls. The multiplier input is committed on
// blur/Enter: min 1.01, anything invalid falls back to 2.00.
function AutoControls({ auto }) {
  const [multText, setMultText] = useState(auto.cashMult.toFixed(2))
  const [seenMult, setSeenMult] = useState(auto.cashMult)
  if (auto.cashMult !== seenMult) {
    // parent-driven change — resync the draft text (render-phase adjustment)
    setSeenMult(auto.cashMult)
    setMultText(auto.cashMult.toFixed(2))
  }

  function commitMult() {
    let v = parseFloat(multText)
    if (Number.isNaN(v) || v < 1.01) v = 2.0
    v = Number(v.toFixed(2))
    auto.onCashMult(v)
    setMultText(v.toFixed(2))
  }

  const row = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `${SPACE.sm + 2}px ${SPACE.md}px`,
    background: COLORS.bg, border: `1.5px solid ${COLORS.border}`,
    borderRadius: RADIUS.input, marginBottom: SPACE.sm,
  }
  const label = { color: COLORS.textMuted, fontSize: 13, fontWeight: 700 }
  return (
    <div>
      <div style={row}>
        <span style={label}>自动下注</span>
        <Toggle on={auto.betOn} onClick={auto.onToggleBet} />
      </div>
      <div style={row}>
        <span style={label}>自动兑现</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          <Toggle on={auto.cashOn} onClick={auto.onToggleCash} />
          <input
            value={multText}
            onChange={e => setMultText(e.target.value)}
            onBlur={commitMult}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
            inputMode="decimal"
            style={{
              width: 64, padding: '4px 8px', textAlign: 'right',
              borderRadius: RADIUS.input - 4, border: `1.5px solid ${COLORS.borderLight}`,
              background: COLORS.surface, color: COLORS.text,
              fontSize: 13, fontWeight: 700,
            }}
          />
          <span style={label}>×</span>
        </span>
      </div>
    </div>
  )
}
