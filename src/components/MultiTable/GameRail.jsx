import { MULTI_DARK as M } from '../shell/tokens'
import { RAIL_GROUPS, FAV_IDS, nameOf, nameOfBackend } from './mockData'

// 今日大奖榜块（只读 /player/bigwins.top）：Top5 行 名/游戏/金额；空态由父级 top.length 决定不挂载。
// 自己上榜(mine)高亮金。挂在左栏「对决」组之下。
function TopBoard({ top }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: M.amount, fontSize: 10, fontWeight: 900, letterSpacing: 0.5, padding: '6px 8px 4px' }}>今日大奖</div>
      {top.map((it, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px 5px 12px',
          borderRadius: 8, margin: '1px 0', background: it.mine ? M.cardHi : 'transparent',
        }}>
          <span style={{ flex: '0 0 auto', width: 16, color: i < 3 ? M.amount : M.txtMute, fontSize: 11, fontWeight: 900, textAlign: 'center' }}>{i + 1}</span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span style={{ color: it.mine ? M.amount : M.txt, fontSize: 11, fontWeight: it.mine ? 900 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {it.mine && <span style={{ marginRight: 3 }}>★</span>}{it.name}
            </span>
            <span style={{ color: M.txtMute, fontSize: 9, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOfBackend(it.game)}</span>
          </span>
          <span style={{ flex: '0 0 auto', color: M.betting, fontSize: 11, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>+${Number(it.payout).toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}

// room.phase → 相位点色（与 TableCard 同口径）
const dotColor = (phase) => (
  phase === 'betting' ? M.betting
    : phase === 'locked' ? M.locked
      : (phase === 'drawn' || phase === 'settled') ? M.drawing
        : M.txtMute
)
// 右侧小字：betting/idle 走倒计时 mm:ss，其余走相位短字
const fmtMs = (ms) => {
  const s = Math.max(0, Math.round((ms || 0) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
function railTail(room) {
  if (!room) return '…'
  if (room.phase === 'betting' || room.phase === 'idle') return room.countdownMs > 0 ? fmtMs(room.countdownMs) : '—'
  if (room.phase === 'locked') return '封'
  if (room.phase === 'drawn' || room.phase === 'settled') return '开'
  return '…'
}

// 单行：相位点 + 名（可带 ★）+ 实时倒计时/相位。在桌款左绿边高亮。
function RailRow({ id, room, active, star, onSelect }) {
  return (
    <button type="button" onClick={() => onSelect(id)} style={{
      position: 'relative', width: '100%', display: 'flex', alignItems: 'center', gap: 7,
      background: active ? M.cardHi : 'transparent', border: 'none',
      borderRadius: 8, padding: '8px 8px 8px 12px', margin: '1px 0', cursor: 'pointer', textAlign: 'left',
    }}>
      {active && <span style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 2, borderRadius: 2, background: M.accent }} />}
      <span style={{ flex: '0 0 auto', width: 6, height: 6, borderRadius: '50%', background: dotColor(room?.phase) }} />
      <span style={{
        flex: 1, minWidth: 0, color: active ? M.txt : M.txtDim, fontSize: 12, fontWeight: active ? 800 : 600,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{star && <span style={{ color: M.amount, marginRight: 3 }}>★</span>}{nameOf(id)}</span>
      <span style={{
        flex: '0 0 auto', fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        // 最后 5 秒（betting/idle 且 ≤5000ms）转红
        color: room && (room.phase === 'betting' || room.phase === 'idle') && room.countdownMs > 0 && room.countdownMs <= 5000 ? M.danger : M.txtMute,
      }}>{railTail(room)}</span>
    </button>
  )
}

// 左列上半·可滚游戏栏：顶「我的最爱」占位 + 三分组（竞速PK/轮次彩/对决）。相位点+倒计时全接活。
export default function GameRail({ tables, onSelect, rooms, top }) {
  const onTable = new Set(tables)
  return (
    <aside style={{
      flex: '1 1 auto', width: '100%', minHeight: 0,
      background: M.panel, border: `1px solid ${M.line}`, borderRadius: 12, padding: 6, overflowY: 'auto',
    }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '6px 8px 4px' }}>
          <span style={{ color: M.txtMute, fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>我的最爱</span>
          <span style={{ color: M.txtMute, fontSize: 9, fontWeight: 600, opacity: 0.7 }}>大厅 ☆ 收藏</span>
        </div>
        {FAV_IDS.map(id => (
          <RailRow key={`fav-${id}`} id={id} room={rooms?.[id]} star active={onTable.has(id)} onSelect={onSelect} />
        ))}
      </div>

      {RAIL_GROUPS.map(grp => (
        <div key={grp.key} style={{ marginBottom: 8 }}>
          <div style={{ color: M.txtMute, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, padding: '6px 8px 4px' }}>{grp.label}</div>
          {grp.ids.map(id => (
            <RailRow key={id} id={id} room={rooms?.[id]} active={onTable.has(id)} onSelect={onSelect} />
          ))}
        </div>
      ))}

      {top && top.length > 0 && <TopBoard top={top} />}
    </aside>
  )
}
