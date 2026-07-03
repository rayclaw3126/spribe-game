import { COLORS, RADIUS, SPACE } from './tokens'

// Horizontal capsule strip of recent round multipliers, newest on the left.
// <2× slate, 2–10× soft green, ≥10× amber gold. New pills slide in from the
// left over 150ms; overflow scrolls horizontally. Designed for the dark arena bg.

function pillStyle(v) {
  if (v >= 10) return { background: COLORS.amberTint, color: COLORS.amber }
  if (v >= 2) return { background: COLORS.greenTint, color: COLORS.greenSoft }
  return { background: COLORS.slateTint, color: COLORS.slate }
}

export default function RoundHistoryBar({ rounds }) {
  return (
    <div style={{
      display: 'flex', gap: SPACE.sm, alignItems: 'center',
      overflowX: 'auto', scrollbarWidth: 'none',
      padding: `${SPACE.xs}px 0 ${SPACE.sm}px`,
    }}>
      <style>{`
        @keyframes shellPillIn {
          from { transform: translateX(-16px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
      {rounds.map((v, i) => (
        // Stable ids: history is prepend-only, so (length - index) pins each
        // round and only the newly mounted pill runs the slide-in.
        <span key={rounds.length - i} style={{
          flex: '0 0 auto',
          padding: `3px ${SPACE.md}px`,
          borderRadius: RADIUS.pill,
          fontSize: 12,
          fontWeight: 900,
          animation: 'shellPillIn 150ms ease-out',
          ...pillStyle(v),
        }}>
          {v.toFixed(2)}×
        </span>
      ))}
    </div>
  )
}
