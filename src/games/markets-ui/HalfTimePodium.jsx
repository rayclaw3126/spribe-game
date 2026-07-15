// #41 单15：HalfTime 上局信息条（20 球两行×10 + 和值 pill）——从 HalfTime.jsx subRowNode 机械切片。
// props {lastDraw,isMobile,inline}：lastDraw = { balls:[..20], sum }（上局开奖）。
// inline（多桌卡头行内紧凑，照 GoldenBootPodium 先例）：球缩小、和值 pill 收窄，nowrap 不换行。
// 原页 GameTopBar subRow 槽复用；视觉逐字节搬（默认态与原 subRowNode 分毫不变）。
import { COLORS, RADIUS, HALFTIME } from '../../components/shell/tokens'

export default function HalfTimePodium({ lastDraw, isMobile = false, inline = false }) {
  const balls = lastDraw?.balls ?? []
  const ballSz = inline ? 12 : (isMobile ? 15 : 17)
  // 多桌卡头行内：20 球太宽撑爆头行 → 只显门控的和值 pill（20 球在舞台/底部路子墙已见）
  if (inline) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', flex: '0 1 auto', minWidth: 0, overflow: 'hidden' }}>
        <span style={{
          padding: '2px 10px', borderRadius: RADIUS.pill, background: HALFTIME.sel,
          color: '#083a1b', fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap',
        }}>和值 {lastDraw?.sum}</span>
      </span>
    )
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: inline ? 6 : 8, flexWrap: 'nowrap', minWidth: 0, flex: '1 1 auto' }}>
      {/* 20 球固定两行×10 对齐（grid，不随 wrap 挤乱） */}
      <span style={{
        display: 'grid', flex: '0 0 auto',
        gridTemplateColumns: `repeat(10, ${ballSz}px)`, gridAutoRows: `${ballSz}px`, gap: 3,
      }}>
        {balls.map((n, i) => (
          <span key={`${n}-${i}`} style={{
            width: ballSz, height: ballSz, borderRadius: '50%',
            background: n > 40 ? HALFTIME.under : HALFTIME.over, color: COLORS.white,
            fontSize: inline ? 6.5 : (isMobile ? 7.5 : 8.5), fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{n}</span>
        ))}
      </span>
      <span style={{
        marginLeft: 'auto', flex: '0 0 auto', padding: inline ? '2px 8px' : '2px 12px', borderRadius: RADIUS.pill,
        background: HALFTIME.sel, color: '#083a1b', fontSize: inline ? 10 : 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>和值 {lastDraw?.sum}</span>
    </span>
  )
}
