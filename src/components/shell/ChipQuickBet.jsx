import { useState } from 'react'
import { COLORS, RADIUS } from './tokens'

// Spribe-style preset amounts: a 2×2 grid of small text pills. Press =
// scale 0.95 with a 90ms rebound; the pill matching the current bet gets
// a green outline.

const PRESETS = [10, 50, 100, 500]

export default function ChipQuickBet({ value, onSelect, disabled }) {
  const [pressed, setPressed] = useState(null)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
      {PRESETS.map(v => {
        const selected = value === v
        const isPressed = pressed === v
        return (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(v)}
            onPointerDown={() => setPressed(v)}
            onPointerUp={() => setPressed(null)}
            onPointerLeave={() => setPressed(null)}
            style={{
              height: 26,
              borderRadius: RADIUS.pill,
              background: selected ? COLORS.greenTint : COLORS.surface,
              border: `1px solid ${selected ? COLORS.green : COLORS.borderLight}`,
              color: selected ? COLORS.green : COLORS.textMuted,
              fontSize: 12,
              fontWeight: 800,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              transform: isPressed ? 'scale(0.95)' : 'scale(1)',
              transition: 'transform 90ms ease-out, border-color 0.15s, background 0.15s',
            }}
          >
            {v}
          </button>
        )
      })}
    </div>
  )
}
