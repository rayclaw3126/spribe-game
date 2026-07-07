// Dice（总进球 / Total Goals）可验证公平核心算法（纯函数，无副作用，便于单测）
//
// 说明：开奖曲线、赔率公式均照抄前端 src/games/Dice.jsx，RTP/系数一律不改：
//   - 开奖：前端原来是模块级 rollPoint() = round2(Math.random()*100)（0–100 均匀分布，2 位小数）
//   - 赔率：前端 payoutFor(chance) = round2(RTP*100/chance)，RTP = 0.97
//   - 判负/判胜：前端 line 237 `side === 'under' ? roll < target : roll > target`
//     —— 两侧都用严格不等号，roll 恰好等于 target 时两边都输
// 前端原来用的是不可预测的 Math.random()，本模块把随机源换成
// HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) 派生的 [0,1) 浮点数，
// 曲线公式完全一致，只是随机源变成「可验证」的：只要事后公开 serverSeed，
// 任何人都能用 clientSeed + nonce 重算出同一个 roll，从而验证服务端没有
// 在开奖后临时改点位作弊。
import crypto from 'crypto';

const RTP = 0.97;

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
 * 由 serverSeed + clientSeed + nonce 派生本局的 roll（0–100，2 位小数）。
 * 与前端原来的 rollPoint() 同为 0–100 均匀分布，只是随机数来源换成了
 * 可验证的 HMAC 派生值，而不是前端裸用的 Math.random()。
 * @param {string} serverSeed - 私密种子，reveal 前绝不对外广播
 * @param {string} clientSeed - 公开种子，下注时就已确定
 * @param {string|number} nonce - 本次请求唯一的随机串/序号
 * @returns {number} roll，范围 [0,100)，保留两位小数
 */
export function rollDice(serverSeed, clientSeed, nonce) {
  const hex = crypto
    .createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');
  // 取前 13 个十六进制字符 = 52 bit，与 2^52 相除得到 [0,1) 之间的浮点数，
  // 精度对齐 JS Number 的尾数位数（IEEE754 double 有 52 位尾数）。
  const r = parseInt(hex.slice(0, 13), 16) / Math.pow(2, 52);
  return Math.floor(r * 100 * 100) / 100;
}

/**
 * 赔率：payout = RTP·100/chance，RTP = 0.97，与前端 payoutFor() 完全一致。
 * @param {number} chance - 命中概率（百分比，比如 UNDER 50 → chance=50）
 * @returns {number} 赔率倍数，保留两位小数
 */
export function payoutFor(chance) {
  return Math.floor((RTP * 100 / chance) * 100) / 100;
}

/**
 * 判定输赢：两侧都用严格不等号，roll 恰好等于 target 时两边都输，
 * 与前端 Dice.jsx line 237 一致。
 * @param {number} roll
 * @param {number} target
 * @param {'under'|'over'} direction
 * @returns {boolean}
 */
export function judge(roll, target, direction) {
  return direction === 'under' ? roll < target : roll > target;
}

/**
 * 由 target + direction 算命中概率（百分比）。
 * UNDER 命中概率 = target；OVER 命中概率 = 100 − target。
 * @param {number} target
 * @param {'under'|'over'} direction
 * @returns {number}
 */
export function chanceFor(target, direction) {
  return direction === 'under' ? target : 100 - target;
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
