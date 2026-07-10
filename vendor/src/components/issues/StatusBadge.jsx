// 状态徽章 + 优先级圆点 —— 配色取自 data/issues.js 的 STATUS_META / PRIORITY_META。
import { STATUS_META, PRIORITY_META } from '../../data/issues.js'

export function StatusBadge({ status }) {
  const meta = STATUS_META[status]
  if (!meta) return null
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 12,
        fontWeight: 600,
        color: meta.color,
        background: meta.bg,
        border: `1px solid ${meta.color}33`,
        borderRadius: 6,
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  )
}

export function PriorityDot({ priority, withLabel = false }) {
  const meta = PRIORITY_META[priority]
  if (!meta) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: meta.color,
          flexShrink: 0,
        }}
      />
      {withLabel && <span style={{ fontSize: 12.5, color: meta.color }}>{meta.label}</span>}
    </span>
  )
}
