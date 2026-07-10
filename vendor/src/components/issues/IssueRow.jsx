// 单条问题行：折叠态一行摘要，点 chevron 展开详情 + 来源 + 状态操作按钮。
// 已忽略行整行 opacity .6。状态操作纯 UI（回调改内存态），本单不落库。
import { useState } from 'react'
import { COLORS, SPACE } from '../../theme/tokens.js'
import { STATUS_META } from '../../data/issues.js'
import useIsMobile from '../../hooks/useIsMobile.js'
import Icon from '../Icon.jsx'
import { StatusBadge, PriorityDot } from './StatusBadge.jsx'

const ACTIONS = [
  { key: 'doing', label: '处理中' },
  { key: 'resolved', label: '已解决' },
  { key: 'ignored', label: '已忽略' },
]

function actionButtonStyle(active, meta) {
  return {
    padding: '6px 12px',
    fontSize: 12.5,
    fontWeight: 600,
    color: active ? COLORS.white : COLORS.textMuted,
    background: active ? meta.color : COLORS.surface,
    border: `1px solid ${active ? meta.color : COLORS.border}`,
    borderRadius: 6,
    cursor: 'pointer',
  }
}

function SourceLine({ label, value }) {
  return (
    <span style={{ fontSize: 12.5, color: COLORS.textMuted }}>
      {label}
      <strong style={{ color: COLORS.text, fontWeight: 600, marginLeft: 4 }}>{value || '—'}</strong>
    </span>
  )
}

function IssueDetail({ issue, onSetStatus }) {
  return (
    <div
      style={{
        padding: `${SPACE.md}px ${SPACE.lg}px ${SPACE.lg}px 52px`,
        borderTop: `1px solid ${COLORS.border}`,
        background: COLORS.bg,
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.md,
      }}
    >
      <div style={{ fontSize: 13.5, color: COLORS.text, lineHeight: 1.65 }}>{issue.desc}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.lg }}>
        <SourceLine label="归属商家：" value={issue.source.merchant || '平台级'} />
        <SourceLine label="游戏/模块：" value={issue.source.game} />
        <SourceLine label="玩家：" value={issue.source.player} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: COLORS.textFaint, marginRight: 4 }}>标记为</span>
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => onSetStatus(issue.id, a.key)}
            style={actionButtonStyle(issue.status === a.key, STATUS_META[a.key])}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const idStyle = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12.5,
  color: COLORS.textFaint,
  flexShrink: 0,
}

const metaStyle = { fontSize: 12.5, color: COLORS.textMuted, whiteSpace: 'nowrap' }

function Chevron({ open }) {
  return (
    <Icon
      name="chevron-down"
      size={18}
      color={COLORS.textMuted}
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}
    />
  )
}

// 桌面：单行；#id 徽章 圆点 标题(撑开) 提交人/时间 chevron。
function RowHeaderDesktop({ issue, open }) {
  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: SPACE.md }}>
      <span style={idStyle}>#{issue.id}</span>
      <StatusBadge status={issue.status} />
      <PriorityDot priority={issue.priority} />
      <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, flex: 1, minWidth: 0 }}>
        {issue.title}
      </span>
      <span style={metaStyle}>
        {issue.reporter} · {issue.time}
      </span>
      <Chevron open={open} />
    </div>
  )
}

// 移动：两行；避免标题被 nowrap 的提交人挤成一字一行。
function RowHeaderMobile({ issue, open }) {
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
        <span style={idStyle}>#{issue.id}</span>
        <StatusBadge status={issue.status} />
        <PriorityDot priority={issue.priority} />
        <span style={{ flex: 1 }} />
        <Chevron open={open} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>{issue.title}</div>
      <div style={{ ...metaStyle, color: COLORS.textFaint }}>
        {issue.reporter} · {issue.time}
      </div>
    </div>
  )
}

export default function IssueRow({ issue, onSetStatus }) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const dimmed = issue.status === 'ignored'

  return (
    <div style={{ borderBottom: `1px solid ${COLORS.border}`, opacity: dimmed ? 0.6 : 1 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          padding: '12px 16px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {isMobile ? <RowHeaderMobile issue={issue} open={open} /> : <RowHeaderDesktop issue={issue} open={open} />}
      </button>
      {open && <IssueDetail issue={issue} onSetStatus={onSetStatus} />}
    </div>
  )
}
