// 商家管理页（本单纯 UI + 假数据，不接后端）。骨架/工具栏/表格照 SystemIssuesPage + DataTable 同款。
// 「+ 开商家」「编辑」「停用/启用」本单先留空（onClick 空），接线/开商家页等后续单。
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { MERCHANTS_FAKE, MERCHANT_STATUS } from '../data/merchants.js'
import DataTable from '../components/DataTable.jsx'

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

function linkButtonStyle(tone) {
  return {
    padding: '4px 10px',
    fontSize: 12.5,
    fontWeight: 600,
    color: tone === 'danger' ? COLORS.danger : COLORS.textMuted,
    background: 'transparent',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

function OpsCell({ row }) {
  const toggleLabel = row.status === 'active' ? '停用' : '启用'
  return (
    <div style={{ display: 'flex', gap: SPACE.sm }}>
      <button type="button" onClick={() => {}} style={linkButtonStyle()}>
        编辑
      </button>
      <button type="button" onClick={() => {}} style={linkButtonStyle(row.status === 'active' ? 'danger' : '')}>
        {toggleLabel}
      </button>
    </div>
  )
}

const COLUMNS = [
  { key: 'name', label: '商家名', render: (r) => <strong style={{ color: COLORS.text, fontWeight: 600 }}>{r.name}</strong> },
  { key: 'domain', label: '域名', render: (r) => <span style={{ color: COLORS.textMuted }}>{r.domain}</span> },
  { key: 'skin', label: '皮肤' },
  { key: 'status', label: '状态', render: (r) => <StatusBadge status={r.status} /> },
  { key: 'createdAt', label: '开通时间', render: (r) => <span style={{ color: COLORS.textMuted }}>{r.createdAt}</span> },
  { key: 'ops', label: '操作', render: (r) => <OpsCell row={r} /> },
]

export default function MerchantsPage() {
  const rows = MERCHANTS_FAKE

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
      <PageHeader onCreate={() => {}} />
      <div style={{ fontSize: 12.5, color: COLORS.textFaint }}>共 {rows.length} 个商家</div>
      <DataTable columns={COLUMNS} rows={rows} rowKey="id" emptyText="还没有开通任何商家" />
    </div>
  )
}
