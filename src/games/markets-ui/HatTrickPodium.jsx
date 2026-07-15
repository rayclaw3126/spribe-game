// #41 单15：HatTrick 上局信息条（上期三骰迷你面 + 近5期和值串 + 上局和值/豹子徽标）——
// 从 HatTrick.jsx subRowNode 机械切片（顶栏 subRow 槽 / 多桌卡头行内复用）。
// props {lastRoll,recent,isMobile,inline}：lastRoll = deriveRoll 派生对象（dice/isTriple/tripleFace/total）；
// recent = 近5期和值（新→旧）。default（非 inline）= 原页 subRow 逐字节；inline 紧排卡头（GoldenBootPodium 口径）。
import { HATTRICK, RADIUS, COLORS } from '../../components/shell/tokens'
import { DieFace } from './HatTrickMarkets'

export default function HatTrickPodium({ lastRoll, recent = [], isMobile = false, inline = false }) {
  if (!lastRoll) return null
  const dieSize = inline ? 14 : (isMobile ? 16 : 18)
  return (
    <span style={{
      display: 'flex', alignItems: 'center', gap: inline ? 5 : 8, flexWrap: inline ? 'nowrap' : 'wrap',
      minWidth: 0, ...(inline ? { flex: '0 1 auto', overflow: 'hidden' } : { flex: '1 1 auto' }),
    }}>
      {/* 上期三骰迷你面（CSS 点阵） */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, ...(inline ? { flex: '0 0 auto' } : {}) }}>
        {lastRoll.dice.map((v, i) => <DieFace key={i} v={v} size={dieSize} />)}
      </span>
      {/* 近 5 期和值小串（新→旧） */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, ...(inline ? { minWidth: 0, overflow: 'hidden' } : {}) }}>
        {recent.map((s, i) => (
          <span key={`${s}-${i}`} style={{
            padding: '1px 7px', borderRadius: RADIUS.pill,
            background: s >= 11 ? HATTRICK.big : HATTRICK.small, color: COLORS.white,
            fontSize: inline ? 8.5 : 9.5, fontWeight: 900, opacity: i === 0 ? 1 : 0.75,
            ...(inline ? { flex: '0 0 auto' } : {}),
          }}>{s}</span>
        ))}
      </span>
      <span style={{
        marginLeft: inline ? 4 : 'auto', padding: '2px 12px', borderRadius: RADIUS.pill,
        background: HATTRICK.gold, color: '#3a2c00', fontSize: inline ? 10 : 12, fontWeight: 900, whiteSpace: 'nowrap',
        ...(inline ? { flex: '0 0 auto' } : {}),
      }}>{lastRoll.isTriple ? `豹子 ${lastRoll.tripleFace}` : `和值 ${lastRoll.total}`}</span>
    </span>
  )
}
