// Streak Roll（连胜转盘）可验证公平核心算法（纯函数，便于单测/对拍）。原子局：押颜色→滚停落格→结算。
//
// ⚠️ 埋尸点铁律：PATTERN_NORMAL / PATTERN_HIGH / RTP / multsFor 逐位照抄前端
//    src/games/StreakRoll.jsx，改一处必须改两处，一个数都别动别重算。
//
// 落格不信前端：drawStreak 用与 dice 同款 HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`)
// 派生的 [0,1) 浮点 → idx = floor(r × 32)。2^52 % 32 = 0，32 个桶【严格等概率】，无模偏、
// 无需拒绝采样（且玩家押颜色不押 idx）。只要事后公开 serverSeed，任何人能用 clientSeed+nonce
// 重算同一落格，验证服务端没在开奖后改点。
import crypto from 'crypto';

const RTP = 0.95;

// 32 格 pattern（B=黑 / R=红 / F=火），逐位照抄前端 StreakRoll.jsx。
//   normal: 16B · 15R · 1F  → B 1.90× R 2.03× F 30.40×
//   high:   16B · 12R · 4F  → B 1.90× R 2.53× F 7.60×
const PATTERN_NORMAL = [
  ...Array.from({ length: 30 }, (_, i) => (i % 2 ? 'R' : 'B')),  // B/R ×15
  'B', 'F',
];
const PATTERN_HIGH = [
  ...Array.from({ length: 24 }, (_, i) => (i % 2 ? 'R' : 'B')),  // B/R ×12
  'B', 'F', 'B', 'F', 'B', 'F', 'B', 'F',
];

const round2 = (x) => Math.round(x * 100) / 100;
// 赔率：payout = RTP / P(color) = RTP × n / count(color)，逐位照抄前端 multsFor。
function multsFor(pattern) {
  const n = pattern.length;
  const count = (c) => pattern.filter((x) => x === c).length;
  return { R: round2(RTP * n / count('R')), B: round2(RTP * n / count('B')), F: round2(RTP * n / count('F')) };
}

export const PATTERNS = { normal: PATTERN_NORMAL, high: PATTERN_HIGH };
export const MULTS = { normal: multsFor(PATTERN_NORMAL), high: multsFor(PATTERN_HIGH) };

/**
 * 由 serverSeed + clientSeed + nonce + risk 确定性派生本局落格（idx + 落格颜色）。
 * idx = floor(r × 32)，r = HMAC 前 13 hex(52bit) / 2^52，桶严格等概率。
 * @param {string} serverSeed - 私密种子，reveal 前绝不广播
 * @param {string} clientSeed - 公开种子
 * @param {string|number} nonce
 * @param {'normal'|'high'} risk - 风险档，决定用哪套 pattern
 * @returns {{ idx:number, landed:'B'|'R'|'F' }}
 */
export function drawStreak(serverSeed, clientSeed, nonce, risk) {
  const pattern = PATTERNS[risk];
  const hex = crypto
    .createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');
  const r = parseInt(hex.slice(0, 13), 16) / Math.pow(2, 52);
  const idx = Math.floor(r * pattern.length);
  return { idx, landed: pattern[idx] };
}

/**
 * 结算：押注色 color 与落格 landed 相同则中，mult = MULTS[risk][color]，否则 0。
 * @param {'B'|'R'|'F'} color - 玩家押的颜色
 * @param {'normal'|'high'} risk
 * @param {'B'|'R'|'F'} landed - 落格颜色
 * @returns {{ win:boolean, mult:number }}
 */
export function streakPayout(color, risk, landed) {
  const win = landed === color;
  const mult = win ? MULTS[risk][color] : 0;
  return { win, mult };
}

/** 对 serverSeed 做 commit hash（reveal 前只广播 hash）。 */
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
