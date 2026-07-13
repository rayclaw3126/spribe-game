// skin code 是功能 key（skinColor 查表+选中判定），恒用英文代号；中文显示走 LABEL 映射。禁改中文直存。
// 主色尽量用现有 token：navy→primary、green→success、gold→warning；purple token 无紫，用仓库已有的紫 #7c3aed。
import { COLORS } from '../theme/tokens.js'

export const SKINS = [
  { code: 'navy', label: '深蓝专业', color: COLORS.primary },
  { code: 'purple', label: '电竞紫', color: '#7c3aed' },
  { code: 'green', label: '足球绿', color: COLORS.success },
  { code: 'gold', label: '午夜黑金', color: COLORS.warning },
]

const LABEL = Object.fromEntries(SKINS.map((s) => [s.code, s.label]))
const COLOR = Object.fromEntries(SKINS.map((s) => [s.code, s.color]))

// 代号 → 中文（未知代号原样返回，兜底 —）。
export function skinLabel(code) {
  return LABEL[code] || code || '—'
}
export function skinColor(code) {
  return COLOR[code] || COLORS.slate
}
