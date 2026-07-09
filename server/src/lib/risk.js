import cfg from '../config/risk.js';
import { calcMultiplier, GRID } from '../game/mines.js';

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

// —— 敞口（exposure）：只对多步局 mines/hilo —— 纯函数，不查 DB（调用方查好传进来）。

/**
 * 本局潜在最大赢额（庄家潜在赔付），clamp 到该 game 的 maxPayout。
 * - mines：bet × 满清倍数 calcMultiplier(25-mineCount, mineCount)，再 min(maxPayout)
 * - hilo：cum 理论无界，直接取 maxPayout（cap 兜底）
 * @param {string} game
 * @param {number|string} betAmount
 * @param {number|string} [mineCount] mines 必传
 * @returns {number}
 */
export function potentialPayout(game, betAmount, mineCount) {
  const bet = Number(betAmount);
  const L = limitsFor(game);
  const cap = Number(L.maxPayout);
  if (game === 'mines') {
    const m = Number(mineCount);
    const fullClearMult = calcMultiplier(GRID - m, m);
    return Math.min(bet * fullClearMult, cap);
  }
  // hilo（及任何配了 exposureMult 的游戏）：潜在 = bet × exposureMult，clamp cap。
  // 理论无界的游戏用这个"代表性上限"记敞口，真超的尾部风险由 cashout 的 payout cap 兜。
  if (L.exposureMult != null) {
    return Math.min(bet * Number(L.exposureMult), cap);
  }
  // 未配 exposureMult 的其它游戏：保守回退满 cap（防以后接进来漏配）
  return cap;
}

/**
 * 校验加上本局后，玩家未结算敞口是否越界（双闸：总潜在赔付 + 并发局数）。
 * DB 查询不在此函数内，currentOpenTotal / currentOpenCount 由调用方查好传入。
 * @param {string} game
 * @param {number} currentOpenTotal 现有未结算局潜在赔付总额
 * @param {number} currentOpenCount 现有未结算局数
 * @param {number} thisRoundPotential 本局潜在赔付（potentialPayout 算出）
 * @returns {boolean}
 */
export function assertExposureWithinLimit(game, currentOpenTotal, currentOpenCount, thisRoundPotential) {
  const ex = cfg.exposure || {};
  const maxTotal = Number(ex.perPlayerMaxOpen);
  const maxRounds = Number(ex.maxOpenRounds);
  const total = Number(currentOpenTotal) + Number(thisRoundPotential);
  const count = Number(currentOpenCount) + 1;
  if (Number.isFinite(maxTotal) && total > maxTotal) {
    throw new RiskError('exposure_over_limit', `Open exposure ${total.toFixed(2)} exceeds limit ${maxTotal.toFixed(2)}`);
  }
  if (Number.isFinite(maxRounds) && count > maxRounds) {
    throw new RiskError('too_many_open_rounds', `Open rounds ${count} exceeds limit ${maxRounds}`);
  }
  return true;
}
