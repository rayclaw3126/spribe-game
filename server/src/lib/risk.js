import cfg from '../config/risk.js';

export class RiskError extends Error {
  constructor(code, message) { super(message); this.name = 'RiskError'; this.code = code; this.status = 400; }
}

function limitsFor(game) {
  return { ...cfg.default, ...(cfg.perGame?.[game] || {}) };
}

// 下注前：校验注额在 min/max 内
export function assertBetWithinLimits(game, amount) {
  const a = Number(amount);
  const L = limitsFor(game);
  if (!Number.isFinite(a) || a <= 0) throw new RiskError('bet_invalid', 'Invalid bet amount');
  if (a < Number(L.minBet)) throw new RiskError('bet_below_min', `Min bet is ${L.minBet}`);
  if (a > Number(L.maxBet)) throw new RiskError('bet_above_max', `Max bet is ${L.maxBet}`);
  return true;
}

// 派彩前：校验单局赢额（含本金）不超封顶
export function assertPayoutCap(game, payout) {
  const p = Number(payout);
  const L = limitsFor(game);
  if (Number.isFinite(p) && p > Number(L.maxPayout)) {
    throw new RiskError('payout_over_cap', `Payout ${payout} exceeds cap ${L.maxPayout}`);
  }
  return true;
}
