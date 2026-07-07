// 下级列表：代理 + 玩家混显。代理行可"进入"下钻；玩家行的上下分操作占位(单6)。
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { useAgentTree } from '../state/AgentContext.jsx'
import Breadcrumb from '../components/Breadcrumb.jsx'
import DataTable from '../components/DataTable.jsx'
import PlaceholderBadge from '../components/PlaceholderBadge.jsx'
import CreateAgentInline from '../components/CreateAgentInline.jsx'

const STATUS_LABEL = {
  active: '正常',
  inactive: '停用',
  disabled: '停用',
  suspended: '冻结',
}

function statusLabel(status) {
  if (!status) return '—'
  return STATUS_LABEL[status] || status
}

function kindLabel(kind) {
  return kind === 'agent' ? '代理' : '玩家'
}

function formatAmount(value) {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value)
}

export default function DownlineList() {
  const { loading, error, focus, focusView, drillInto } = useAgentTree()

  if (loading) {
    return <div style={{ color: COLORS.textMuted, fontSize: 14 }}>正在加载下级数据…</div>
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
      </div>
    )
  }

  if (!focusView) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <div>
        <Breadcrumb />
        <h1 style={{ fontSize: 20, fontWeight: 600, color: COLORS.text, margin: '10px 0 2px' }}>
          {focusView.isSelf ? '我的下级' : `${focus.username} 的下级`}
        </h1>
      </div>

      {focusView.isSelf && <CreateAgentInline />}

      {!focusView.downlineComplete && (
        <div
          style={{
            fontSize: 12.5,
            color: COLORS.textMuted,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: RADIUS.sm,
            padding: '8px 12px',
          }}
        >
          说明：后端下级查询接口只返回登录代理本人的直属下级，因此下钻到非自己节点时，
          这里只能展示其直属代理下级，该层的玩家暂不可见（接口限制，非故障）。
        </div>
      )}

      <DataTable
        emptyText="当前层级下暂无下级"
        columns={[
          { key: 'username', label: '用户名' },
          { key: 'kind', label: '类型', render: (row) => kindLabel(row.kind) },
          { key: 'level', label: '层级', render: (row) => row.level ?? '—' },
          {
            key: 'amount',
            label: '额度 / 余额',
            render: (row) => (row.kind === 'agent' ? formatAmount(row.credit) : formatAmount(row.balance)),
          },
          {
            key: 'action',
            label: '操作',
            render: (row) =>
              row.kind === 'agent' ? (
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
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    disabled
                    style={{
                      padding: '5px 12px',
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: COLORS.textFaint,
                      background: 'transparent',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 6,
                      cursor: 'not-allowed',
                    }}
                  >
                    上下分
                  </button>
                  <PlaceholderBadge text="单6" />
                </span>
              ),
          },
        ]}
        rows={focusView.rows}
      />
    </div>
  )
}
