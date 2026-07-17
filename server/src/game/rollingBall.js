// Rolling Ball（连开 3 球足球滚球皮 · 每球 1-75 同局不重复）可验证公平引擎（纯函数，便于单测/对拍）。
// bespoke 多步：一局连开 3 球（无放回），逐球独立押注 + 逐球立即结算；赔率随剩余池动态变，下注时锁定。
//
// ⚠️ 埋尸点铁律：GROUPS / COMBO / COMBO_C / R 锚值 / oddsFor 公式 / hitOf 逐位照抄前端
//    src/games/RollingBall.jsx，改一处必须改两处，一个数都别动别重算。
//
// ⚠️ 动态赔率公式（逆向报告公式，禁改）：odds_k = round2(R_key × (75-ballIdx) / c_k)，
//    ballIdx=0/1/2（球序 k=ballIdx+1，pool=75-ballIdx=76-k）；c_k=剩余池满足该键的号数
//    = 初始计数 − 已开出属该键的球数。恒等性质：odds_k × P(命中)=odds_k × c_k/(75-ballIdx)=R_key
//    → RTP 恒等于锚 R，与球序/已开球无关。
//
// ⚠️ 按步现派（安全铁律）：本引擎 drawBall(remaining,rng) 每球只抽 1（从剩余池），未开球【不预抽】
//    → handler 侧 result 只存已开球，未开球根本不存在，无未来信息可泄露。
//
// 开奖不信前端：drawBall 用注入的 seededRng（HMAC 派生 [0,1)），floor(U×remaining.length) 偏差
//    ≈ 75/2^52 可忽略，无需拒绝采样。结算一律用服务端 oddsFor（前端 odds 仅显示）。
// 单V3c 同构化：本文件原 `import crypto from 'crypto'` 已退役，sha256 回引
// lib/seededRng.js 单一出处（Node→原生 crypto / 浏览器→纯 JS，逐位等价由
// scripts/_isocrypto_parity.mjs 硬闸兜底）。前端本地重算直 import 本文件的派生函数——禁手抄公式。
// 派生逻辑本身零改动，只换哈希调用点。
// randomBytes（newServerSeed/newClientSeed）是 server-only，改函数体内惰性取 node:crypto，
// 浏览器 import 本模块不触发、不抛。
import { sha256Hex } from '../lib/seededRng.js';

// 红号归类（逐位照抄前端）：((n-1)%4)<2。
const RED = new Set(Array.from({ length: 75 }, (_, i) => i + 1).filter((n) => ((n - 1) % 4) < 2));
const isRed = (n) => RED.has(n);
const round2 = (x) => Math.round(x * 100) / 100;

// 组盘（固定 R）：初始计数 c、命中函数、R。逐位照抄前端。
const R_BS = 0.972;   // 大小/单双/红蓝统一 R
export const GROUPS = {
  big: { c: 38, R: R_BS, hit: (n) => n >= 38 },
  small: { c: 37, R: R_BS, hit: (n) => n <= 37 },
  odd: { c: 38, R: R_BS, hit: (n) => n % 2 === 1 },
  even: { c: 37, R: R_BS, hit: (n) => n % 2 === 0 },
  red: { c: 38, R: R_BS, hit: isRed },
  blue: { c: 37, R: R_BS, hit: (n) => !isRed(n) },
  'row-t1': { c: 5, R: 14.28 * 5 / 75, hit: (n) => n >= 1 && n <= 5 },
  'row-t3': { c: 15, R: 4.76 * 15 / 75, hit: (n) => n >= 6 && n <= 20 },
  'row-t5': { c: 25, R: 2.85 * 25 / 75, hit: (n) => n >= 21 && n <= 45 },
};
for (let col = 1; col <= 5; col++) {
  GROUPS[`col-${col}`] = { c: 15, R: 4.76 * 15 / 75, hit: (n) => (n - 1) % 5 === col - 1 };
}

// 组合：独立 R。c_combo = 剩余池里同时满足两侧的号数。逐位照抄前端。
export const COMBO = {
  'big-odd': ['big', 'odd'], 'small-odd': ['small', 'odd'],
  'big-even': ['big', 'even'], 'small-even': ['small', 'even'],
};
const R_COMBO = 0.955;
const comboHit = (key, n) => COMBO[key].every((s) => GROUPS[s].hit(n));
// 组合初始计数（大单/小单/大双=19、小双=18：38 为偶数落大侧）。逐位照抄前端。
export const COMBO_C = Object.fromEntries(Object.keys(COMBO).map((k) =>
  [k, Array.from({ length: 75 }, (_, i) => i + 1).filter((n) => comboHit(k, n)).length]));
const R_SINGLE = 0.9523;

// 命中判定（单个球号 n）。逐位照抄前端。
export function hitOf(key, n) {
  if (key.startsWith('num-')) return n === Number(key.slice(4));
  if (COMBO[key]) return COMBO[key].every((s) => GROUPS[s].hit(n));
  return GROUPS[key].hit(n);
}

// 动态赔率：第 ballIdx 球（0-2），revealed = 本球开出前已开号数组。逐位照抄前端。
// 已开号/c_k=0 → 返回 null（不可押）。
export function oddsFor(key, ballIdx, revealed) {
  const pool = 75 - ballIdx;   // 76 − k（k = ballIdx+1）
  if (COMBO[key]) {
    const c = COMBO_C[key] - revealed.filter((n) => comboHit(key, n)).length;
    if (c <= 0) return null;
    return round2(R_COMBO * pool / c);
  }
  if (key.startsWith('num-')) {
    const N = Number(key.slice(4));
    if (revealed.includes(N)) return null;   // 已开出 → 该球不可押（无放回）
    return round2(R_SINGLE * pool);
  }
  const g = GROUPS[key];
  const c = g.c - revealed.filter(g.hit).length;
  if (c <= 0) return null;
  return round2(g.R * pool / c);
}

// 按步现派：从剩余池抽 1（无放回，未开球不预抽）。remaining = [1..75]\revealed。rng 由 makeSeededRng 注入。
export function drawBall(remaining, rng) {
  return remaining[Math.floor(rng() * remaining.length)];
}

// 剩余池（1..75 去掉 revealed），按步现派 + oddsFor 复用。
export function remainingPool(revealed) {
  const set = new Set(revealed);
  const pool = [];
  for (let n = 1; n <= 75; n++) if (!set.has(n)) pool.push(n);
  return pool;
}

// 合法盘口 key 校验：num-1..75 / GROUPS 键 / COMBO 键。
export function isValidKey(key) {
  if (key.startsWith('num-')) { const N = Number(key.slice(4)); return Number.isInteger(N) && N >= 1 && N <= 75; }
  return Object.prototype.hasOwnProperty.call(GROUPS, key) || Object.prototype.hasOwnProperty.call(COMBO, key);
}

export { isRed, R_BS, R_COMBO, R_SINGLE };

export function hashSeed(serverSeed) {
  return sha256Hex(serverSeed);
}
export function newServerSeed() {
  // server-only：浏览器永不调用本函数；惰性取避免 import 期触碰 node:crypto
  const crypto = process.getBuiltinModule('node:crypto');
  return crypto.randomBytes(32).toString('hex');
}
export function newClientSeed() {
  // server-only：浏览器永不调用本函数；惰性取避免 import 期触碰 node:crypto
  const crypto = process.getBuiltinModule('node:crypto');
  return crypto.randomBytes(8).toString('hex');
}
