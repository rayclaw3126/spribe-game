// 统一的"占位数据"小标签 —— 凡是后端第 6 期才会提供的字段，一律挂这个标签，
// 绝不能让占位数值看起来像真实数据。
import { COLORS, RADIUS } from '../theme/tokens.js'

export default function PlaceholderBadge({ text = '示例 · 待单6接口' }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 600,
        color: COLORS.warning,
        background: COLORS.warningTint,
        border: `1px solid rgba(245,166,35,0.35)`,
        borderRadius: RADIUS.sm,
        padding: '2px 6px',
        letterSpacing: 0.2,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  )
}
