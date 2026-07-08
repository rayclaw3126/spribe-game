// Limbo（Odds Climb）可验证公平核心算法（纯函数，无副作用，便于单测）
//
// 说明：开奖公式逐位照抄前端 src/games/Limbo.jsx 的真实代码（line 19-20 常量 +
// line 170-171 开奖式），RTP/系数一律不改：
//   - HOUSE_EDGE = 0.99，MAX_MULT = 1000000（前端 line 19-20）
//   - 开奖：前端 line 170-171 真实代码是
//       const r = Math.random()
//       const finalMult = Math.min(MAX_MULT, Math.max(1, parseFloat((HOUSE_EDGE / r).toFixed(2))))
//     —— 是 `HOUSE_EDGE / r`，不是 `HOUSE_EDGE / (1 - r)`。文件里另有一句旧注释写的是
//     `0.99/(1-r)`，那是过时的、错的，本模块务必只照抄 line171 真实代码的 `/r` 公式。
//   - 判定：前端 line 189 `win = finalMult >= target`（target 是玩家设的目标赔率，≥1.01）
//   - 赔付：前端 line 190-191，赢则 payout = bet × target（注意是 × target，不是
//     × finalMult；finalMult 只决定够不够 target），输则 0、bet 全没。
//
// 前端原来用的是不可预测的 Math.random()，本模块把随机源换成
// HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) 派生的 (0,1) 浮点数 r，
// 曲线公式完全一致，只是随机源变成「可验证」的：只要事后公开 serverSeed，
// 任何人都能用 clientSeed + nonce 重算出同一个 r / finalMult，从而验证服务端
// 没有在开奖后临时改点位作弊。
import crypto from 'crypto';

export const HOUSE_EDGE = 0.99;
export const MAX_MULT = 1000000;
export const TARGET_MIN = 1.01;

/**
 * 对 serverSeed 做 commit hash：开局时先广播这个 hash（不广播 serverSeed 本身），
 * 局结束 reveal serverSeed 后，任何人都能重新计算 sha256(serverSeed) 校验一致，
 * 从而证明 serverSeed 是开局前就已经确定好的，没有被中途调包。
 * @param {string} serverSeed
 * @returns {string} 64 位十六进制 sha256 摘要
 */
export function hashSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

/**
 * 由 serverSeed + clientSeed + nonce 派生本局的 finalMult。
 * 随机源 r ∈ (0,1) 用 HMAC-SHA256 派生（取前 13 位十六进制 / 2^52，与
 * Dice/Plinko 同一套派生方式，精度对齐 JS Number 的尾数位数），
 * 然后逐位照抄前端 Limbo.jsx line 171 真实代码：
 *   finalMult = min(MAX_MULT, max(1, round2(HOUSE_EDGE / r)))
 * @param {string} serverSeed - 私密种子，reveal 前绝不对外广播
 * @param {string} clientSeed - 公开种子，下注时就已确定
 * @param {string|number} nonce - 本次请求唯一的随机串/序号
 * @returns {number} finalMult，范围 [1, MAX_MULT]，保留两位小数
 */
export function deriveMult(serverSeed, clientSeed, nonce) {
  const hex = crypto
    .createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');
  let r = parseInt(hex.slice(0, 13), 16) / Math.pow(2, 52);
  // 防除零：r 理论上落在 [0,1)，若恰好为 0（概率极低）用极小正数兜底，
  // 避免 HOUSE_EDGE / r 得到 Infinity。
  r = r || 1e-12;
  // 逐位照抄前端 Limbo.jsx line 171 真实代码：是 `HOUSE_EDGE / r`，
  // 不是旧注释里过时的 `HOUSE_EDGE / (1 - r)`。
  return Math.min(MAX_MULT, Math.max(1, parseFloat((HOUSE_EDGE / r).toFixed(2))));
}

/**
 * 判定输赢：finalMult 达到（含等于）玩家设的 target 即为赢。
 * 与前端 Limbo.jsx line 189 `win = finalMult >= target` 一致。
 * @param {number} finalMult
 * @param {number} target
 * @returns {boolean}
 */
export function judge(finalMult, target) {
  return finalMult >= target;
}

/**
 * 赢时的赔付倍率约定：payout = bet × target（不是 × finalMult）。
 * 与前端 Limbo.jsx line 190-191 一致——finalMult 只用来判断是否达标，
 * 真正决定赔付倍数的是玩家自己设的 target。
 * 实际金额计算在 round.js 里用 SQL numeric 做（禁 JS 浮点加减），
 * 这里只返回约定的倍率本身，供上层需要时复用/断言。
 * @param {number} target
 * @returns {number}
 */
export function payoutMultFor(target) {
  return target;
}

/**
 * 生成一局新的私密 serverSeed（32 字节随机数，十六进制表示）。
 * 只存在于内存/DB，reveal 前绝不 console.log。
 * @returns {string}
 */
export function newServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 生成一个公开的 clientSeed（8 字节随机数，十六进制表示）。
 * 前端未提供 clientSeed 时由后端兜底生成，随结果一起返回给前端。
 * @returns {string}
 */
export function newClientSeed() {
  return crypto.randomBytes(8).toString('hex');
}
