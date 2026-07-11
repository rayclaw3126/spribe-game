// 跨商家风控（本单纯 UI + 假数据，不接后端）。页头/概览/筛选/表格照 FeesPage + MerchantsPage 深蓝专业风。
// 等级/商家做前端筛选（轻量）；「查看」本单先留空。接真那单聚合风控信号。
import { useMemo, useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { RISK_MERCHANTS, LEVEL_OPTIONS, OVERVIEW, RISK_TYPE, RISK_LEVEL, RISK_STATUS, RISK_ROWS } from '../data/risk.js'
import KpiCard from '../components/KpiCard.jsx'
import DataTable from '../components/DataTable.jsx'

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
      <p style={{ margin: '6px 0 0', fontSize: 13.5, color: COLORS.textMuted }}>
        跨商家风险告警汇总与处置（示例数据）
      </p>
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

function FilterRow({ level, onLevel, merchant, onMerchant }) {
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
      <select value={merchant} onChange={(e) => onMerchant(e.target.value)} style={selectStyle}>
        <option value="all">全部商家</option>
        {RISK_MERCHANTS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  )
}

const COLUMNS = [
  { key: 'time', label: '时间', render: (r) => <span style={{ color: COLORS.textMuted, whiteSpace: 'nowrap' }}>{r.time}</span> },
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
  const [level, setLevel] = useState('all')
  const [merchant, setMerchant] = useState('all')

  const rows = useMemo(
    () =>
      RISK_ROWS.filter(
        (r) => (level === 'all' || r.level === level) && (merchant === 'all' || r.merchant === merchant)
      ),
    [level, merchant]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
      <PageHeader />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md }}>
        {OVERVIEW.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} />
        ))}
      </div>
      <FilterRow level={level} onLevel={setLevel} merchant={merchant} onMerchant={setMerchant} />
      <div style={{ fontSize: 12.5, color: COLORS.textFaint }}>共 {rows.length} 条</div>
      <DataTable columns={COLUMNS} rows={rows} rowKey="id" emptyText="没有符合条件的告警" />
    </div>
  )
}
