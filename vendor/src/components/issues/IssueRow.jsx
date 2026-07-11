// 单条问题行：折叠态一行摘要，点开展开时按需拉详情（GET /issues/:id）——描述 + 来源 + 图片 + 状态操作。
// 已忽略行整行 opacity .6。状态操作走 PATCH /issues/:id（回调到父层刷新）。
import { useEffect, useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../../theme/tokens.js'
import { STATUS_META } from '../../data/issues.js'
import { getIssue, patchIssue, imageUrl } from '../../api/client.js'
import { useToast } from '../../state/ToastContext.jsx'
import { padId, formatTime } from '../../lib/format.js'
import useIsMobile from '../../hooks/useIsMobile.js'
import Icon from '../Icon.jsx'
import { StatusBadge, PriorityDot } from './StatusBadge.jsx'

const ACTIONS = [
  { key: 'processing', label: '处理中' },
  { key: 'resolved', label: '已解决' },
  { key: 'ignored', label: '已忽略' },
]

const idStyle = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12.5,
  color: COLORS.textFaint,
  flexShrink: 0,
}
const metaStyle = { fontSize: 12.5, color: COLORS.textMuted, whiteSpace: 'nowrap' }

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

// 输入框款式 —— 复用 SubmitIssueModal 的 fieldStyle（不新增 hex）。
const fieldStyle = {
  padding: '9px 10px',
  fontSize: 14,
  color: COLORS.text,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.sm,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

function fieldLabel(text) {
  return <span style={{ fontSize: 13, color: COLORS.textMuted }}>{text}</span>
}

// 保存按钮款式：实心蓝，hover 提亮(brightness 1.08)，禁用态 slate（样式先写好，本单不接 dirty）。
function saveButtonStyle(disabled, hover) {
  return {
    alignSelf: 'flex-start',
    padding: '9px 20px',
    fontSize: 13.5,
    fontWeight: 600,
    color: COLORS.white,
    background: disabled ? COLORS.slate : COLORS.primary,
    border: 'none',
    borderRadius: RADIUS.sm,
    cursor: disabled ? 'default' : 'pointer',
    filter: !disabled && hover ? 'brightness(1.08)' : 'none',
  }
}

// 处理回复 + 负责人编辑区。保存走 PATCH /issues/:id（复用 api.patchIssue + 现有 toast）。
// dirty 检测：相对详情原值没改动时禁用保存；提交中禁用防重复点；成功回填最新值→回禁用态。
function HandleFields({ issueId, detail, onSaved }) {
  const { push } = useToast()
  const [reply, setReply] = useState('')
  const [assignee, setAssignee] = useState('')
  const [hover, setHover] = useState(false)
  const [saving, setSaving] = useState(false)

  const baseReply = detail?.reply || ''
  const baseAssignee = detail?.assignee || ''

  // 详情到达/刷新后回填已有 reply/assignee（保存成功后也走这条回落基线）。
  useEffect(() => {
    setReply(baseReply)
    setAssignee(baseAssignee)
  }, [baseReply, baseAssignee])

  const dirty = reply !== baseReply || assignee !== baseAssignee
  const disabled = saving || !dirty

  async function handleSave() {
    if (disabled) return
    setSaving(true)
    try {
      const res = await patchIssue(issueId, { reply, assignee })
      onSaved(res.issue) // 拿回最新值刷新详情（保留 images），基线随之更新→保存钮回禁用
      push('已保存', 'success')
    } catch (err) {
      push(err.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {fieldLabel('处理回复')}
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="输入处理回复…"
          style={{ ...fieldStyle, minHeight: 72, resize: 'vertical', lineHeight: 1.6 }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {fieldLabel('负责人')}
        <input
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          placeholder="负责人（如 tester02）"
          style={fieldStyle}
        />
      </label>
      <button
        type="button"
        onClick={handleSave}
        disabled={disabled}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={saveButtonStyle(disabled, hover)}
      >
        {saving ? '保存中…' : '保存'}
      </button>
    </div>
  )
}

function SourceLine({ label, value }) {
  return (
    <span style={{ fontSize: 12.5, color: COLORS.textMuted }}>
      {label}
      <strong style={{ color: COLORS.text, fontWeight: 600, marginLeft: 4 }}>{value || '—'}</strong>
    </span>
  )
}

function ImageGrid({ images }) {
  if (!images || images.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md }}>
      {images.map((img) => (
        <a key={img.id} href={imageUrl(img.url)} target="_blank" rel="noreferrer">
          <img
            src={imageUrl(img.url)}
            alt="截图"
            style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: `1px solid ${COLORS.border}` }}
          />
        </a>
      ))}
    </div>
  )
}

