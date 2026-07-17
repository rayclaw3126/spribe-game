// Aviator 可验证公平核心算法（纯函数，无副作用，便于单测）
//
// 说明：崩盘点曲线、爬升曲线均照抄前端 src/games/Aviator.jsx，RTP/系数一律不改：
//   - 崩盘点：src/games/Aviator.jsx line 22-26 generateCrash()
//       r = Math.random(); r < 0.01 → 1；否则 Math.max(1, 0.99/(1-r))
//   - 爬升：src/games/Aviator.jsx line 527 Math.exp(0.17 * seconds)
// 前端用的是不可预测的 Math.random()，本模块把随机源换成
// HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) 派生的 [0,1) 浮点数，
// 曲线公式完全一致，只是随机源变成「可验证」的：
// 只要事后公开 serverSeed，任何人都能用 clientSeed + nonce 重算出同一个
// crashPoint，从而验证服务端没有在开奖后临时改点位作弊。
// 单V3c 同构化：本文件原 `import crypto from 'crypto'` 已退役，hmac/sha256 回引
// lib/seededRng.js 单一出处（Node→原生 crypto / 浏览器→纯 JS，逐位等价由
// scripts/_isocrypto_parity.mjs 硬闸兜底）。前端本地重算直 import 本文件的派生函数——禁手抄公式。
// 派生逻辑本身零改动，只换哈希调用点。
// randomBytes（newServerSeed/newClientSeed）是 server-only，改函数体内惰性取 node:crypto，
// 浏览器 import 本模块不触发、不抛。
import { hmacSha256Hex, sha256Hex } from '../lib/seededRng.js';

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
 * 由 serverSeed + clientSeed + nonce 派生本局崩盘倍数。
 * 与前端 generateCrash() 用的是同一条曲线公式，只是随机数来源换成了
 * 可验证的 HMAC 派生值，而不是前端裸用的 Math.random()。
 * 注：前端展示的倍数是未取整的裸 float；后端为了让「公开 serverSeed 后
 * 任何人重算都能拿到完全一致的结果」，统一 round 到小数点后两位
 * （floor 到分，避免浮点误差导致重算结果对不上）。
 * @param {string} serverSeed - 私密种子，reveal 前绝不对外广播
 * @param {string} clientSeed - 公开种子，开局时就广播
 * @param {number} nonce - 局号（从 0 递增），同一房间每局唯一
 * @returns {number} 崩盘倍数，保留两位小数，最小值 1
 */
export function generateCrash(serverSeed, clientSeed, nonce) {
  const hex = hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}`);
  // 取前 13 个十六进制字符 = 52 bit，与 2^52 相除得到 [0,1) 之间的浮点数，
  // 精度对齐 JS Number 的尾数位数（IEEE754 double 有 52 位尾数）。
  const r = parseInt(hex.slice(0, 13), 16) / Math.pow(2, 52);

  // 以下与前端 generateCrash() 曲线公式完全一致，不改 RTP：
  if (r < 0.01) return 1;
  const cp = Math.max(1, 0.99 / (1 - r));
  return Math.floor(cp * 100) / 100;
}

/**
 * 给定「起飞后经过的秒数」，算出当前应显示的爬升倍数。
 * 与前端 src/games/Aviator.jsx line 527 的 Math.exp(0.17 * seconds) 曲线一致，
 * 同样统一 round 到两位小数，方便 WS 广播 + 客户端本地校验「爬升没超过崩盘点」。
 * @param {number} elapsedSec - 起飞后经过的秒数
 * @returns {number} 当前倍数，保留两位小数
 */
export function multiplierAt(elapsedSec) {
  return Math.floor(Math.exp(0.17 * elapsedSec) * 100) / 100;
}

/**
 * 生成一局新的私密 serverSeed（32 字节随机数，十六进制表示）。
 * 只存在于内存 + rounds 表，reveal 前绝不通过 WS 广播、也不 console.log。
 * @returns {string}
 */
export function newServerSeed() {
  // server-only：浏览器永不调用本函数；惰性取避免 import 期触碰 node:crypto
  const crypto = process.getBuiltinModule('node:crypto');
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 生成一局公开的 clientSeed（8 字节随机数，十六进制表示）。
 * 开局（betting 阶段）就随 commitHash 一起广播，任何人都能看到。
 * @returns {string}
 */
export function newClientSeed() {
  // server-only：浏览器永不调用本函数；惰性取避免 import 期触碰 node:crypto
  const crypto = process.getBuiltinModule('node:crypto');
  return crypto.randomBytes(8).toString('hex');
}
