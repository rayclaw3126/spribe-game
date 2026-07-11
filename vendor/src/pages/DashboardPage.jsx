// 全平台看板（接后端 GET /dashboard/stats）。KPI 卡复用 KpiCard；趋势内联条形；排行榜复用 DataTable。
// loading/错误态照 SystemIssuesPage。平台费 = commissions type='platform_fee' 聚合（后端口径）。
import { useCallback, useEffect, useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { getDashboardStats } from '../api/client.js'
import KpiCard from '../components/KpiCard.jsx'
import DataTable from '../components/DataTable.jsx'
import EmptyState from '../components/EmptyState.jsx'

function fmtMoney(n) {
  return '¥' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtInt(n) {
  return Number(n).toLocaleString('en-US')
}

function PageHeader() {
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: COLORS.text }}>全平台看板</h1>
      <p style={{ margin: '6px 0 0', fontSize: 13.5, color: COLORS.textMuted }}>白标平台各商家运营总览</p>
    </div>
  )
}

function KpiRow({ kpis }) {
  const cards = [
    { label: '商家总数', value: fmtInt(kpis.merchantsTotal) },
    { label: '启用商家', value: fmtInt(kpis.merchantsActive) },
    { label: '总玩家数', value: fmtInt(kpis.playersTotal) },
    { label: '平台费累计', value: fmtMoney(kpis.feeTotal) },
  ]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md }}>
      {cards.map((k) => (
        <KpiCard key={k.label} label={k.label} value={k.value} />
      ))}
    </div>
  )
}

function FeeTrendChart({ trend }) {
  const values = trend.map((t) => t.fee)
  const max = Math.max(1, ...values)
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
        {values.map((v, i) => (
          <div
            key={i}
            title={fmtMoney(v)}
            style={{ flex: 1, height: `${Math.round((v / max) * 100)}%`, background: COLORS.primary, borderRadius: 3, minWidth: 4 }}
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
  { key: 'players', label: '玩家数', align: 'right', render: (r) => fmtInt(r.players) },
  { key: 'turnover', label: '流水', align: 'right', render: (r) => fmtMoney(r.turnover) },
  { key: 'fee', label: '平台费', align: 'right', render: (r) => <span style={{ color: COLORS.success }}>{fmtMoney(r.fee)}</span> },
]

function RankingTable({ ranking }) {
  const rows = ranking.map((r, i) => ({ ...r, rank: i + 1 }))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>商家排行榜（Top 5）</span>
      <DataTable columns={RANK_COLUMNS} rows={rows} rowKey="id" emptyText="暂无数据" />
    </div>
  )
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setStats(await getDashboardStats())
    } catch (err) {
      setError(err.message || '加载失败')
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
      <PageHeader />
      {error ? (
        <EmptyState text={error} />
      ) : loading || !stats ? (
        <EmptyState text="加载中…" />
      ) : (
        <>
          <KpiRow kpis={stats.kpis} />
          <FeeTrendChart trend={stats.trend} />
          <RankingTable ranking={stats.ranking} />
        </>
      )}
    </div>
  )
}
