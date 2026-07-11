// 全平台看板（本单纯 UI + 假数据，不接后端）。KPI 卡复用 KpiCard；趋势用内联条形（不引图表库）；
// 排行榜复用 DataTable。页头/配色照 MerchantsPage 深蓝专业风。接真那单换成后端聚合。
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { KPIS, FEE_TREND, RANKING } from '../data/dashboard.js'
import KpiCard from '../components/KpiCard.jsx'
import DataTable from '../components/DataTable.jsx'

function fmtMoney(n) {
  return '¥' + n.toLocaleString('en-US')
}

function PageHeader() {
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: COLORS.text }}>全平台看板</h1>
      <p style={{ margin: '6px 0 0', fontSize: 13.5, color: COLORS.textMuted }}>
        白标平台各商家运营总览（示例数据）
      </p>
    </div>
  )
}

// 近 30 天平台费趋势 —— 内联条形，高度按最大值归一化。
function FeeTrendChart() {
  const max = Math.max(...FEE_TREND)
  return (
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
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>近 30 天平台费趋势</span>
        <span style={{ fontSize: 12, color: COLORS.textFaint }}>峰值 {fmtMoney(max)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 140 }}>
        {FEE_TREND.map((v, i) => (
          <div
            key={i}
            title={fmtMoney(v)}
            style={{
              flex: 1,
              height: `${Math.round((v / max) * 100)}%`,
              background: COLORS.primary,
              borderRadius: 3,
              minWidth: 4,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: COLORS.textFaint }}>
        <span>30 天前</span>
        <span>今天</span>
      </div>
    </div>
  )
}

const RANK_COLUMNS = [
  { key: 'rank', label: '排名', render: (r) => <span style={{ color: COLORS.textMuted }}>{r.rank}</span> },
  { key: 'name', label: '商家名', render: (r) => <strong style={{ color: COLORS.text, fontWeight: 600 }}>{r.name}</strong> },
  { key: 'players', label: '玩家数', align: 'right', render: (r) => r.players.toLocaleString('en-US') },
  { key: 'turnover', label: '流水', align: 'right', render: (r) => fmtMoney(r.turnover) },
  { key: 'fee', label: '平台费', align: 'right', render: (r) => <span style={{ color: COLORS.success }}>{fmtMoney(r.fee)}</span> },
]

function RankingTable() {
  const rows = RANKING.map((r, i) => ({ ...r, rank: i + 1 }))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>商家排行榜（Top 5）</span>
      <DataTable columns={RANK_COLUMNS} rows={rows} rowKey="name" />
    </div>
  )
}

export default function DashboardPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
      <PageHeader />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md }}>
        {KPIS.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} />
        ))}
      </div>
      <FeeTrendChart />
      <RankingTable />
    </div>
  )
}
