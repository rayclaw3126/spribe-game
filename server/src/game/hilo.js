// Rating Hi-Lo 可验证公平核心算法（纯函数，无副作用，便于单测）
//
// 说明：概率/赔率算法逐位照抄前端 src/games/HiLo.jsx line 20-24：
//   RTP = 0.97、pHigh(n) = (14-n)/13、pLow(n) = n/13、
//   judge：dir==='high' ? next>=card : next<=card（**等于（next===card）两个方向都算赢，
//   是 >=/<=，不是严格 >/<，别抄成严格不等**）。
//   累乘倍数全精度保留，不做任何 round，结算 payout 时才在调用方（round.js）里 round2。
//
// 前端原来是本地 Math.random() 抽牌（drawCard），本模块把抽牌换成
// HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${step}`) 派生的确定性 1-13 号牌：
// 只要事后公开 serverSeed，任何人都能用 clientSeed + nonce + step 重算出同一张牌，
// 从而验证服务端在 reveal 前没有偷看/篡改牌序。
// 单V3b 同构化：本文件原 `import crypto from 'crypto'` 已退役，hmac/sha256 回引
// lib/seededRng.js 单一出处（Node→原生 crypto / 浏览器→纯 JS，逐位等价由
// scripts/_isocrypto_parity.mjs 硬闸兜底）。前端 LocalVerify 直 import 本文件的派生函数
// 做本地重算——禁前端手抄第二份公式。派生逻辑本身零改动，只换哈希调用点。
// randomBytes（newServerSeed/newClientSeed）是 server-only，改函数体内惰性取 node:crypto，
// 浏览器 import 本模块不触发、不抛。
import { hmacSha256Hex, sha256Hex } from '../lib/seededRng.js';

export const RTP = 0.97;
export const SKIPS_PER_ROUND = 3;   // 每局 skip 限次，逐位照抄前端 line 21

/**
 * HIGH OR SAME 方向的赢面概率：逐位照抄前端 HiLo.jsx line 23，禁改。
 * @param {number} n - 当前明牌 1-13
 * @returns {number} 概率（0,1]
 */
export function pHigh(n) {
  return (14 - n) / 13;
}

/**
 * LOW OR SAME 方向的赢面概率：逐位照抄前端 HiLo.jsx line 24，禁改。
 * @param {number} n - 当前明牌 1-13
 * @returns {number} 概率（0,1]
 */
export function pLow(n) {
  return n / 13;
}

/**
 * 由 serverSeed + clientSeed + nonce + step 确定性派生一张 1-13 的牌。
 * 同一组 (serverSeed, clientSeed, nonce, step) 必得同一张牌，可验证。
 * @param {string} serverSeed - 私密种子，reveal 前绝不对外广播
 * @param {string} clientSeed - 公开种子，下注时就已确定
 * @param {string|number} nonce - 本局唯一的随机串
 * @param {number} step - 第几张牌（0 = 首张明牌，1,2,3... = 后续每次 guess/skip）
 * @returns {number} 1-13 的整数
 */
export function deriveCard(serverSeed, clientSeed, nonce, step) {
  const hex = hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:${step}`);
  return 1 + (parseInt(hex.slice(0, 8), 16) % 13);
}

/**
 * 判定本次猜测是否正确：逐位照抄前端 HiLo.jsx line 262，禁改。
 * **等于（next === card）两个方向都算赢** —— 是 >=/<=，不是严格 >/<。
 * @param {'high'|'low'} dir
 * @param {number} card - 当前明牌
 * @param {number} next - 翻出的下一张牌
 * @returns {boolean}
 */
export function judge(dir, card, next) {
  return dir === 'high' ? next >= card : next <= card;
}

/**
 * 猜对时这一步的倍率：逐位照抄前端 HiLo.jsx line 271（cumRef.current *= RTP / p）。
 * @param {'high'|'low'} dir
 * @param {number} card - 当前明牌（猜测发生时的明牌）
 * @returns {number} 全精度倍率
 */
export function stepMult(dir, card) {
  const p = dir === 'high' ? pHigh(card) : pLow(card);
  return RTP / p;
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
