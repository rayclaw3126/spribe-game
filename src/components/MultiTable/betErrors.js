// #41 单4：后端下注 error → 中文映射。
// 契约（禁改后端）：RiskError → { error:message, code }；相位闸 → { error:'round_locked' }(409)；
// 余额不足 → { error:'余额不足' }(400)；参数/盘口错 → { error:'中文串' }(400)。
// 优先认 err.data.code（RiskError 稳定码），再认 err.data.error（消息/round_locked/余额不足）。
const BY_CODE = {
  bet_above_max: '超单注上限',
  bet_below_min: '低于最小注',
  bet_invalid: '注额非法',
  payout_over_cap: '派彩触顶',
  exposure_over_limit: '风险敞口超限',
  too_many_open_rounds: '未结局数过多',
}

export function mapBetError(e) {
  const code = e?.data?.code
  const msg = e?.data?.error || e?.message || ''
  if (code && BY_CODE[code]) return BY_CODE[code]
  if (msg === 'round_locked') return '已封盘'
  if (msg.includes('余额不足')) return '余额不足'
  if (msg.includes('Max bet')) return '超单注上限'
  if (msg.includes('Min bet')) return '低于最小注'
  // 网络层异常（fetch reject，无 err.data）
  if (!e?.data) return '网络异常，请重试'
  return msg || '提交失败'
}
