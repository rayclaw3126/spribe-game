// 系统问题页的控件条：状态 tab / 筛选行 / 分页。抽出来让主页面保持精简。
import { COLORS, RADIUS, SPACE } from '../../theme/tokens.js'
import { STATUS_TABS, PRIORITY_META } from '../../data/issues.js'
import Icon from '../Icon.jsx'

export function StatusTabs({ active, counts, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
      {STATUS_TABS.map((tab) => {
        const selected = active === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            style={{
              padding: '7px 14px',
              fontSize: 13.5,
              fontWeight: selected ? 600 : 500,
              color: selected ? COLORS.white : COLORS.textMuted,
              background: selected ? '#2f6fe0' : '#1a2230',
              border: 'none',
              borderRadius: RADIUS.sm,
              cursor: 'pointer',
            }}
          >
            {tab.label} {counts[tab.key] ?? 0}
          </button>
        )
      })}
    </div>
  )
}

export function FilterRow({ search, onSearch, priority, onPriority }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md, alignItems: 'center' }}>
      <div style={{ position: 'relative', flex: '1 1 280px', minWidth: 220 }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}>
          <Icon name="search" size={16} color={COLORS.textFaint} />
        </span>
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="搜索标题或描述（全库）…"
          style={{
            width: '100%',
            padding: '9px 10px 9px 34px',
            fontSize: 13.5,
            color: COLORS.text,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: RADIUS.sm,
            outline: 'none',
          }}
        />
      </div>
      <select
        value={priority}
        onChange={(e) => onPriority(e.target.value)}
        style={{
          padding: '9px 12px',
          fontSize: 13.5,
          color: COLORS.text,
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADIUS.sm,
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        <option value="all">全部优先级</option>
        {Object.entries(PRIORITY_META).map(([key, m]) => (
          <option key={key} value={key}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Pagination({ total, page = 1, pageSize = 20, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: SPACE.md,
        paddingTop: SPACE.sm,
      }}
    >
      <span style={{ fontSize: 12.5, color: COLORS.textFaint }}>
        共 {total} 条 · 每页 {pageSize} 条
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => {
          const active = p === page
          return (
            <button
              key={p}
              type="button"
              onClick={() => onPage && onPage(p)}
              style={{
                minWidth: 30,
                height: 30,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                color: active ? COLORS.white : COLORS.textMuted,
                background: active ? '#2f6fe0' : COLORS.surface,
                border: `1px solid ${active ? '#2f6fe0' : COLORS.border}`,
                borderRadius: RADIUS.sm,
                cursor: active ? 'default' : 'pointer',
              }}
            >
              {p}
            </button>
          )
        })}
      </div>
    </div>
  )
}
