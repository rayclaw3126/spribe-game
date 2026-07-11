// 跨商家风控（接后端 /risk/list）。概览/明细来自 risk_alerts，join tenants 取商家名。
// 商家下拉来自 /tenants；等级 + 商家传后端参数重查；loading/错误态照 SystemIssuesPage。
import { useCallback, useEffect, useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { LEVEL_OPTIONS, RISK_TYPE, RISK_LEVEL, RISK_STATUS } from '../data/risk.js'
import { getRisk, listTenants } from '../api/client.js'
import { formatTime } from '../lib/format.js'
import KpiCard from '../components/KpiCard.jsx'
import DataTable from '../components/DataTable.jsx'
import EmptyState from '../components/EmptyState.jsx'

const TONE_COLOR = {
  danger: { color: COLORS.danger, bg: COLORS.dangerTint },
  warning: { color: COLORS.warning, bg: COLORS.warningTint },
  success: { color: COLORS.success, bg: COLORS.successTint },
  muted: { color: COLORS.textMuted, bg: COLORS.surface },
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
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: COLORS.text }}>跨商家风控</h1>
      <p style={{ margin: '6px 0 0', fontSize: 13.5, color: COLORS.textMuted }}>跨商家风险告警汇总与处置</p>
    </div>
  )
}

function OverviewRow({ overview }) {
  const cards = [
    { label: '待处理告警', value: overview.pending },
    { label: '高风险商家数', value: overview.highRiskMerchants },
    { label: '今日拦截', value: overview.blockedToday },
  ]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md }}>
      {cards.map((k) => (
        <KpiCard key={k.label} label={k.label} value={String(k.value)} />
      ))}
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

function FilterRow({ level, onLevel, tenants, tenantId, onTenant }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: SPACE.sm }}>
        {LEVEL_OPTIONS.map((o) => {
          const active = level === o.key
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onLevel(o.key)}
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
      <select value={tenantId} onChange={(e) => onTenant(e.target.value)} style={selectStyle}>
        <option value="all">全部商家</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  )
}

const COLUMNS = [
  { key: 'time', label: '时间', render: (r) => <span style={{ color: COLORS.textMuted, whiteSpace: 'nowrap' }}>{formatTime(r.time)}</span> },
  { key: 'merchant', label: '商家', render: (r) => <strong style={{ color: COLORS.text, fontWeight: 600 }}>{r.merchant}</strong> },
  { key: 'type', label: '风险类型', render: (r) => <Badge meta={RISK_TYPE[r.type]} /> },
  { key: 'level', label: '等级', render: (r) => <Badge meta={RISK_LEVEL[r.level]} /> },
  { key: 'status', label: '状态', render: (r) => <Badge meta={RISK_STATUS[r.status]} /> },
  {
    key: 'ops',
    label: '操作',
    render: () => (
      <button
        type="button"
        onClick={() => {}}
        style={{
          padding: '4px 10px',
          fontSize: 12.5,
          fontWeight: 600,
          color: COLORS.textMuted,
          background: 'transparent',
          border: `1px solid ${COLORS.border}`,
          borderRadius: 6,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        查看
      </button>
    ),
  },
]

export default function RiskPage() {
  const [tenants, setTenants] = useState([])
  const [level, setLevel] = useState('all')
  const [tenantId, setTenantId] = useState('all')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listTenants().then((r) => setTenants(r.items || [])).catch(() => setTenants([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await getRisk({ level, tenantId }))
    } catch (err) {
      setError(err.message || '加载失败')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [level, tenantId])

  useEffect(() => { load() }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
      <PageHeader />
      {data && <OverviewRow overview={data.overview} />}
      <FilterRow level={level} onLevel={setLevel} tenants={tenants} tenantId={tenantId} onTenant={setTenantId} />

      {error ? (
        <EmptyState text={error} />
      ) : loading || !data ? (
        <EmptyState text="加载中…" />
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: COLORS.textFaint }}>共 {data.items.length} 条</div>
          <DataTable columns={COLUMNS} rows={data.items} rowKey="id" emptyText="没有符合条件的告警" />
        </>
      )}
    </div>
  )
}
