// #41 单15：NumberUp 上局信息条（球衣号码卡 + 近 5 期号串 + 号码金牌）——从 NumberUp.jsx subRowNode 机械切片。
// NumberCard（球衣号码小卡）随件外置并 re-export：原页 stageZone 待命大卡 import 回用（跟 GoldenBoot 的 CarImgBead 同套路）。
// props {last,recent,isMobile,inline}：last=上期开出号码(0–49)；recent=近 5 期(新→旧)；
//   inline（多桌卡头行内：紧凑 nowrap，放不下裁近期串，号码金牌必显）——镜像 GoldenBootPodium.inline。
import { COLORS, RADIUS, NUMBERUP } from '../../components/shell/tokens'
import { pad2 } from '../markets/numberup'

// 球衣号码小卡 — 白底圆角卡 + HiLo 同款球衣轮廓 + 两位数号码（逐字节搬）
const JERSEY_PATH = 'M35 6 L20 14 L6 30 L16 42 L26 34 L26 84 L74 84 L74 34 L84 42 L94 30 L80 14 L65 6 C 55 16, 45 16, 35 6 Z'
export function NumberCard({ num, w = 26 }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: w, height: w * 1.18, borderRadius: Math.max(4, w * 0.16),
      background: '#ffffff', border: '1px solid rgba(0,0,0,0.25)',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    }}>
      <svg width={w * 0.8} height={w * 0.72} viewBox="0 0 100 90" style={{ display: 'block' }} aria-hidden="true">
        <path d={JERSEY_PATH} fill={NUMBERUP.jersey} stroke="rgba(0,0,0,0.3)" strokeWidth="2" strokeLinejoin="round" />
        <text x="50" y="66" textAnchor="middle" fontSize="36" fontWeight="900"
          fill="#ffffff" fontFamily="'Space Grotesk', sans-serif">{pad2(num)}</text>
      </svg>
    </span>
  )
}

export default function NumberUpPodium({ last = 0, recent = [], isMobile = false, inline = false }) {
  return (
    <span style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: inline ? 'nowrap' : 'wrap', minWidth: 0,
      ...(inline ? { flex: '0 1 auto', overflow: 'hidden' } : { flex: '1 1 auto' }),
    }}>
      <NumberCard num={last} w={isMobile ? 22 : 24} />
      {/* 近 5 期小号串（新→旧） */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, ...(inline ? { overflow: 'hidden' } : {}) }}>
        {recent.map((n, i) => (
          <span key={`${n}-${i}`} style={{
            padding: '1px 7px', borderRadius: RADIUS.pill,
            background: n >= 25 ? NUMBERUP.hi : NUMBERUP.lo, color: COLORS.white,
            fontSize: 9.5, fontWeight: 900, opacity: i === 0 ? 1 : 0.75,
          }}>{pad2(n)}</span>
        ))}
      </span>
      <span style={{
        marginLeft: 'auto', padding: '2px 12px', borderRadius: RADIUS.pill,
        background: NUMBERUP.gold, color: '#3a2c00', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>号码 {pad2(last)}</span>
    </span>
  )
}
