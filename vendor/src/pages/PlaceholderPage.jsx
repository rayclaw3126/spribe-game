// 占位空页：其余导航项本单先放「建设中」居中占位。
import { COLORS } from '../theme/tokens.js'

export default function PlaceholderPage({ title }) {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        color: COLORS.textFaint,
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.textMuted }}>{title}</div>
      <div style={{ fontSize: 14 }}>建设中</div>
    </div>
  )
}
