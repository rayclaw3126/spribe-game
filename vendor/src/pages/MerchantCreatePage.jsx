// 开商家表单页（纯 UI，不接后端、不建表）。表单款式照 SubmitIssueModal 的 fieldStyle/Field，
// 页头/配色照 MerchantsPage 深蓝专业风。返回/取消 跳回 /merchants；「开通」仍留空（接后端等后续单）。
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { SKIN_OPTIONS } from '../data/merchants.js'

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

function PageHeader({ onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
      <button
        type="button"
        onClick={onBack}
        style={{ alignSelf: 'flex-start', padding: 0, background: 'none', border: 'none', color: COLORS.textMuted, fontSize: 13, cursor: 'pointer' }}
      >
        ← 返回商家列表
      </button>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: COLORS.text }}>开商家</h1>
      <p style={{ margin: 0, fontSize: 13.5, color: COLORS.textMuted }}>填写商家基本信息，开通后可在商家列表继续配置</p>
    </div>
  )
}

// 状态启用/停用切换（segmented，两按钮，选中填蓝）。
function StatusToggle({ value, onChange }) {
  const options = [
    { key: 'active', label: '启用' },
    { key: 'disabled', label: '停用' },
  ]
  return (
    <div style={{ display: 'flex', gap: SPACE.sm }}>
      {options.map((o) => {
        const active = value === o.key
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            style={{
              flex: 1,
              padding: '9px 12px',
              fontSize: 13.5,
              fontWeight: 600,
              color: active ? COLORS.white : COLORS.textMuted,
              background: active ? COLORS.primary : COLORS.surface,
              border: `1px solid ${active ? COLORS.primaryBorder : COLORS.border}`,
              borderRadius: RADIUS.sm,
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export default function MerchantCreatePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [skin, setSkin] = useState(SKIN_OPTIONS[0])
  const [status, setStatus] = useState('active')

  const goBack = () => navigate('/merchants')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 560 }}>
      <PageHeader onBack={goBack} />

      <div
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADIUS.md,
          padding: SPACE.lg,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACE.md,
        }}
      >
        <Field label="商家名" required>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 GameHub" style={fieldStyle} />
        </Field>

        <Field label="域名">
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="如 gamehub.dad" style={fieldStyle} />
        </Field>

        <Field label="皮肤">
          <select value={skin} onChange={(e) => setSkin(e.target.value)} style={fieldStyle}>
            {SKIN_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label="状态">
          <StatusToggle value={status} onChange={setStatus} />
        </Field>

        <div style={{ display: 'flex', gap: SPACE.sm, justifyContent: 'flex-end', marginTop: SPACE.xs }}>
          <button
            type="button"
            onClick={goBack}
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
            type="button"
            onClick={() => {}}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              color: COLORS.white,
              background: COLORS.primary,
              border: 'none',
              borderRadius: RADIUS.sm,
              cursor: 'pointer',
            }}
          >
            开通
          </button>
        </div>
      </div>
    </div>
  )
}
