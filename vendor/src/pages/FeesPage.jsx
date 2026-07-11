// 平台费流水（本单纯 UI + 假数据，不接后端）。页头/筛选/表格照 MerchantsPage 深蓝专业风。
// 商家下拉做前端筛选（轻量），时间范围本单纯 UI（不真过滤时间）。接真那单聚合 commissions/ledger。
import { useMemo, useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { FEE_MERCHANTS, RANGE_OPTIONS, SUMMARY, TYPE_META, FEE_STATUS, FEE_ROWS } from '../data/fees.js'
import DataTable from '../components/DataTable.jsx'

const TONE_COLOR = {
  primary: { color: COLORS.primary, bg: COLORS.primarySoft },
  muted: { color: COLORS.textMuted, bg: COLORS.surface },
  success: { color: COLORS.success, bg: COLORS.successTint },
  warning: { color: COLORS.warning, bg: COLORS.warningTint },
}

function fmtMoney(n) {
  return '¥' + n.toLocaleString('en-US')
}

function Badge({ meta }) {
  if (!meta) return null
  const c = TONE_COLOR[meta.tone]
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
      <p style={{ margin: '6px 0 0', fontSize: 13.5, color: COLORS.textMuted }}>
        各商家平台费入账与结算明细（示例数据）
      </p>
    </div>
  )
}

// 汇总条：本月平台费合计 + 笔数。
function SummaryBar() {
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
          {fmtMoney(SUMMARY.feeTotal)}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12.5, color: COLORS.textMuted }}>本月笔数</span>
        <span style={{ fontSize: 22, fontWeight: 600, color: COLORS.text, fontVariantNumeric: 'tabular-nums' }}>
          {SUMMARY.count}
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

function FilterRow({ merchant, onMerchant, range, onRange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md, alignItems: 'center' }}>
      <select value={merchant} onChange={(e) => onMerchant(e.target.value)} style={selectStyle}>
        <option value="all">全部商家</option>
        {FEE_MERCHANTS.map((m) => (
          <option key={m} value={m}>
            {m}
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
  { key: 'time', label: '时间', render: (r) => <span style={{ color: COLORS.textMuted, whiteSpace: 'nowrap' }}>{r.time}</span> },
  { key: 'merchant', label: '商家', render: (r) => <strong style={{ color: COLORS.text, fontWeight: 600 }}>{r.merchant}</strong> },
  { key: 'type', label: '类型', render: (r) => <Badge meta={TYPE_META[r.type]} /> },
  { key: 'turnover', label: '流水金额', align: 'right', render: (r) => fmtMoney(r.turnover) },
  { key: 'fee', label: '平台费', align: 'right', render: (r) => <span style={{ color: COLORS.success }}>{fmtMoney(r.fee)}</span> },
  { key: 'status', label: '状态', render: (r) => <Badge meta={FEE_STATUS[r.status]} /> },
]

export default function FeesPage() {
  const [merchant, setMerchant] = useState('all')
  const [range, setRange] = useState('month')

  // 商家前端筛选；时间范围本单纯 UI（不过滤）。
  const rows = useMemo(
    () => (merchant === 'all' ? FEE_ROWS : FEE_ROWS.filter((r) => r.merchant === merchant)),
    [merchant]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
      <PageHeader />
      <SummaryBar />
      <FilterRow merchant={merchant} onMerchant={setMerchant} range={range} onRange={setRange} />
      <div style={{ fontSize: 12.5, color: COLORS.textFaint }}>共 {rows.length} 条</div>
      <DataTable columns={COLUMNS} rows={rows} rowKey="id" emptyText="该商家暂无流水" />
    </div>
  )
}
