// 提交问题弹窗 —— 沿用 admin/PlayerBalanceModal 的遮罩/面板风格，禁用原生 alert/confirm。
// 提交后纯前端往列表顶插一条，不请求后端。提交人自动带当前登录账号（只读）。
import { useEffect, useRef, useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { useToast } from '../state/ToastContext.jsx'
import { CURRENT_USER } from '../data/session.js'
import { PRIORITY_META, MERCHANT_OPTIONS } from '../data/issues.js'
import Icon from './Icon.jsx'

const fieldStyle = {
  padding: '9px 10px',
  fontSize: 14,
  color: COLORS.text,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.sm,
  outline: 'none',
  width: '100%',
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

// 单张缩略图 + 右上角 × 删除。纯前端预览，不上传。
function Thumb({ url, onRemove }) {
  return (
    <div style={{ position: 'relative', width: 72, height: 72 }}>
      <img
        src={url}
        alt="截图预览"
        style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: `1px solid ${COLORS.border}` }}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="移除这张截图"
        style={{
          position: 'absolute',
          top: -7,
          right: -7,
          width: 20,
          height: 20,
          borderRadius: 999,
          background: COLORS.danger,
          color: COLORS.white,
          border: `1px solid ${COLORS.panel}`,
          fontSize: 13,
          lineHeight: 1,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ×
      </button>
    </div>
  )
}

// 截图字段：多张上传（累加）+ 虚线拖拽区 + 缩略图网格。图仅前端预览，不发后端。
function ScreenshotField({ shots, onAdd, onRemove }) {
  const inputRef = useRef(null)
  const [hover, setHover] = useState(false)

  function handleInput(e) {
    onAdd(e.target.files)
    e.target.value = '' // 清空以便再次选同一文件也能触发
  }
  function handleDrop(e) {
    e.preventDefault()
    setHover(false)
    onAdd(e.dataTransfer.files)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, color: COLORS.textMuted }}>截图</span>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setHover(true)
        }}
        onDragLeave={() => setHover(false)}
        onDrop={handleDrop}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: SPACE.sm,
          padding: '16px 12px',
          border: `1px dashed ${hover ? COLORS.primaryBorder : COLORS.border}`,
          borderRadius: RADIUS.sm,
          color: hover ? COLORS.text : COLORS.textFaint,
          background: COLORS.surface,
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        <Icon name="photo" size={18} color={hover ? COLORS.text : COLORS.textFaint} />
        <span>点击或拖拽图片（可多张）</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleInput}
        style={{ display: 'none' }}
      />
      {shots.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md, marginTop: 4 }}>
          {shots.map((s) => (
            <Thumb key={s.id} url={s.url} onRemove={() => onRemove(s.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function ModalHeader({ onClose }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.text }}>提交问题</div>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        style={{
          background: 'none',
          border: 'none',
          color: COLORS.textMuted,
          fontSize: 18,
          cursor: 'pointer',
          lineHeight: 1,
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  )
}

export default function SubmitIssueModal({ onClose, onSubmit }) {
  const { push } = useToast()
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [priority, setPriority] = useState('mid')
  const [merchant, setMerchant] = useState('')
  const [shots, setShots] = useState([])
  const [formError, setFormError] = useState('')

  // 组件卸载时释放所有预览 URL，防内存泄漏（用 ref 拿到最新 shots）。
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
    onSubmit({ title: title.trim(), desc: desc.trim(), priority, merchant })
    push('问题已提交，已置顶留档', 'success')
    onClose()
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} style={panelStyle}>
        <ModalHeader onClose={onClose} />

        <Field label="标题" required>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="一句话说清问题"
            style={fieldStyle}
          />
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

        <div style={{ display: 'flex', gap: SPACE.md }}>
          <Field label="优先级">
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={fieldStyle}>
              {Object.entries(PRIORITY_META).map(([key, m]) => (
                <option key={key} value={key}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="归属商家">
            <select value={merchant} onChange={(e) => setMerchant(e.target.value)} style={fieldStyle}>
              {MERCHANT_OPTIONS.map((m) => (
                <option key={m || 'platform'} value={m}>
                  {m || '平台级（留空）'}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <ScreenshotField shots={shots} onAdd={addShots} onRemove={removeShot} />

        <Field label="提交人">
          <input value={CURRENT_USER} readOnly style={{ ...fieldStyle, color: COLORS.textMuted }} />
        </Field>

        {formError && (
          <div
            style={{
              fontSize: 13,
              color: COLORS.danger,
              background: COLORS.dangerTint,
              border: '1px solid rgba(226,86,74,0.35)',
              borderRadius: RADIUS.sm,
              padding: '8px 12px',
            }}
          >
            {formError}
          </div>
        )}

        <div style={{ display: 'flex', gap: SPACE.sm, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 500,
              color: COLORS.textMuted,
              background: 'transparent',
              border: `1px solid ${COLORS.border}`,
              borderRadius: RADIUS.sm,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="submit"
            style={{
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              color: COLORS.white,
              background: COLORS.primary,
              border: 'none',
              borderRadius: RADIUS.sm,
              cursor: 'pointer',
            }}
          >
            提交
          </button>
        </div>
      </form>
    </div>
  )
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: SPACE.lg,
}

const panelStyle = {
  width: '100%',
  maxWidth: 460,
  background: COLORS.panel,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.md,
  padding: SPACE.lg,
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.md,
  maxHeight: '90vh',
  overflowY: 'auto',
}
