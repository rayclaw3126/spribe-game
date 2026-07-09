// 轮次开奖游戏的【信任根】—— 确定性 RNG 流。
// ⚠️ 这批 10 个轮次开奖游戏（SpeedGrid/NumberUp/HatTrick/GoldenBoot/DerbyDay/LineUp/
//    WuXing/RollingBall/DominoDuel/HalfTime）全部复用本模块，改动影响【全部】——慎改、必对拍。
//
// 各游戏引擎的 drawX(rng) 都用 rng()∈[0,1) 做 floor(rng()×m) 或 Fisher-Yates。
// 只要 rng 是 52-bit/2^52 的 [0,1) uniform，floor(U×m) 的偏差 ≤ m/2^52 ≈ 1e-14（可忽略，
// 不像单字节 %m 的粗偏），所以这批【无需拒绝采样】——信任根用 52-bit 派生即可。
//
// 派生：HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${counter}`) 的十六进制流，
// 每次 rng() 取 13 个 hex 字符(52bit) / 2^52。counter 递增续熵，支持一局多次 rng()
// 调用（如 Fisher-Yates 洗 28 张骨牌需多次）。同 (serverSeed,clientSeed,nonce) 必得同一序列，
// 任何人事后公开 serverSeed 都能重放校验。
import crypto from 'crypto';

const TWO_POW_52 = Math.pow(2, 52);

/**
 * 造一个确定性 rng()：每次调用吐一个 52-bit 的 [0,1) uniform。
 * @param {string} serverSeed - 私密种子，reveal 前绝不广播
 * @param {string} clientSeed - 公开种子
 * @param {string|number} nonce
 * @returns {() => number} rng()，返回 [0,1)
 */
export function makeSeededRng(serverSeed, clientSeed, nonce) {
  let hex = '';
  let counter = 0;
  const refill = () => {
    hex += crypto
      .createHmac('sha256', serverSeed)
      .update(`${clientSeed}:${nonce}:${counter++}`)
      .digest('hex'); // 每块 64 hex 字符
  };
  return function rng() {
    while (hex.length < 13) refill();        // 需 13 hex = 52 bit
    const chunk = hex.slice(0, 13);
    hex = hex.slice(13);
    return parseInt(chunk, 16) / TWO_POW_52; // [0,1)
  };
}
