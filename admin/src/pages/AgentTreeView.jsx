// 代理树视图：面包屑下钻 + 当前焦点层 4 个 KPI + 分账演示条。
import { COLORS, SPACE } from '../theme/tokens.js'
import { useAgentTree } from '../state/AgentContext.jsx'
import Breadcrumb from '../components/Breadcrumb.jsx'
import KpiCard from '../components/KpiCard.jsx'
import SplitDemoBar from '../components/SplitDemoBar.jsx'
import DataTable from '../components/DataTable.jsx'
import EmptyState from '../components/EmptyState.jsx'

function formatCredit(value) {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  return Number.isFinite(n) ? `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(value)
}

function formatPct(value) {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  return Number.isFinite(n) ? `${n}%` : String(value)
}

export default function AgentTreeView() {
  const { loading, error, focus, focusView, drillInto, refresh } = useAgentTree()

  if (loading) {
    return <div style={{ color: COLORS.textMuted, fontSize: 14 }}>正在加载代理数据…</div>
  }

  if (error) {
    return (
      <div
        style={{
          color: COLORS.danger,
          background: COLORS.dangerTint,
          border: '1px solid rgba(226,86,74,0.35)',
          borderRadius: 8,
          padding: SPACE.lg,
          fontSize: 13.5,
        }}
      >
        {error}
        <button
          type="button"
          onClick={refresh}
          style={{
            marginLeft: 12,
            background: 'none',
            border: `1px solid ${COLORS.border}`,
            color: COLORS.text,
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          重试
        </button>
      </div>
    )
  }

  if (!focusView) return null

  const childAgents = focusView.rows.filter((r) => r.kind === 'agent')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}>
      <div>
        <Breadcrumb />
        <h1 style={{ fontSize: 20, fontWeight: 600, color: COLORS.text, margin: '10px 0 2px' }}>
          {focus.id === undefined ? '' : focusView.isSelf ? '我的代理树' : `${focus.username} 的下级视角`}
        </h1>
        <div style={{ fontSize: 13, color: COLORS.textFaint }}>
          点击面包屑可回退层级；点击下方"进入"可下钻到该代理视角。
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md }}>
        <KpiCard
          label="手上额度"
          value={formatCredit(focusView.credit)}
          hint={
            focusView.isSelf
              ? focusView.creditAvailable && focusView.credit !== null
                ? '来自 /agent/me 的真实额度'
                : '暂无授信'
              : '来自 /agent/tree 的真实额度'
          }
        />
        <KpiCard
          label="下线数"
          value={focusView.downlineCount}
          hint={
            focusView.downlineComplete
              ? '含代理与玩家，来自 /agent/downline 的真实计数'
              : '仅统计直属代理（该层玩家不可见，属接口限制）'
          }
        />
        {focusView.isSelf ? (
          <KpiCard label="占成%" value={formatPct(focusView.winLossPct)} hint="来自 /agent/me 的真实占成比例" />
        ) : (
          <KpiCard label="占成%" value="30%" placeholder hint="示例值，真实占成规则待单6接口" />
        )}
        <KpiCard label="今日分成" value="¥ 128.50" placeholder hint="示例值，聚合分成接口待单6期" />
      </div>

      <SplitDemoBar />

      <div>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: COLORS.text, marginBottom: SPACE.sm }}>
          直属代理下级
        </div>
        {childAgents.length === 0 ? (
          <EmptyState text="当前层级下暂无直属代理" />
        ) : (
          <DataTable
            columns={[
              { key: 'username', label: '用户名' },
              { key: 'level', label: '层级' },
              { key: 'credit', label: '额度', render: (row) => formatCredit(row.credit) },
              {
                key: 'action',
                label: '操作',
                render: (row) => (
                  <button
                    type="button"
                    onClick={() => drillInto(row)}
                    style={{
                      padding: '5px 12px',
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: COLORS.primary,
                      background: COLORS.primarySoft,
                      border: `1px solid ${COLORS.primaryBorder}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >
                    进入
                  </button>
                ),
              },
            ]}
            rows={childAgents}
          />
        )}
      </div>
    </div>
  )
}
