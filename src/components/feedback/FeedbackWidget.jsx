// 前台反馈入口（入口B）：右下悬浮圆钮 → 提交反馈弹窗。纯 UI，不接后端。
// 挂在 App 最外层、仅登录后渲染；提交只前端 toast「已提交」，图片仅前端预览。
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { COLORS, RADIUS, SPACE } from '../shell/tokens.js'
import ScreenshotField from './ScreenshotField.jsx'

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
  borderRadius: RADIUS.input,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

function Field({ label, required, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, color: COLORS.textMuted }}>
        {label}
        {required && <span style={{ color: COLORS.redDark, marginLeft: 4 }}>*</span>}
      </span>
      {children}
    </label>
  )
}

// 只读隐藏字段：当前游戏 / 玩家，自动带、灰显不可编辑。
function AutoField({ label, value }) {
  return (
    <Field label={label}>
      <input value={value} readOnly style={{ ...fieldStyle, color: COLORS.textMuted }} />
    </Field>
  )
}

function MiniToast({ text }) {
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 40,
        transform: 'translateX(-50%)',
        zIndex: 2200,
        padding: '12px 20px',
        fontSize: 14,
        fontWeight: 600,
        color: COLORS.text,
        background: COLORS.toastBg,
        border: `1px solid ${COLORS.toastBorder}`,
        borderRadius: RADIUS.btn,
        boxShadow: `0 6px 20px ${COLORS.shadow}`,
      }}
    >
      {text}
    </div>
  )
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2100,
  padding: SPACE.lg,
}

function ModalHeader({ onClose }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text }}>提交反馈</div>
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

function FeedbackModal({ activeGame, username, onClose, onSubmitted }) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [shots, setShots] = useState([])
  const [formError, setFormError] = useState('')

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

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) {
      setFormError('请填写标题')
      return
    }
    // 纯前端：不发后端，图片仅本地预览，提交即关窗 + toast。
    onSubmitted()
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
          borderRadius: RADIUS.panel,
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

        <AutoField label="当前游戏" value={activeGame || '大厅'} />
        <AutoField label="玩家" value={username || '—'} />

        {formError && (
          <div style={{ fontSize: 13, color: COLORS.white, background: COLORS.redDeep, borderRadius: RADIUS.input, padding: '8px 12px' }}>
            {formError}
          </div>
        )}

        <div style={{ display: 'flex', gap: SPACE.sm, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '10px 18px', fontSize: 14, fontWeight: 600, color: COLORS.textMuted, background: 'transparent', border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.input, cursor: 'pointer' }}
          >
            取消
          </button>
          <button
            type="submit"
            style={{ padding: '10px 20px', fontSize: 14, fontWeight: 700, color: COLORS.white, background: COLORS.green, border: 'none', borderRadius: RADIUS.input, cursor: 'pointer' }}
          >
            提交
          </button>
        </div>
      </form>
    </div>
  )
}

export default function FeedbackWidget({ activeGame, username }) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState(false)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(false), 2600)
    return () => clearTimeout(t)
  }, [toast])

  function handleSubmitted() {
    setOpen(false)
    setToast(true)
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
            right: 16,
            // 手机端抬高，避开底部下注操作区；桌面端贴右下角空白处。
            bottom: isMobile ? 104 : 24,
            zIndex: 2000,
            width: 52,
            height: 52,
            borderRadius: 999,
            background: COLORS.green,
            color: COLORS.white,
            border: `1px solid ${COLORS.greenGlow}`,
            boxShadow: `0 6px 18px ${COLORS.shadow}`,
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
          activeGame={activeGame}
          username={username}
          onClose={() => setOpen(false)}
          onSubmitted={handleSubmitted}
        />
      )}
      {toast && <MiniToast text="已提交，感谢反馈！" />}
    </>
  )
}
