// 通用数据表格：columns = [{ key, label, render?(row) }]。
// 移动端外层横向滚动，避免挤压/换行错乱；不做"转卡片"以保持表头对齐语义。
import { COLORS, RADIUS } from '../theme/tokens.js'
import EmptyState from './EmptyState.jsx'

export default function DataTable({ columns, rows, rowKey = 'id', emptyText = '暂无数据' }) {
  if (!rows || rows.length === 0) {
    return <EmptyState text={emptyText} />
  }

  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.md }}>
      <table style={{ width: '100%', minWidth: 560, fontSize: 13.5 }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  textAlign: col.align || 'left',
                  padding: '10px 14px',
                  color: COLORS.textMuted,
                  fontWeight: 500,
                  fontSize: 12.5,
                  borderBottom: `1px solid ${COLORS.border}`,
                  background: COLORS.panel,
                  whiteSpace: 'nowrap',
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[rowKey]} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  style={{
                    padding: '10px 14px',
                    color: COLORS.text,
                    textAlign: col.align || 'left',
                    verticalAlign: 'middle',
                  }}
                >
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
