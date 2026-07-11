// 平台费流水（接后端 /fees/list）。汇总/明细来自 commissions type='platform_fee'，按 agents.tenant_id 归商家。
// 商家下拉来自 /tenants；商家 + 时间范围传后端参数重查；loading/错误态照 SystemIssuesPage。
import { useCallback, useEffect, useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { RANGE_OPTIONS, TYPE_META, FEE_STATUS } from '../data/fees.js'
import { getFees, listTenants } from '../api/client.js'
import { formatTime } from '../lib/format.js'
import DataTable from '../components/DataTable.jsx'
import EmptyState from '../components/EmptyState.jsx'

const TONE_COLOR = {
  primary: { color: COLORS.primary, bg: COLORS.primarySoft },
  success: { color: COLORS.success, bg: COLORS.successTint },
  warning: { color: COLORS.warning, bg: COLORS.warningTint },
  muted: { color: COLORS.textMuted, bg: COLORS.surface },
}

function fmtMoney(n) {
  return '¥' + Number(n).toLocaleString('en-US')
}

function Badge({ meta }) {
  if (!meta) return null
  const c = TONE_COLOR[meta.tone] || TONE_COLOR.muted
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

function PageHeader() {
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: COLORS.text }}>平台费流水</h1>
      <p style={{ margin: '6px 0 0', fontSize: 13.5, color: COLORS.textMuted }}>各商家平台费入账与结算明细</p>
    </div>
  )
}

function SummaryBar({ summary }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: SPACE.xl,
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: RADIUS.md,
        padding: `${SPACE.md}px ${SPACE.lg}px`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12.5, color: COLORS.textMuted }}>本月平台费合计</span>
        <span style={{ fontSize: 22, fontWeight: 600, color: COLORS.success, fontVariantNumeric: 'tabular-nums' }}>
          {fmtMoney(summary.feeTotal)}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12.5, color: COLORS.textMuted }}>本月笔数</span>
        <span style={{ fontSize: 22, fontWeight: 600, color: COLORS.text, fontVariantNumeric: 'tabular-nums' }}>
          {summary.count}
        </span>
      </div>
    </div>
  )
}

const selectStyle = {
  padding: '9px 12px',
  fontSize: 13.5,
  color: COLORS.text,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.sm,
  outline: 'none',
  cursor: 'pointer',
}

function FilterRow({ tenants, tenantId, onTenant, range, onRange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md, alignItems: 'center' }}>
      <select value={tenantId} onChange={(e) => onTenant(e.target.value)} style={selectStyle}>
        <option value="all">全部商家</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: SPACE.sm }}>
        {RANGE_OPTIONS.map((o) => {
          const active = range === o.key
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onRange(o.key)}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
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
    </div>
  )
}

const COLUMNS = [
  { key: 'time', label: '时间', render: (r) => <span style={{ color: COLORS.textMuted, whiteSpace: 'nowrap' }}>{formatTime(r.time)}</span> },
  { key: 'merchant', label: '商家', render: (r) => <strong style={{ color: COLORS.text, fontWeight: 600 }}>{r.merchant}</strong> },
  { key: 'type', label: '类型', render: (r) => <Badge meta={TYPE_META[r.type]} /> },
  { key: 'turnover', label: '流水金额', align: 'right', render: (r) => fmtMoney(r.turnover) },
  { key: 'fee', label: '平台费', align: 'right', render: (r) => <span style={{ color: COLORS.success }}>{fmtMoney(r.fee)}</span> },
  { key: 'status', label: '状态', render: (r) => <Badge meta={FEE_STATUS[r.status]} /> },
]

export default function FeesPage() {
  const [tenants, setTenants] = useState([])
  const [tenantId, setTenantId] = useState('all')
  const [range, setRange] = useState('month')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 商家下拉：拉一次 /tenants。
  useEffect(() => {
    listTenants().then((r) => setTenants(r.items || [])).catch(() => setTenants([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await getFees({ tenantId, range }))
    } catch (err) {
      setError(err.message || '加载失败')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [tenantId, range])

  useEffect(() => { load() }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
      <PageHeader />
      {data && <SummaryBar summary={data.summary} />}
      <FilterRow tenants={tenants} tenantId={tenantId} onTenant={setTenantId} range={range} onRange={setRange} />

      {error ? (
        <EmptyState text={error} />
      ) : loading || !data ? (
        <EmptyState text="加载中…" />
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: COLORS.textFaint }}>共 {data.items.length} 条</div>
          <DataTable columns={COLUMNS} rows={data.items} rowKey="id" emptyText="该范围内暂无流水" />
        </>
      )}
    </div>
  )
}
