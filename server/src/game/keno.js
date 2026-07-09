// Team Keno（36 号池，选 ≤10，每局摇 10）可验证公平核心算法（纯函数，便于单测/对拍）。
//
// ⚠️ 埋尸点铁律：下方 PAYOUTS 赔率表【逐位照抄前端 src/games/Keno.jsx 的 PAYOUTS】，
//    RTP 焊在表里——改一处必须改两处，一个数都别动别重算。
//
// 摇号不信前端：drawKeno 用与 dice/mines 同款 HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${counter}`)
// 派生的确定性随机做部分 Fisher-Yates，产 10 个互不相同的 1–36 球。只要事后公开 serverSeed，
// 任何人都能用 clientSeed + nonce 重算出同一组摇号，验证服务端没在开奖后改号。
import crypto from 'crypto';

export const TOTAL = 36;   // 号池大小（可见 6×6 盘）
export const DRAW = 10;    // 每局摇出的球数

// 标准 keno 赔率表（draw-10-of-36），[picks][hits] = 倍数。
// 逐位对应前端 Keno.jsx 的 PAYOUTS，RTP≈85–93%/档，禁改。
export const PAYOUTS = {
  1:  { 1: 3.4 },
  2:  { 2: 13 },
  3:  { 2: 2, 3: 35 },
  4:  { 2: 1, 3: 7, 4: 80 },
  5:  { 3: 3, 4: 22, 5: 450 },
  6:  { 3: 1, 4: 8, 5: 90, 6: 1500 },
  7:  { 4: 4, 5: 30, 6: 350, 7: 8000 },
  8:  { 4: 2, 5: 13, 6: 110, 7: 1200, 8: 10000 },
  9:  { 5: 6, 6: 60, 7: 500, 8: 5000, 9: 10000 },
  10: { 5: 3, 6: 25, 7: 150, 8: 2500, 9: 10000, 10: 10000 },
};

/**
 * 由 serverSeed + clientSeed + nonce 确定性派生本局摇出的 10 个球（1–36，互不相同，升序）。
 * 与 mines.deriveMines 同款熵扩展部分 Fisher-Yates：需要新随机字节时，熵池不足就用
 * `${clientSeed}:${nonce}:${counter}` 追加派生一段 HMAC-SHA256 摘要，保证可外部重算复现。
 * @param {string} serverSeed - 私密种子，reveal 前绝不广播
 * @param {string} clientSeed - 公开种子
 * @param {string|number} nonce
 * @returns {number[]} 升序的 10 个 1–36 球
 */
export function drawKeno(serverSeed, clientSeed, nonce) {
  const pool = Array.from({ length: TOTAL }, (_, i) => i + 1); // 1..36
  let hex = '';
  let counter = 0;
  const nextByte = () => {
    if (hex.length < 2) {
      hex = crypto
        .createHmac('sha256', serverSeed)
        .update(`${clientSeed}:${nonce}:${counter++}`)
        .digest('hex');
    }
    const b = parseInt(hex.slice(0, 2), 16);
    hex = hex.slice(2);
    return b;
  };
  // 均匀取 [0,m) —— 拒绝采样消除模偏（256 不整除 m 会偏向小索引）。
  // 前端摇号用无偏 Math.random；服务端必须同为无偏，否则玩家挑特定号码可套利 RTP。
  // 仍完全确定性可复算：拒绝规则公开，任何人用同 seed 能重放同一序列。
  const uniform = (m) => {
    const limit = 256 - (256 % m); // 可接受区间上界（其上有模偏，丢弃重抽）
    let b;
    do { b = nextByte(); } while (b >= limit);
    return b % m;
  };
  for (let i = 0; i < DRAW; i++) {
    const j = i + uniform(TOTAL - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, DRAW).sort((a, b) => a - b);
}

/**
 * 结算：命中数 = 玩家选号 ∩ 摇出号 的大小；倍数 = PAYOUTS[picks][hits] || 0。
 * 服务端自算 matches，不信前端传的 matches/payout。
 * @param {number[]} selected - 玩家选号（1–36，互不相同，1–10 个）
 * @param {number[]} drawn - 本局摇出的 10 个球
 * @returns {{ matches:number, mult:number }}
 */
export function kenoPayout(selected, drawn) {
  const drawnSet = new Set(drawn);
  let matches = 0;
  for (const n of selected) if (drawnSet.has(n)) matches++;
  const picks = selected.length;
  const mult = PAYOUTS[picks]?.[matches] ?? 0;
  return { matches, mult };
}

/** 对 serverSeed 做 commit hash（与其它游戏一致，reveal 前只广播 hash）。 */
export function hashSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

/** 新私密 serverSeed（32 字节随机，hex）。 */
export function newServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/** 新公开 clientSeed（8 字节随机，hex）。 */
export function newClientSeed() {
  return crypto.randomBytes(8).toString('hex');
}
