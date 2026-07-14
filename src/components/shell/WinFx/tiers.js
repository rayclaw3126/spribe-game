// #41 单8：中奖庆祝三档判定（纯函数·显示层）。
// 本期倍数 = totalPayout / 该款本期总注额（stake 只读本地已投记录，见 MultiTablePage.submitted）。
//   小中 small  <5×
//   大中 big    5–20×（含两端）
//   爆中 mega   >20× 或 totalPayout ≥ $200
// stake 缺失（无本地记录）时不据倍数升档，只认 $200 绝对线，避免误爆。
export const MEGA_ABS = 200

export function tierOf({ payout, stake }) {
  const pay = Number(payout) || 0
  const st = Number(stake) || 0
  const mult = st > 0 ? pay / st : 0
  if (pay >= MEGA_ABS || mult > 20) return { tier: 'mega', mult }
  if (mult >= 5) return { tier: 'big', mult }
  return { tier: 'small', mult }
}
