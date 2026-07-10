import cfg from '../config/risk.js';
import { calcMultiplier, GRID } from '../game/mines.js';
import { stepMult as goalStepMult, COLS as GOAL_COLS } from '../game/goal.js';

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

// 取该 game 的派彩封顶（数值）。用于「钳制」型上限（如 keno 原子局：赢额超顶就 cap 到此值，
// 而非 assertPayoutCap 的「拒绝」型——原子局把中奖局整个作废是错的）。
export function maxPayoutFor(game) {
  return Number(limitsFor(game).maxPayout);
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
export function potentialPayout(game, betAmount, extra) {
  const bet = Number(betAmount);
  const L = limitsFor(game);
  const cap = Number(L.maxPayout);
  if (game === 'mines') {
    // extra = mineCount：满清倍数 calcMultiplier(25-mineCount, mineCount)
    const m = Number(extra);
    const fullClearMult = calcMultiplier(GRID - m, m);
    return Math.min(bet * fullClearMult, cap);
  }
  if (game === 'goal') {
    // extra = tier（'sm'|'md'|'lg'）：满清倍数 = stepMult(tier)^COLS（有界）
    return Math.min(bet * goalStepMult(extra) ** GOAL_COLS, cap);
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

/**
 * 共享 crash 房间的「本局聚合负债闸」（momentum / aviator 共用）。
 * 一局房间的总潜在赔付 = Σ 未兑现注的潜在赔付（每注封顶 = maxPayout，钳制后单注上限）；
 * 加上新注后超 config 的 maxRoomLiability 则拒（防单局灾难性总赔付）。
 * currentRoomLiability / newBetPotential 由 hub 算好传入（不查 DB）。
 * 未配 maxRoomLiability 的 game 不启用此闸。
 * @param {string} game
 * @param {number} currentRoomLiability 现有未兑现注潜在赔付总额
 * @param {number} newBetPotential 本注潜在赔付（一般 = maxPayoutFor(game)）
 */
export function assertRoundLiability(game, currentRoomLiability, newBetPotential) {
  const maxRoom = Number(limitsFor(game).maxRoomLiability);
  if (!Number.isFinite(maxRoom)) return true;   // 未配则不启用
  const total = Number(currentRoomLiability) + Number(newBetPotential);
  if (total > maxRoom) {
    throw new RiskError('round_liability_exceeded', `Room liability ${total.toFixed(2)} exceeds ${maxRoom.toFixed(2)}`);
  }
  return true;
}
