import { useState } from 'react'
import { COLORS, RADIUS, SPACE } from './tokens'
import ChipQuickBet from './ChipQuickBet'
import BetButton from './BetButton'

// One Spribe-style bet bay: Bet/Auto tabs on top, amount input with ½/2×,
// chip quick-bets, and the three-state BetButton. Purely presentational —
// the host wires its own state in via props. The Auto tab exposes auto-bet
// and auto-cashout controls through the `auto` prop:
//   { betOn, cashOn, cashMult, onToggleBet, onToggleCash, onCashMult }

const roundBtnStyle = disabled => ({
  width: 26, height: 26, flex: '0 0 auto',
  borderRadius: RADIUS.pill,
  background: COLORS.surface, color: COLORS.textMuted,
  border: `1px solid ${COLORS.borderLight}`,
  fontSize: 15, fontWeight: 800, lineHeight: 1,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
})

// showAuto=false hides the Bet/Auto tab row entirely (one-shot / multi-step
// games where auto-bet has no meaning); `auto` is then not required.
// (hosts may still pass `max`; presets are fixed since the Spribe-parity pass)
// bare=true drops the card chrome (border/radius/own background) so the panel
// melts into a host-provided full-width strip.
export default function BetPanel({ bet, setBet, inputDisabled, chipDisabled, button, hint, auto, showAuto = true, bare = false }) {
  const [tab, setTab] = useState('bet')
  const activeTab = showAuto ? tab : 'bet'

  return (
    <div style={{
      background: bare ? 'transparent' : COLORS.panel,
      border: bare ? 'none' : `1.5px solid ${COLORS.borderLight}`,
      borderRadius: bare ? 0 : RADIUS.panel,
      padding: SPACE.md,
      boxSizing: 'border-box',
      minWidth: 0,
    }}>
      {/* Bet / Auto tabs */}
      {showAuto && (
        <div style={{
          display: 'flex', gap: SPACE.xs, width: 'fit-content', margin: `0 auto ${SPACE.sm}px`,
          background: COLORS.bg, border: `1px solid ${COLORS.borderLight}`,
          borderRadius: RADIUS.pill, padding: 2,
        }}>
          {[['bet', 'Bet'], ['auto', 'Auto']].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} style={{
              padding: `3px ${SPACE.lg + 4}px`,
              borderRadius: RADIUS.pill,
              border: 'none',
              fontSize: 12, fontWeight: 800,
              background: tab === key ? COLORS.surface : 'transparent',
              color: tab === key ? COLORS.text : COLORS.textFaint,
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
            }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Spribe-style split: controls left, big action button right */}
      <div style={{ display: 'flex', gap: SPACE.sm + 2, alignItems: 'stretch' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
          {activeTab === 'bet' ? (
            <>
              {/* amount row: − | value | + (step 10) */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: COLORS.bg, border: `1.5px solid ${COLORS.borderLight}`,
                borderRadius: RADIUS.input, padding: '4px 6px',
              }}>
                <button type="button" disabled={inputDisabled} style={roundBtnStyle(inputDisabled)}
                  onClick={() => setBet(b => Math.max(1, b - 10))}>−</button>
                <input
                  type="number" min="1" value={bet}
                  onChange={e => setBet(Math.max(1, Number(e.target.value)))}
                  disabled={inputDisabled}
                  style={{
                    flex: 1, minWidth: 0, textAlign: 'center',
                    background: 'transparent', border: 'none',
                    color: COLORS.text, fontSize: 15, fontWeight: 800,
                  }}
                />
                <button type="button" disabled={inputDisabled} style={roundBtnStyle(inputDisabled)}
                  onClick={() => setBet(b => b + 10)}>+</button>
              </div>
              <ChipQuickBet value={bet} onSelect={setBet} disabled={chipDisabled} />
            </>
          ) : (
            <AutoControls auto={auto} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <BetButton
            state={button.state}
            label={button.label}
            sub={button.sub}
            onClick={button.onClick}
            disabled={button.disabled}
            stretch
          />
        </div>
      </div>

      {hint && (
        <div style={{ marginTop: 6, color: COLORS.textMuted, fontSize: 11, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
