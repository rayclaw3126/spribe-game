// 商家管理页（接后端 /tenants）：列表 GET /tenants，停用/启用 PATCH /tenants/:id。
// loading/错误态照 SystemIssuesPage；toast/刷新用 vendor 现成写法。「编辑」本单先留空（下一单接）。
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { MERCHANT_STATUS } from '../data/merchants.js'
import { listTenants, patchTenant } from '../api/client.js'
import { useToast } from '../state/ToastContext.jsx'
import DataTable from '../components/DataTable.jsx'
import EmptyState from '../components/EmptyState.jsx'

const STATUS_COLOR = {
  success: { color: COLORS.success, bg: COLORS.successTint },
  muted: { color: COLORS.textMuted, bg: COLORS.surface },
}

function PageHeader({ onCreate }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.md }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: COLORS.text }}>商家管理</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13.5, color: COLORS.textMuted }}>
          白标平台已开通的商家一览，可开通新商家、编辑配置与停用
        </p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        style={{
          padding: '9px 16px',
          fontSize: 13.5,
          fontWeight: 600,
          color: COLORS.white,
          background: COLORS.primary,
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        + 开商家
      </button>
    </div>
  )
}

function StatusBadge({ status }) {
  const meta = MERCHANT_STATUS[status]
  if (!meta) return null
  const c = STATUS_COLOR[meta.tone]
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 12,
        fontWeight: 600,
        color: c.color,
        background: c.bg,
        border: `1px solid ${c.color}33`,
        borderRadius: 6,
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  )
}

function linkButtonStyle(tone, disabled) {
  return {
    padding: '4px 10px',
    fontSize: 12.5,
    fontWeight: 600,
    color: tone === 'danger' ? COLORS.danger : COLORS.textMuted,
    background: 'transparent',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    whiteSpace: 'nowrap',
  }
}

// 编辑（跳编辑页）+ 停用/启用（PATCH status）。busy 时禁用防重复点。
function OpsCell({ row, busy, onEdit, onToggle }) {
  const toActive = row.status !== 'active'
  return (
    <div style={{ display: 'flex', gap: SPACE.sm }}>
      <button type="button" onClick={() => onEdit(row)} style={linkButtonStyle()}>
        编辑
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(row, toActive ? 'active' : 'disabled')}
        style={linkButtonStyle(toActive ? '' : 'danger', busy)}
      >
        {toActive ? '启用' : '停用'}
      </button>
    </div>
  )
}

export default function MerchantsPage() {
  const navigate = useNavigate()
  const { push } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await listTenants()
      setRows(r.items)
    } catch (err) {
      setError(err.message || '加载失败')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleStatus(row, status) {
    setBusyId(row.id)
    try {
      await patchTenant(row.id, { status })
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status } : r)))
      push(status === 'active' ? '已启用' : '已停用', 'success')
    } catch (err) {
      push(err.message || '更新失败', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const columns = [
    { key: 'name', label: '商家名', render: (r) => <strong style={{ color: COLORS.text, fontWeight: 600 }}>{r.name}</strong> },
    { key: 'domain', label: '域名', render: (r) => <span style={{ color: COLORS.textMuted }}>{r.domain || '—'}</span> },
    { key: 'skin', label: '皮肤', render: (r) => r.skin || '—' },
    { key: 'status', label: '状态', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'created_at', label: '开通时间', render: (r) => <span style={{ color: COLORS.textMuted }}>{(r.created_at || '').slice(0, 10)}</span> },
    { key: 'ops', label: '操作', render: (r) => <OpsCell row={r} busy={busyId === r.id} onEdit={(row) => navigate(`/merchants/${row.id}/edit`)} onToggle={toggleStatus} /> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
      <PageHeader onCreate={() => navigate('/merchants/new')} />

      {error ? (
        <EmptyState text={error} />
      ) : loading ? (
        <EmptyState text="加载中…" />
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: COLORS.textFaint }}>共 {rows.length} 个商家</div>
          <DataTable columns={columns} rows={rows} rowKey="id" emptyText="还没有开通任何商家" />
        </>
      )}
    </div>
  )
}
