// Momentum 可验证公平核心算法（纯函数，无副作用，便于单测/对拍）。照 aviator.js 结构。
//
// ⚠️ 埋尸点铁律：factorOf / CRASH_FLOOR / BARS 逐位照抄前端 src/games/Momentum.jsx，
//    改一处必须改两处，一个数都别动别重算。
//
// 随机游走（逐位照抄前端注释）：每根柱 X ×= factorOf(u)，u ~ U[0,1)：
//   u < 0.5 → F = 0.58 + 0.84u ∈ [0.58, 1.00)   （跌，均值 0.79）
//   u ≥ 0.5 → F = 1.00 + 0.6(u − 0.5) ∈ [1.00, 1.30]（涨，均值 1.15）
//   E[F] = (0.79 + 1.15)/2 = 0.97。⇒ X_n 超鞅（E[X_n]=0.97ⁿ），可选停时定理：
//   任意兑现策略（首柱后才可兑现）E[X_τ] ≤ 0.97。崩 0 吸收（X≤0.05→0）只会更低。
//
// 前端用不可预测的 Math.random()；本模块把随机源换成 HMAC-SHA256 派生的可验证 [0,1) 浮点：
//   stepFactor 用 HMAC(serverSeed, `${clientSeed}:${nonce}:${barIdx}`)，曲线公式完全一致。
//   只要局末公开 serverSeed，任何人都能用 clientSeed+nonce 重算整条路径，验服务端没作弊。
//
// ⚠️ 逐柱 reveal 铁律：walkPath 整条路径仅【后端内部 + 局末复算】用，betting/running 广播
//    绝不含未来柱；serverSeed 保密到 done。同 Aviator crashPoint、RollingBall 按步现派。
import crypto from 'crypto';

// 逐位照抄前端。
export const CRASH_FLOOR = 0.05;   // X ≤ 0.05 → 崩 0
export const BARS = 31;            // 封顶 31 柱

/** 单柱系数（逐位照抄前端）：u<0.5 跌 [0.58,1.00) / u≥0.5 涨 [1.00,1.30]。 */
export function factorOf(u) {
  return u < 0.5 ? 0.58 + 0.84 * u : 1 + 0.6 * (u - 0.5);
}

/** commit hash：开局广播 sha256(serverSeed)（不广播 serverSeed 本身），done reveal 后可校验。 */
export function hashSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

/**
 * 第 barIdx 根柱的系数：HMAC(serverSeed, `${clientSeed}:${nonce}:${barIdx}`) → 52-bit [0,1) u → factorOf(u)。
 * 每柱独立 barIdx（counter 续熵）。52-bit uniform 使 factorOf 无偏，无需拒绝采样。
 * @param {string} serverSeed 私密种子，reveal 前绝不广播
 * @param {string} clientSeed 公开种子
 * @param {number} nonce 局号
 * @param {number} barIdx 柱序（0..BARS-1）
 * @returns {number} 该柱系数
 */
export function stepFactor(serverSeed, clientSeed, nonce, barIdx) {
  const hex = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}:${barIdx}`).digest('hex');
  const u = parseInt(hex.slice(0, 13), 16) / Math.pow(2, 52);
  return factorOf(u);
}

/**
 * 整条 31 柱路径：X 从 1 逐柱 ×factorOf；X ≤ CRASH_FLOOR → bust 归 0（吸收，之后不再走）。
 * 仅后端内部 + 局末复算用；betting/running 绝不广播未来柱。
 * X 统一 round 到两位小数（对齐前端展示 + 让 reveal 后重算完全一致，避免浮点误差）。
 * @returns {{ bars: {barIdx:number,f:number,x:number}[], crashBar: number|null, finalX: number }}
 *   crashBar = 首次 bust 的柱序（null 若 survive 到 31）；finalX = 末柱 X（bust 则 0）。
 */
export function walkPath(serverSeed, clientSeed, nonce) {
  const bars = [];
  let x = 1;
  let crashBar = null;
  for (let barIdx = 0; barIdx < BARS; barIdx++) {
    const f = stepFactor(serverSeed, clientSeed, nonce, barIdx);
    x = Math.round(x * f * 100) / 100;
    if (x <= CRASH_FLOOR) {
      x = 0;
      bars.push({ barIdx, f, x });
      crashBar = barIdx;
      break;   // bust 吸收，之后不再走
    }
    bars.push({ barIdx, f, x });
  }
  return { bars, crashBar, finalX: bars.length ? bars[bars.length - 1].x : 1 };
}

/** 生成私密 serverSeed（reveal 前绝不广播/日志）。 */
export function newServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/** 生成公开 clientSeed（开局随 commitHash 广播）。 */
export function newClientSeed() {
  return crypto.randomBytes(8).toString('hex');
}
