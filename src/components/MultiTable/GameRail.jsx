import { MULTI_DARK as M } from '../shell/tokens'
import { RAIL_GROUPS, FAV_IDS, MOCK, nameOf } from './mockData'

// 相位点色（与 TableCard 同口径，走 MULTI_DARK 三态色）
const DOT = { betting: M.betting, locked: M.locked, drawing: M.drawing }

// 单行：相位点 + 名（可带 ★）+ 假倒计时。在桌款左绿边高亮。
function RailRow({ id, active, star, onSelect }) {
  const m = MOCK[id]
  return (
    <button type="button" onClick={() => onSelect(id)} style={{
      position: 'relative', width: '100%',
      display: 'flex', alignItems: 'center', gap: 7,
      background: active ? M.cardHi : 'transparent', border: 'none',
      borderRadius: 8, padding: '8px 8px 8px 12px', margin: '1px 0', cursor: 'pointer',
      textAlign: 'left',
    }}>
      {active && <span style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 2, borderRadius: 2, background: M.accent }} />}
      <span style={{ flex: '0 0 auto', width: 6, height: 6, borderRadius: '50%', background: DOT[m.phase] || M.txtMute }} />
      <span style={{
        flex: 1, minWidth: 0, color: active ? M.txt : M.txtDim,
        fontSize: 12, fontWeight: active ? 800 : 600,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{star && <span style={{ color: M.amount, marginRight: 3 }}>★</span>}{nameOf(id)}</span>
      <span style={{ flex: '0 0 auto', color: M.txtMute, fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{m.cd}</span>
    </button>
  )
}

// 左列上半·可滚游戏栏：顶「我的最爱」占位分组（★ 假收藏 2 款）+ 三分组（竞速PK/轮次彩/对决）。
// 在桌 4 款左绿边高亮；点未上桌款 → onSelect(id) 由上层做「替换最老桌」。全静态。
export default function GameRail({ tables, onSelect }) {
  const onTable = new Set(tables)
  return (
    <aside style={{
      flex: '1 1 auto', width: '100%', minHeight: 0,
      background: M.panel, border: `1px solid ${M.line}`, borderRadius: 12,
      padding: 6, overflowY: 'auto',
    }}>
      {/* 我的最爱（占位）：标题右侧灰小字「大厅 ☆ 收藏」，纯静态不折叠 */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '6px 8px 4px' }}>
          <span style={{ color: M.txtMute, fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>我的最爱</span>
          <span style={{ color: M.txtMute, fontSize: 9, fontWeight: 600, opacity: 0.7 }}>大厅 ☆ 收藏</span>
        </div>
        {FAV_IDS.map(id => (
          <RailRow key={`fav-${id}`} id={id} star active={onTable.has(id)} onSelect={onSelect} />
        ))}
      </div>

      {RAIL_GROUPS.map(grp => (
        <div key={grp.key} style={{ marginBottom: 8 }}>
          <div style={{ color: M.txtMute, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, padding: '6px 8px 4px' }}>{grp.label}</div>
          {grp.ids.map(id => (
            <RailRow key={id} id={id} active={onTable.has(id)} onSelect={onSelect} />
          ))}
        </div>
      ))}
    </aside>
  )
}
