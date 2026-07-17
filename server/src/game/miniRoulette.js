// Mini Roulette（12 格轮盘）可验证公平核心算法（纯函数，便于单测/对拍）。原子局：下注→转→结算。
//
// ⚠️ 埋尸点铁律：WHEEL_ORDER / RED_SET / SINGLE_MULT / OUTSIDE_MULT / winMult 每个条件
//    逐位照抄前端 src/games/MiniRoulette.jsx，改一处必须改两处，一个数都别动别重算。
//    RED_SET = {1,3,5,8,10,12} 是【特定集合，不是奇数】——真轮盘红黑不按奇偶，最易搬错。
//
// 落号不信前端：spinRoulette 用 HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${counter}`)
// 派生字节，n = 1 + uniform(12)。%12 有模偏（256%12=4，余 0-3 偏多），玩家押具体号可套利，
// 故用【拒绝采样】丢弃 ≥252 的字节重抽，保证 12 号严格等概率（前端用无偏 Math.random，须对齐）。
// 单V3a 同构化：本文件原 `import crypto from 'crypto'` 已退役，hmac/sha256 回引
// lib/seededRng.js 单一出处（Node→原生 crypto / 浏览器→纯 JS，逐位等价由
// scripts/_isocrypto_parity.mjs 硬闸兜底）。前端 LocalVerify 直 import 本文件的派生函数
// 做本地重算——禁前端手抄第二份公式。派生逻辑本身零改动，只换哈希调用点。
// randomBytes（newServerSeed/newClientSeed）是 server-only，改函数体内惰性取 node:crypto，
// 浏览器 import 本模块不触发、不抛。
import { hmacSha256Hex, sha256Hex } from '../lib/seededRng.js';

// 轮盘 12 格顺序（视觉布局，非结算用）；红号集合（特定 6 号，非奇偶）。逐位照抄前端。
export const WHEEL_ORDER = [11, 1, 9, 5, 4, 10, 6, 12, 2, 8, 7, 3];
export const RED_SET = new Set([1, 3, 5, 8, 10, 12]);
export const SINGLE_MULT = 11.4;   // 押单号命中
export const OUTSIDE_MULT = 1.9;   // 押外围命中（red/black/odd/even/low/high）

/**
 * 由 serverSeed + clientSeed + nonce 确定性派生落号（1–12）。
 * 拒绝采样消除 %12 模偏（256%12=4，丢弃 ≥252 的字节重抽），12 号严格等概率。
 * @param {string} serverSeed - 私密种子，reveal 前绝不广播
 * @param {string} clientSeed - 公开种子
 * @param {string|number} nonce
 * @returns {number} 落号 1–12
 */
export function spinRoulette(serverSeed, clientSeed, nonce) {
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
  const limit = 256 - (256 % 12); // 252：其上（252–255）会造成 %12 模偏，丢弃重抽
  let b;
  do { b = nextByte(); } while (b >= limit);
  return 1 + (b % 12);
}

/**
 * 结算某个下注 key 对落号 n 的赔率倍数（逐位照抄前端 winMult）。
 * 单号 key = `n${n}` → 11.4×；外围 red/black/odd/even/low(≤6)/high(≥7) → 1.9×；否则 0。
 * @param {string} key - 下注键（'n1'..'n12' 或 'red'/'black'/'odd'/'even'/'low'/'high'）
 * @param {number} n - 落号 1–12
 * @returns {number} 倍数（0 = 未中）
 */
export function rouletteWinMult(key, n) {
  if (key === `n${n}`) return SINGLE_MULT;
  const red = RED_SET.has(n);
  if (key === 'red' && red) return OUTSIDE_MULT;
  if (key === 'black' && !red) return OUTSIDE_MULT;
  if (key === 'odd' && n % 2 === 1) return OUTSIDE_MULT;
  if (key === 'even' && n % 2 === 0) return OUTSIDE_MULT;
  if (key === 'low' && n <= 6) return OUTSIDE_MULT;
  if (key === 'high' && n >= 7) return OUTSIDE_MULT;
  return 0;
}

/** 合法下注 key 校验：单号 n1..n12 或 6 种外围。 */
export function isValidBetKey(key) {
  if (['red', 'black', 'odd', 'even', 'low', 'high'].includes(key)) return true;
  const m = /^n(\d{1,2})$/.exec(key);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= 1 && n <= 12;
}

/** 对 serverSeed 做 commit hash（reveal 前只广播 hash）。 */
export function hashSeed(serverSeed) {
  return sha256Hex(serverSeed);
}

/** 新私密 serverSeed（32 字节随机，hex）。 */
export function newServerSeed() {
  // server-only：浏览器永不调用本函数；惰性取避免 import 期触碰 node:crypto
  const crypto = process.getBuiltinModule('node:crypto');
  return crypto.randomBytes(32).toString('hex');
}

/** 新公开 clientSeed（8 字节随机，hex）。 */
export function newClientSeed() {
  // server-only：浏览器永不调用本函数；惰性取避免 import 期触碰 node:crypto
  const crypto = process.getBuiltinModule('node:crypto');
  return crypto.randomBytes(8).toString('hex');
}
