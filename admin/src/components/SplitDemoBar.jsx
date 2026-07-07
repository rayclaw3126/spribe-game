// 分账演示条（B版）：按当前面包屑链条(自己 → 焦点代理)套用示例占成，
// 复现"玩家输 X 元 → 链上各级分别得多少"的算法 B。纯前端演示计算，
// 占成比例是写死的示例值，不代表真实业务占成（后端暂无占成接口）。
import { useMemo, useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import PlaceholderBadge from './PlaceholderBadge.jsx'
import { useAgentTree } from '../state/AgentContext.jsx'

// 不同链长下的示例占成表（由上至下：越靠近顶层拿得越多）。仅用于演示，
// 链长超出表范围时按均分兜底。
const PERCENT_TABLE = {
  1: [100],
  2: [70, 30],
  3: [60, 30, 10],
  4: [50, 30, 15, 5],
  5: [45, 25, 15, 10, 5],
}

function splitPercents(n) {
  if (PERCENT_TABLE[n]) return PERCENT_TABLE[n]
  const even = Math.floor(100 / n)
  const arr = new Array(n).fill(even)
  arr[0] += 100 - even * n
  return arr
}

export default function SplitDemoBar() {
  const { chain } = useAgentTree()
  const [amountInput, setAmountInput] = useState('1000')
  const [computed, setComputed] = useState(null)

  const percents = useMemo(() => splitPercents(chain.length), [chain.length])

  function handleCompute(e) {
    e.preventDefault()
    const amount = Number(amountInput)
    if (!Number.isFinite(amount) || amount <= 0) {
      setComputed(null)
      return
    }
    const rows = chain.map((node, index) => ({
      id: node.id,
      username: index === 0 ? `${node.username}（我）` : node.username,
      percent: percents[index],
      share: (amount * percents[index]) / 100,
    }))
    setComputed({ amount, rows })
  }

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: COLORS.text }}>分账演示（算法 B）</div>
        <PlaceholderBadge text="演示计算 · 非真实占成" />
      </div>

      <form onSubmit={handleCompute} style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flex: '1 1 220px' }}>
          <span style={{ fontSize: 13, color: COLORS.textMuted, whiteSpace: 'nowrap' }}>玩家输（元）</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="请输入金额"
            style={{
              flex: 1,
              padding: '8px 10px',
              fontSize: 14,
              color: COLORS.text,
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: RADIUS.sm,
              outline: 'none',
              minWidth: 0,
            }}
          />
        </label>
        <button
          type="submit"
          style={{
            padding: '8px 18px',
            fontSize: 13.5,
            fontWeight: 600,
            color: '#fff',
            background: COLORS.primary,
            border: 'none',
            borderRadius: RADIUS.sm,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          按当前链路计算
        </button>
      </form>

      {computed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {computed.rows.map((row) => (
            <div
              key={row.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: COLORS.surface,
                borderRadius: RADIUS.sm,
                fontSize: 13.5,
              }}
            >
              <span style={{ color: COLORS.text }}>
                {row.username} <span style={{ color: COLORS.textFaint }}>（占 {row.percent}%）</span>
              </span>
              <span style={{ color: COLORS.success, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                得 {row.share.toFixed(2)} 元
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
