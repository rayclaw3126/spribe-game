import { useState } from 'react'
import { COLORS, RADIUS, SPACE } from './tokens'
import chip10 from '../../assets/shared/chips_10_sm.png'
import chip50 from '../../assets/shared/chips_50_sm.png'
import chip100 from '../../assets/shared/chips_100_sm.png'

// Quick-bet chip row: 10 / 50 / 100 / MAX. Press = scale 0.95 with a 90ms
// rebound; the option matching the current bet gets a green outline.

const CHIPS = [
  { amount: 10, img: chip10 },
  { amount: 50, img: chip50 },
  { amount: 100, img: chip100 },
  { amount: 'MAX', img: null },
]

export default function ChipQuickBet({ value, max, onSelect, disabled }) {
  const [pressed, setPressed] = useState(null)

  function resolve(amount) {
    return amount === 'MAX' ? Math.max(1, Math.floor(max)) : amount
  }

  return (
    <div style={{ display: 'flex', gap: SPACE.sm, marginTop: SPACE.sm }}>
      {CHIPS.map(({ amount, img }) => {
        const selected = value === resolve(amount)
        const isPressed = pressed === amount
        return (
          <button
            key={amount}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(resolve(amount))}
            onPointerDown={() => setPressed(amount)}
            onPointerUp={() => setPressed(null)}
            onPointerLeave={() => setPressed(null)}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 2,
              padding: `${SPACE.xs + 2}px 0`,
              borderRadius: RADIUS.chip,
              background: selected ? COLORS.greenTint : COLORS.surface,
              border: `1.5px solid ${selected ? COLORS.green : COLORS.borderLight}`,
              color: selected ? COLORS.green : COLORS.textMuted,
              fontSize: 12,
              fontWeight: 800,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              transform: isPressed ? 'scale(0.95)' : 'scale(1)',
              transition: 'transform 90ms ease-out, border-color 0.15s, background 0.15s',
            }}
          >
            {img
              ? <img src={img} alt="" style={{ width: 26, height: 26, display: 'block' }} />
              : <span style={{ fontSize: 15, lineHeight: '26px', color: selected ? COLORS.green : COLORS.text }}>MAX</span>}
            {img && <span>${amount}</span>}
          </button>
        )
      })}
    </div>
  )
}
