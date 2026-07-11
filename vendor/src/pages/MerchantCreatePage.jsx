// 商家表单页（新建 / 编辑双模式）。款式照 SubmitIssueModal 的 fieldStyle/Field，页头照 MerchantsPage 深蓝专业风。
// 无 id → 开商家(POST /tenants)；有 :id → 编辑商家(先 listTenants 找到该条预填，提交走 PATCH /tenants/:id)。
// 后端没有 GET /tenants/:id，本单不碰 server/，改用 listTenants 找目标（列表条目少，够用）。
// 返回/取消 跳回 /merchants；name 必填校验。
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { SKIN_OPTIONS } from '../data/merchants.js'
import { createTenant, listTenants, patchTenant } from '../api/client.js'
import { useToast } from '../state/ToastContext.jsx'
import EmptyState from '../components/EmptyState.jsx'

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

function PageHeader({ title, subtitle, onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
      <button
        type="button"
        onClick={onBack}
        style={{ alignSelf: 'flex-start', padding: 0, background: 'none', border: 'none', color: COLORS.textMuted, fontSize: 13, cursor: 'pointer' }}
      >
        ← 返回商家列表
      </button>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: COLORS.text }}>{title}</h1>
      <p style={{ margin: 0, fontSize: 13.5, color: COLORS.textMuted }}>{subtitle}</p>
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
  const { push } = useToast()
  const { id } = useParams()
  const isEdit = Boolean(id)

  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [skin, setSkin] = useState(SKIN_OPTIONS[0])
  const [status, setStatus] = useState('active')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(isEdit)   // 编辑态先拉数据预填
  const [loadError, setLoadError] = useState('')

  const goBack = () => navigate('/merchants')

  // 编辑态：拉列表找到目标商家预填（后端无 GET /tenants/:id，用 listTenants 兜）。
  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    setLoading(true)
    setLoadError('')
    listTenants()
      .then((r) => {
        if (cancelled) return
        const t = (r.items || []).find((x) => String(x.id) === String(id))
        if (!t) {
          setLoadError('商家不存在')
          return
        }
        setName(t.name || '')
        setDomain(t.domain || '')
        setSkin(t.skin || SKIN_OPTIONS[0])
        setStatus(t.status || 'active')
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [isEdit, id])

  async function handleSubmit() {
    if (!name.trim()) {
      setFormError('请填写商家名')
      return
    }
    setFormError('')
    setSubmitting(true)
    const payload = { name: name.trim(), domain: domain.trim() || undefined, skin, status }
    try {
      if (isEdit) {
        await patchTenant(id, payload)
        push('商家已更新', 'success')
      } else {
        await createTenant(payload)
        push('商家已开通', 'success')
      }
      navigate('/merchants')
    } catch (err) {
      const msg = err.message || (isEdit ? '保存失败' : '开通失败')
      setFormError(msg)
      push(msg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const title = isEdit ? '编辑商家' : '开商家'
  const subtitle = isEdit ? '修改商家配置，保存后即时生效' : '填写商家基本信息，开通后可在商家列表继续配置'
  const submitLabel = isEdit ? (submitting ? '保存中…' : '保存') : (submitting ? '开通中…' : '开通')

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 560 }}>
        <PageHeader title={title} subtitle={subtitle} onBack={goBack} />
        <EmptyState text="加载中…" />
      </div>
    )
  }
  if (loadError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 560 }}>
        <PageHeader title={title} subtitle={subtitle} onBack={goBack} />
        <EmptyState text={loadError} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 560 }}>
      <PageHeader title={title} subtitle={subtitle} onBack={goBack} />

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
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              color: COLORS.white,
              background: submitting ? COLORS.slate : COLORS.primary,
              border: 'none',
              borderRadius: RADIUS.sm,
              cursor: submitting ? 'default' : 'pointer',
            }}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
