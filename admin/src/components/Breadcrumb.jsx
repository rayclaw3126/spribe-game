import { COLORS } from '../theme/tokens.js'
import { useAgentTree } from '../state/AgentContext.jsx'

export default function Breadcrumb() {
  const { chain, drillToIndex } = useAgentTree()

  return (
    <nav aria-label="代理层级面包屑" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      {chain.map((node, index) => {
        const isLast = index === chain.length - 1
        const label = index === 0 ? '我' : node.username
        return (
          <span key={`${node.id}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {index > 0 && <span style={{ color: COLORS.textFaint, fontSize: 13 }}>/</span>}
            <button
              type="button"
              onClick={() => drillToIndex(index)}
              disabled={isLast}
              style={{
                background: 'none',
                border: 'none',
                padding: '2px 4px',
                fontSize: 14,
                fontWeight: isLast ? 600 : 500,
                color: isLast ? COLORS.text : COLORS.primary,
                cursor: isLast ? 'default' : 'pointer',
                textDecoration: isLast ? 'none' : 'none',
              }}
            >
              {label}
            </button>
          </span>
        )
      })}
    </nav>
  )
}
