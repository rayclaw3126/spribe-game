import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import PlaceholderBadge from './PlaceholderBadge.jsx'

export default function KpiCard({ label, value, hint, placeholder = false }) {
  return (
    <div
      style={{
        flex: '1 1 200px',
        minWidth: 180,
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: RADIUS.md,
        padding: SPACE.lg,
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.sm,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm }}>
        <span style={{ fontSize: 12.5, color: COLORS.textMuted, fontWeight: 500 }}>{label}</span>
        {placeholder && <PlaceholderBadge />}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 600,
          color: COLORS.text,
          fontVariantNumeric: 'tabular-nums',
          fontFeatureSettings: '"tnum"',
        }}
      >
        {value}
      </div>
      {hint && <div style={{ fontSize: 12, color: COLORS.textFaint }}>{hint}</div>}
    </div>
  )
}
