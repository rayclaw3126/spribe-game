// Goal（射门闯关）可验证公平核心算法（纯函数，便于单测/对拍）。多步局：7 列逐列避雷累乘。
//
// ⚠️ 埋尸点铁律：stepMult / TIERS / RTP / COLS / ROWS 逐字照抄前端 src/games/Goal.jsx，
//    RTP 焊死——改一处必须改两处，一个数都别动别重算。
//
// 雷行不信前端：deriveBombRows 用 HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${col}:${counter}`)
// 【按列独立】派生本列雷行（key 带列号 col，每列一把新熵），只算某一列、绝不一次算全盘。
//
// ⚠ 不变量（单V3b 改版，原为「result 里永不落任何雷位」）：
//   · 【未来列】雷行永不落库 —— 这是「GET /:id 看雷位=提款机」的根治，一个字都不能松。
//   · 【已走列】雷行终局补落（round.js /goal/pick 的 bombRows），供玩家本地重算比对：
//     原先 cashed 局只存玩家选行、不存雷行，导致一列都验不了。已走列属"过去"，无提款机价值；
//     各列熵独立（key 带 col），知道前面列推不出后面列。
//   · 活局期由 safeResultForView 的 goal 白名单剥除 bombRows（白名单【禁】收录本字段）
//     —— 这是补落安全的前提，改白名单前先想清楚这一行。
//
// 无偏：挑雷行是 [0,1,2,3] 上的部分 Fisher-Yates。bombs=1 只用 %4(256%4=0 无偏)，但 bombs=2/3
// 会用到 %3(256%3≠0 有模偏)。玩家挑行可套利，且前端用无偏 Math.random——故这里用拒绝采样消除
// 模偏（与 Keno 同款处理），保证各行/各子集严格等概率、与前端分布一致。
// 单V3b 同构化：本文件原 `import crypto from 'crypto'` 已退役，hmac/sha256 回引
// lib/seededRng.js 单一出处（Node→原生 crypto / 浏览器→纯 JS，逐位等价由
// scripts/_isocrypto_parity.mjs 硬闸兜底）。前端 LocalVerify 直 import 本文件的派生函数
// 做本地重算——禁前端手抄第二份公式。派生逻辑本身零改动，只换哈希调用点。
// randomBytes（newServerSeed/newClientSeed）是 server-only，改函数体内惰性取 node:crypto，
// 浏览器 import 本模块不触发、不抛。
import { hmacSha256Hex, sha256Hex } from '../lib/seededRng.js';

const RTP = 0.97;
export const COLS = 7;   // 7 列
export const ROWS = 4;   // 每列 4 行
// tier = 每列雷数（start 选、局中锁）。逐字照抄前端 Goal.jsx TIERS。
export const TIERS = { sm: { bombs: 1 }, md: { bombs: 2 }, lg: { bombs: 3 } };

/**
 * 每步（推进一列）的累乘倍数：RTP / P(safe)，P(safe) = (ROWS - bombs)/ROWS。
 * 逐字照抄前端 Goal.jsx：stepMult = RTP / ((ROWS - bombs) / ROWS)。
 * sm→1.2933… / md→1.94 / lg→3.88。
 * @param {'sm'|'md'|'lg'} tier
 * @returns {number} 全精度步倍数
 */
export function stepMult(tier) {
  return RTP / ((ROWS - TIERS[tier].bombs) / ROWS);
}

/**
 * 由 serverSeed + clientSeed + nonce + col + bombs 确定性派生【第 col 列】的雷行集合
 * （行号 0..3，长度 bombs，互不相同）。每列独立（HMAC key 带 col）。
 * 部分 Fisher-Yates + 拒绝采样（无模偏），与前端 drawBombRows 的均匀 n-子集分布一致。
 * 同一组 (serverSeed, clientSeed, nonce, col, bombs) 必得同一结果，可验证。
 * @param {string} serverSeed - 私密种子，reveal 前绝不广播
 * @param {string} clientSeed - 公开种子
 * @param {string|number} nonce
 * @param {number} col - 列号（0..COLS-1），每列一把独立熵
 * @param {number} bombs - 本列雷数（=TIERS[tier].bombs，1..3）
 * @returns {Set<number>} 本列雷行集合，size = bombs
 */
export function deriveBombRows(serverSeed, clientSeed, nonce, col, bombs) {
  const rows = [0, 1, 2, 3];
  let hex = '';
  let counter = 0;
  const nextByte = () => {
    if (hex.length < 2) {
      hex = hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:${col}:${counter++}`);
    }
    const b = parseInt(hex.slice(0, 2), 16);
    hex = hex.slice(2);
    return b;
  };
  // 均匀取 [0,m)：拒绝采样消除模偏（%3 时 256 不整除 3 会偏，丢弃越界字节重抽）。
  const uniform = (m) => {
    const limit = 256 - (256 % m);
    let b;
    do { b = nextByte(); } while (b >= limit);
    return b % m;
  };
  for (let i = 0; i < bombs; i++) {
    const j = i + uniform(ROWS - i);
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return new Set(rows.slice(0, bombs));
}

/** 对 serverSeed 做 commit hash（与其它游戏一致，reveal 前只广播 hash）。 */
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
