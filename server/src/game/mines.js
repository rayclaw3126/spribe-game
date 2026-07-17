// Mines（盘带过人）可验证公平核心算法（纯函数，无副作用，便于单测）
//
// 说明：赔率算法逐位照抄前端 src/games/Mines.jsx line 31-37，RTP/GRID 一律不改：
//   - calcMultiplier(gems, mines)：超几何逐步累乘，已翻 i 格后再翻一格安全的概率
//     P_i = (safe − i) / (25 − i)，safe = 25 − 雷数；步倍数 = RTP / P_i，
//     RTP = 0.97；累乘全精度，不 round —— 结算 payout 时才 round2（在 round.js 里做）。
//   - 前端原来是本地 Math.random() 随机布雷（placeMines），本模块把布雷位置换成
//     HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${counter}`) 派生的确定性
//     部分 Fisher-Yates 抽样：只要事后公开 serverSeed，任何人都能用
//     clientSeed + nonce + mineCount 重算出同一组雷位置，从而验证服务端在
//     reveal 前没有偷看/篡改布雷。
// 单V3b 同构化：本文件原 `import crypto from 'crypto'` 已退役，hmac/sha256 回引
// lib/seededRng.js 单一出处（Node→原生 crypto / 浏览器→纯 JS，逐位等价由
// scripts/_isocrypto_parity.mjs 硬闸兜底）。前端 LocalVerify 直 import 本文件的派生函数
// 做本地重算——禁前端手抄第二份公式。派生逻辑本身零改动，只换哈希调用点。
// randomBytes（newServerSeed/newClientSeed）是 server-only，改函数体内惰性取 node:crypto，
// 浏览器 import 本模块不触发、不抛。
import { hmacSha256Hex, sha256Hex } from '../lib/seededRng.js';

const RTP = 0.97;
export const GRID = 25;          // 5x5
export const MINES_MIN = 1;
export const MINES_MAX = 24;

/**
 * 赔率：逐位照抄前端 Mines.jsx calcMultiplier（line 31-37），禁改。
 * gems<=0 时返回 1（未揭任何格）。内部保留全精度，不做任何 round，
 * 结算 payout 时才在调用方（round.js）里 round2。
 * @param {number} gems - 已安全揭开的格数
 * @param {number} mines - 本局雷数（1-24）
 * @returns {number} 累乘倍数，全精度
 */
export function calcMultiplier(gems, mines) {
  if (gems <= 0) return 1;
  const safe = GRID - mines;
  let m = 1;
  for (let i = 0; i < gems; i++) m *= RTP * (GRID - i) / (safe - i);
  return m;
}

/**
 * 由 serverSeed + clientSeed + nonce + mineCount 确定性派生本局雷的位置
 * （0..24，长度 mineCount，元素不重复，返回时按升序排序）。
 * 用 HMAC 扩展熵做部分 Fisher-Yates：每次需要一个新的随机字节时，
 * 若熵池 hex 不足 2 个字符，就用 `${clientSeed}:${nonce}:${counter}` 追加派生
 * 一段新的 HMAC-SHA256 摘要，保证熵源同样可由外部重算复现。
 * 同一组 (serverSeed, clientSeed, nonce, mineCount) 必得同一结果，可验证。
 * @param {string} serverSeed - 私密种子，reveal 前绝不对外广播
 * @param {string} clientSeed - 公开种子，下注时就已确定
 * @param {string|number} nonce - 本次请求唯一的随机串/序号
 * @param {number} mineCount - 本局雷数（1-24）
 * @returns {number[]} 升序排列的雷位置数组，长度 mineCount
 */
export function deriveMines(serverSeed, clientSeed, nonce, mineCount) {
  const positions = Array.from({ length: GRID }, (_, i) => i);
  let hex = '';
  let counter = 0;
  const nextByte = () => {
    if (hex.length < 2) {
      hex = hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:${counter++}`);
    }
    const b = parseInt(hex.slice(0, 2), 16);
    hex = hex.slice(2);
    return b;
  };
  for (let i = 0; i < mineCount; i++) {
    const j = i + (nextByte() % (GRID - i));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions.slice(0, mineCount).sort((a, b) => a - b);
}

/**
 * 对 serverSeed 做 commit hash：开局时先广播这个 hash（不广播 serverSeed 本身），
 * 局结束 reveal serverSeed 后，任何人都能重新计算 sha256(serverSeed) 校验一致，
 * 从而证明 serverSeed 是开局前就已经确定好的，没有被中途调包。
 * @param {string} serverSeed
 * @returns {string} 64 位十六进制 sha256 摘要
 */
export function hashSeed(serverSeed) {
  return sha256Hex(serverSeed);
}

/**
 * 生成一局新的私密 serverSeed（32 字节随机数，十六进制表示）。
 * 只存在于内存/DB，reveal 前绝不 console.log。
 * @returns {string}
 */
export function newServerSeed() {
  // server-only：浏览器永不调用本函数；惰性取避免 import 期触碰 node:crypto
  const crypto = process.getBuiltinModule('node:crypto');
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 生成一个公开的 clientSeed（8 字节随机数，十六进制表示）。
 * 前端未提供 clientSeed 时由后端兜底生成，随结果一起返回给前端。
 * @returns {string}
 */
export function newClientSeed() {
  // server-only：浏览器永不调用本函数；惰性取避免 import 期触碰 node:crypto
  const crypto = process.getBuiltinModule('node:crypto');
  return crypto.randomBytes(8).toString('hex');
}
