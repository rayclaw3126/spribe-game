import { MULTI_DARK as M } from '../shell/tokens'
import { nameOfBackend } from './mockData'

// #41 单9：平台内广播·跑马灯横滚条（纯显示层，只读 /player/bigwins.marquee）。
// 每条 = 游戏名 · 脱敏名 · +$X · 倍数（无倍数则省）；自己爆中(mine)高亮金。
// 无数据整条隐藏（由父组件按 items.length 决定不挂载）。CSS translateX 无限横滚，
// 内容复制两份接缝无跳；条数越多总宽越长、周期越长（速度恒定）。
// 单份滚动内容（复制两份接缝无跳）；tag 区分 key 前缀 + 无障碍隐藏副本。
function MarqueeRow({ items, tag, ariaHidden }) {
  return (
    <div aria-hidden={ariaHidden} style={{ display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' }}>
      {items.map((it, i) => (
        <span key={tag + i} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 18px',
          borderRight: `1px solid ${M.line}`, whiteSpace: 'nowrap',
          color: it.mine ? M.amount : M.txtDim, fontWeight: it.mine ? 900 : 700, fontSize: 12,
        }}>
          {it.mine && <span style={{ color: M.amount }}>★</span>}
          <span style={{ color: it.mine ? M.amount : M.txt }}>{nameOfBackend(it.game)}</span>
          <span style={{ color: M.txtMute }}>{it.name}</span>
          <span style={{ color: M.betting, fontWeight: 900 }}>+${Number(it.payout).toFixed(2)}</span>
          {it.mult != null && <span style={{ color: M.locked, fontWeight: 800 }}>{Number(it.mult).toFixed(2)}×</span>}
        </span>
      ))}
    </div>
  )
}

export default function BigWinMarquee({ items }) {
  if (!items || items.length === 0) return null
  const dur = Math.max(18, items.length * 4)   // ~4s/条，最短 18s
  return (
    <div style={{
      overflow: 'hidden', whiteSpace: 'nowrap', background: M.panel,
      borderBottom: `1px solid ${M.line}`, padding: '6px 0',
    }}>
      <style>{`@keyframes bwMarquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }`}</style>
      <div style={{ display: 'inline-flex', animation: `bwMarquee ${dur}s linear infinite`, willChange: 'transform' }}>
        <MarqueeRow items={items} tag="a" ariaHidden={false} />
        <MarqueeRow items={items} tag="b" ariaHidden={true} />
      </div>
    </div>
  )
}
