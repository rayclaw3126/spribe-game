import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'

export default function EmptyState({ text = '暂无数据' }) {
  return (
    <div
      style={{
        padding: `${SPACE.xxl}px ${SPACE.lg}px`,
        textAlign: 'center',
        color: COLORS.textFaint,
        fontSize: 13.5,
        border: `1px dashed ${COLORS.border}`,
        borderRadius: RADIUS.md,
      }}
    >
      {text}
    </div>
  )
}
