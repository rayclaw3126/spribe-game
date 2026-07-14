import { CHIP_COLORS } from './tokens'

// #41 单12.1：筹码共享件——SVG 圆码带边齿 + 内环，五档色（$1灰白/$5红/$10蓝/$25绿/$50金）。
// props {value,size}：色 = 向上归档（value ≤ v 的最小档，超 $50 封顶金）；面额居中白字带描边。
// 选中环由调用方外包（顶栏选择器），本件只画码本体，保 props 收敛。
export default function Chip({ value, size = 26 }) {
  const t = CHIP_COLORS.find(c => value <= c.v) ?? CHIP_COLORS[CHIP_COLORS.length - 1]
  const label = String(Math.round(Number(value) || 0))
  const fs = label.length >= 3 ? 30 : label.length === 2 ? 38 : 46
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block' }} aria-hidden>
      <circle cx="50" cy="50" r="48" fill={t.base} />
      {/* 边齿：亮色虚线环（8 齿） */}
      <circle cx="50" cy="50" r="43" fill="none" stroke={t.edge} strokeWidth="9"
        strokeDasharray="16 17.8" transform="rotate(-90 50 50)" />
      {/* 内环 */}
      <circle cx="50" cy="50" r="33" fill={t.base} stroke={t.edge} strokeWidth="2.5" />
      {/* 面额：白字带深描边（paint-order stroke 先描后填，字更清） */}
      <text x="50" y="51" textAnchor="middle" dominantBaseline="central"
        fontFamily="system-ui, sans-serif" fontSize={fs} fontWeight="900"
        fill="#ffffff" stroke="rgba(0,0,0,0.55)" strokeWidth="3.5"
        style={{ paintOrder: 'stroke' }}>{label}</text>
    </svg>
  )
}
