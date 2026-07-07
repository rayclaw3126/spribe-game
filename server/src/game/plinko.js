// Plinko（Free Kick / 任意球）可验证公平核心算法（纯函数，无副作用，便于单测）
//
// 说明：paytable 算法逐位照抄前端 src/games/Plinko.jsx line 23-49，
// RTP/gamma/floor/roundMult 一律不改（正确性核心，禁拍脑袋改动）：
//   - N 行钉 → N+1 落格，落格 k 的概率是二项分布 p(k) = C(N,k) / 2^N
//     （每行独立左右各 1/2，k = 向右次数 —— 落格与飞行路径同一映射）。
//   - 档位曲线 raw(k) = floor + d(k)^γ，d = |2k−N|/N ∈ [0,1] 是归一化边距：
//       green  γ=3, floor=0.25  （平缓）
//       yellow γ=5, floor=0.02  （陡）
//       red    γ=8, floor=0.001 （极陡，边缘大奖）
//   - 归一化 s = RTP / Σ p(k)·raw(k)，mult(k) = round(s·raw(k))，RTP = 0.95。
//   - 四舍五入(≥10 取整、<10 一位小数)引入 <±1% 偏差，表值即结算值。
//
// 前端原来落点用不可预测的模块级 randomPath()（Math.random()），本模块把随机源
// 换成 HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) 派生的逐行 0/1 序列，
// 曲线/落点映射完全一致，只是随机源变成「可验证」的：只要事后公开 serverSeed，
// 任何人都能用 clientSeed + nonce 重算出同一条 path，从而验证服务端没有在球
// 开始下落后临时改路径作弊。
import crypto from 'crypto';

const RTP = 0.95;
const TIERS = {
  green: { gamma: 3, floor: 0.25 },
  yellow: { gamma: 5, floor: 0.02 },
  red: { gamma: 8, floor: 0.001 },
};
const PINS_MIN = 8;
const PINS_MAX = 16;
const roundMult = x => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);

function binomProbs(n) {
  const c = [1];
  for (let r = 0; r < n; r++) for (let i = c.length - 1; i >= 0; i--) c[i + 1] = (c[i + 1] || 0) + c[i];
  const denom = Math.pow(2, n);
  return c.map(v => v / denom);
}

/**
 * 某一档位（green/yellow/red）在 n 行钉盘下、每个落格 k(0..n) 的赔率表。
 * 算法逐位照抄前端 Plinko.jsx line 41-47，禁改。
 * @param {number} n - 钉盘行数（PINS_MIN..PINS_MAX）
 * @param {'green'|'yellow'|'red'} tier
 * @returns {number[]} 长度 n+1 的赔率数组
 */
export function multsFor(n, tier) {
  const { gamma, floor } = TIERS[tier];
  const probs = binomProbs(n);
  const raw = probs.map((_, k) => floor + Math.pow(Math.abs(2 * k - n) / n, gamma));
  const s = RTP / raw.reduce((acc, r, k) => acc + probs[k] * r, 0);
  return raw.map(r => roundMult(s * r));
}

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
 * 由 serverSeed + clientSeed + nonce 派生本局的下落路径（长度 rows 的 0/1 数组，
 * 1=向右 0=向左），与前端原来的 randomPath(n) 同为逐行独立、每行 1/2 概率向右，
 * 只是随机数来源换成了可验证的 HMAC 派生值，而不是前端裸用的 Math.random()。
 * 用足够多的熵：整段 HMAC hex 逐字节（每行 2 个 hex 字符 = 1 字节）取值，
 * rows ≤ 16 时最多用到 32 个 hex 字符，远小于 sha256 的 64 个字符，熵充足。
 * @param {string} serverSeed - 私密种子，reveal 前绝不对外广播
 * @param {string} clientSeed - 公开种子，下注时就已确定
 * @param {string|number} nonce - 本次请求唯一的随机串/序号
 * @param {number} rows - 钉盘行数（PINS_MIN..PINS_MAX）
 * @returns {number[]} 长度 rows 的 0/1 数组
 */
export function derivePath(serverSeed, clientSeed, nonce, rows) {
  const hex = crypto
    .createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');
  // sha256 hex 长度 64（32 字节），rows ≤ PINS_MAX(16) 时最多用到前 32 个 hex
  // 字符（16 字节），每行独立取 1 个字节，熵远超所需。
  const path = [];
  for (let i = 0; i < rows; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    path.push(byte < 128 ? 1 : 0);
  }
  return path;
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

export { PINS_MIN, PINS_MAX, TIERS };