function IssueDetail({ issue, detail, loading, onSetStatus, onDetailUpdate }) {
  const src = detail || issue
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
      {loading && <div style={{ fontSize: 12.5, color: COLORS.textFaint }}>加载详情…</div>}
      <div style={{ fontSize: 13.5, color: COLORS.text, lineHeight: 1.65 }}>{src.description || '（无描述）'}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.lg }}>
        <SourceLine label="归属商家：" value={src.source_tenant || '平台级'} />
        <SourceLine label="页面/模块：" value={src.source_page} />
        <SourceLine label="提交人：" value={src.submitter} />
      </div>
      {detail && <ImageGrid images={detail.images} />}
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
      <HandleFields issueId={issue.id} detail={detail} onSaved={onDetailUpdate} />
    </div>
  )
}

// 负责人小标签：ti-user 图标 + 名字。空值不渲染（保持行干净）。
function AssigneeTag({ name }) {
  if (!name) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: COLORS.textMuted, whiteSpace: 'nowrap' }}>
      <Icon name="user" size={14} color={COLORS.textFaint} />
      <span style={{ color: COLORS.text, fontWeight: 600 }}>{name}</span>
    </span>
  )
}

function RowHeaderDesktop({ issue, open }) {
  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: SPACE.md }}>
      <span style={idStyle}>{padId(issue.id)}</span>
      <StatusBadge status={issue.status} />
      <PriorityDot priority={issue.priority} />
      <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, flex: 1, minWidth: 0 }}>{issue.title}</span>
      <AssigneeTag name={issue.assignee} />
      <span style={metaStyle}>{issue.submitter || '—'} · {formatTime(issue.created_at)}</span>
      <Chevron open={open} />
    </div>
  )
}

function RowHeaderMobile({ issue, open }) {
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
        <span style={idStyle}>{padId(issue.id)}</span>
        <StatusBadge status={issue.status} />
        <PriorityDot priority={issue.priority} />
        <span style={{ flex: 1 }} />
        <Chevron open={open} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>{issue.title}</div>
      <div style={{ ...metaStyle, color: COLORS.textFaint, display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', whiteSpace: 'normal' }}>
        <span>{issue.submitter || '—'} · {formatTime(issue.created_at)}</span>
        {issue.assignee && (
          <>
            <span>·</span>
            <AssigneeTag name={issue.assignee} />
          </>
        )}
      </div>
    </div>
  )
}

export default function IssueRow({ issue, onSetStatus }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const isMobile = useIsMobile()
  const dimmed = issue.status === 'ignored'

  async function toggle() {
    const next = !open
    setOpen(next)
    // 展开时按需拉详情（含描述/来源/图片）；只拉一次。
    if (next && !detail && !loading) {
      setLoading(true)
      try {
        const res = await getIssue(issue.id)
        setDetail(res.issue)
      } catch {
        // 详情拉取失败：折叠态仍可用列表字段兜底，不阻断。
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div style={{ borderBottom: `1px solid ${COLORS.border}`, opacity: dimmed ? 0.6 : 1 }}>
      <button
        type="button"
        onClick={toggle}
        style={{ width: '100%', display: 'flex', padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        {isMobile ? <RowHeaderMobile issue={issue} open={open} /> : <RowHeaderDesktop issue={issue} open={open} />}
      </button>
      {open && (
        <IssueDetail
          issue={issue}
          detail={detail}
          loading={loading}
          onSetStatus={onSetStatus}
          onDetailUpdate={(updated) => setDetail((prev) => ({ ...prev, ...updated }))}
        />
      )}
    </div>
  )
}
