// 代理后台反馈入口：右下悬浮圆钮 → 提交反馈弹窗。纯 UI，不接后端。
// 挂在 DashboardLayout 最外层，登录后全局显示；提交只走全局 toast，图片仅前端预览。
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { COLORS, RADIUS, SPACE } from '../../theme/tokens.js'
import { useAuth } from '../../state/AuthContext.jsx'
import { useToast } from '../../state/ToastContext.jsx'
import { createIssue, uploadIssueImages } from '../../api/client.js'
import ScreenshotField from './ScreenshotField.jsx'

// 路由 → 当前页面名（自动带、只读）。未知路径回退「后台」。
const PAGE_NAMES = {
  '/': '代理树',
  '/downline': '下级列表',
  '/credit': '额度下发',
}

function MessageReportIcon({ size = 24, color = COLORS.white }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 8v3" />
      <path d="M12 14v.01" />
      <path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h13z" />
    </svg>
  )
}

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

function Field({ label, required, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, color: COLORS.textMuted }}>
        {label}
        {required && <span style={{ color: COLORS.danger, marginLeft: 4 }}>*</span>}
      </span>
      {children}
    </label>
  )
}

// 只读隐藏字段：当前代理账号 / 当前页面。
function AutoField({ label, value }) {
  return (
    <Field label={label}>
      <input value={value} readOnly style={{ ...fieldStyle, color: COLORS.textMuted }} />
    </Field>
  )
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1100,
  padding: SPACE.lg,
}

function ModalHeader({ onClose }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.text }}>提交反馈</div>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        style={{ background: 'none', border: 'none', color: COLORS.textMuted, fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}
      >
        ×
      </button>
    </div>
  )
}

function FeedbackModal({ username, pageName, onClose, onSubmitted }) {
  const { push } = useToast()
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [shots, setShots] = useState([])
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const shotsRef = useRef(shots)
  shotsRef.current = shots
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), [])

  const idRef = useRef(0)
  function addShots(fileList) {
    const picked = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'))
    if (!picked.length) return
    setShots((prev) => [...prev, ...picked.map((file) => ({ id: ++idRef.current, url: URL.createObjectURL(file), file }))])
  }
  function removeShot(id) {
    setShots((prev) => {
      const target = prev.find((s) => s.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((s) => s.id !== id)
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) {
      setFormError('请填写标题')
      return
    }
    setFormError('')
    setSubmitting(true)
    try {
      // 两步：先建问题拿 id，再传图（有图才传）。source_page=当前页面，source_tenant 留空=平台级。
      // admin 反馈钮无优先级选项，默认 mid。
      const { issue } = await createIssue({
        title: title.trim(),
        description: desc.trim() || undefined,
        priority: 'mid',
        sourcePage: pageName,
      })
      if (shots.length > 0) {
        await uploadIssueImages(issue.id, shots.map((s) => s.file))
      }
      onSubmitted()
    } catch (err) {
      const msg = err.message || '提交失败'
      setFormError(msg)
      push(msg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 460,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADIUS.md,
          padding: SPACE.lg,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACE.md,
        }}
      >
        <ModalHeader onClose={onClose} />

        <Field label="标题" required>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="一句话说清问题" style={fieldStyle} />
        </Field>

        <Field label="描述">
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="复现步骤 / 现象 / 期望，越具体越好"
            rows={4}
            style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.6 }}
          />
        </Field>

        <ScreenshotField shots={shots} onAdd={addShots} onRemove={removeShot} />

        <AutoField label="当前账号" value={username || '—'} />
        <AutoField label="当前页面" value={pageName} />

        {formError && (
          <div style={{ fontSize: 13, color: COLORS.danger, background: COLORS.dangerTint, border: '1px solid rgba(226,86,74,0.35)', borderRadius: RADIUS.sm, padding: '8px 12px' }}>
            {formError}
          </div>
        )}

        <div style={{ display: 'flex', gap: SPACE.sm, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '10px 18px', fontSize: 14, fontWeight: 500, color: COLORS.textMuted, background: 'transparent', border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.sm, cursor: 'pointer' }}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            style={{ padding: '10px 20px', fontSize: 14, fontWeight: 600, color: COLORS.white, background: submitting ? COLORS.slate : COLORS.primary, border: 'none', borderRadius: RADIUS.sm, cursor: submitting ? 'default' : 'pointer' }}
          >
            {submitting ? '提交中…' : '提交'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function FeedbackWidget() {
  const { user } = useAuth()
  const { push } = useToast()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  const pageName = PAGE_NAMES[location.pathname] || '后台'

  function handleSubmitted() {
    setOpen(false)
    push('已提交，感谢反馈！', 'success')
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="提交反馈"
          title="提交反馈"
          style={{
            position: 'fixed',
            right: 20,
            bottom: 24,
            zIndex: 1000,
            width: 52,
            height: 52,
            borderRadius: 999,
            background: COLORS.primary,
            color: COLORS.white,
            border: `1px solid ${COLORS.primaryBorder}`,
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MessageReportIcon size={24} />
        </button>
      )}
      {open && (
        <FeedbackModal
          username={user?.username}
          pageName={pageName}
          onClose={() => setOpen(false)}
          onSubmitted={handleSubmitted}
        />
      )}
    </>
  )
}
