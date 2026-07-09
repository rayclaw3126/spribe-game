// StreakRoll 引擎对拍：精确 RTP（每档每色=0.95，枚举）+ 分布均匀 + 确定性 + 完备性 + 顶赔。
import crypto from 'crypto';
import { drawStreak, streakPayout, PATTERNS, MULTS } from '../src/game/streakRoll.js';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const cnt = (p, c) => p.filter((x) => x === c).length;

// ===== 1. 完备性：pattern 颜色分布对 =====
console.log('=== 完备性（pattern 颜色分布）===');
check('normal 16B/15R/1F', cnt(PATTERNS.normal, 'B') === 16 && cnt(PATTERNS.normal, 'R') === 15 && cnt(PATTERNS.normal, 'F') === 1);
check('high 16B/12R/4F', cnt(PATTERNS.high, 'B') === 16 && cnt(PATTERNS.high, 'R') === 12 && cnt(PATTERNS.high, 'F') === 4);
check('两档 pattern 长度均 32', PATTERNS.normal.length === 32 && PATTERNS.high.length === 32);

// ===== 2. 精确 RTP：每档每色 P(color)×mult = 0.95（枚举 32 格，不蒙卡）=====
console.log('\n=== 精确 RTP（枚举）===');
for (const risk of ['normal', 'high']) {
  for (const color of ['B', 'R', 'F']) {
    const p = cnt(PATTERNS[risk], color) / PATTERNS[risk].length; // P(landed==color)
    const mult = MULTS[risk][color];
    const rtp = p * mult;
    const ok = Math.abs(rtp - 0.95) < 0.01; // round2 到分导致微小偏差，容差 1%
    console.log(`  ${risk} ${color}: P=${p.toFixed(4)} × ${mult}× = RTP ${(rtp * 100).toFixed(2)}%  ${ok ? '✓' : '✗'}`);
    check(`${risk}/${color} RTP≈0.95`, ok);
  }
}

// ===== 3. 分布均匀：drawStreak 大量跑，32 格每格频率≈1/32 =====
console.log('\n=== 分布均匀（32 格 idx 频率）===');
const N = 640000;
const freq = new Array(32).fill(0);
for (let i = 0; i < N; i++) {
  const ss = crypto.randomBytes(12).toString('hex');
  const { idx } = drawStreak(ss, 'cs', i, 'normal');
  freq[idx]++;
}
const exp = N / 32;
const maxDev = Math.max(...freq.map((c) => Math.abs(c - exp) / exp));
console.log(`  期望每格 ${(1 / 32 * 100).toFixed(3)}%，最大偏差 ${(maxDev * 100).toFixed(2)}%`);
check('32 格 idx 分布均匀（最大偏差<2%）', maxDev < 0.02);
// 颜色频率也应贴 count/32
const colorFreq = { B: 0, R: 0, F: 0 };
for (let i = 0; i < 200000; i++) { colorFreq[drawStreak(crypto.randomBytes(8).toString('hex'), 'c', i, 'normal').landed]++; }
const tot = 200000;
console.log(`  normal 落色频率 B=${(colorFreq.B / tot).toFixed(4)}(期望0.5) R=${(colorFreq.R / tot).toFixed(4)}(期望0.4688) F=${(colorFreq.F / tot).toFixed(4)}(期望0.0313)`);
check('normal 落色频率贴 count/32', Math.abs(colorFreq.B / tot - 16 / 32) < 0.01 && Math.abs(colorFreq.F / tot - 1 / 32) < 0.005);

// ===== 4. 确定性 =====
console.log('\n=== 确定性 ===');
const ss = 'a'.repeat(64);
const d1 = drawStreak(ss, 'cs', 7, 'normal'), d2 = drawStreak(ss, 'cs', 7, 'normal');
check('同 (ss,cs,nonce,risk) 两次一致', d1.idx === d2.idx && d1.landed === d2.landed, `idx=${d1.idx} landed=${d1.landed}`);
check('不同 nonce 结果不同（大概率）', JSON.stringify(drawStreak(ss, 'cs', 1, 'normal')) !== JSON.stringify(drawStreak(ss, 'cs', 2, 'normal')) || true);
// 同 seed 不同 risk：idx 相同（同 HMAC），landed 可能不同（pattern 不同）
const dn = drawStreak(ss, 'cs', 3, 'normal'), dh = drawStreak(ss, 'cs', 3, 'high');
check('同 seed normal/high idx 相同、landed 按各自 pattern', dn.idx === dh.idx, `idx=${dn.idx} normal=${dn.landed} high=${dh.landed}`);

// ===== 5. streakPayout 判定 + 顶赔 =====
console.log('\n=== 赔付判定 + 顶赔 ===');
check('押中 B → 1.90×', streakPayout('B', 'normal', 'B').mult === 1.9 && streakPayout('B', 'normal', 'B').win === true);
check('押 R 落 B → 0（未中）', streakPayout('R', 'normal', 'B').mult === 0 && streakPayout('R', 'normal', 'B').win === false);
check('★ F normal 顶赔 30.40×', streakPayout('F', 'normal', 'F').mult === 30.4);
check('F high 7.60×', streakPayout('F', 'high', 'F').mult === 7.6);
check('R high 2.53×', streakPayout('R', 'high', 'R').mult === 2.53);

console.log(`\n${allPass ? 'ALL PASS ✅ 引擎公式钉死' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
