// MiniRoulette 引擎对拍：精确 RTP（单号+6外围=0.95）+ 无偏(拒绝采样)+裸%12反例 + 确定性 + 完备性。
import crypto from 'crypto';
import { spinRoulette, rouletteWinMult, WHEEL_ORDER, RED_SET, SINGLE_MULT, OUTSIDE_MULT } from '../src/game/miniRoulette.js';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// ===== 1. 常量照抄前端 =====
console.log('=== 常量照抄前端 ===');
check('WHEEL_ORDER = [11,1,9,5,4,10,6,12,2,8,7,3]', JSON.stringify(WHEEL_ORDER) === JSON.stringify([11, 1, 9, 5, 4, 10, 6, 12, 2, 8, 7, 3]));
check('★ RED_SET = {1,3,5,8,10,12}（特定集合非奇数）', JSON.stringify([...RED_SET].sort((a, b) => a - b)) === JSON.stringify([1, 3, 5, 8, 10, 12]), `[${[...RED_SET]}]`);
check('SINGLE_MULT 11.4 / OUTSIDE_MULT 1.9', SINGLE_MULT === 11.4 && OUTSIDE_MULT === 1.9);

// ===== 2. 精确 RTP（枚举 12 号，单号 + 6 外围）=====
console.log('\n=== 精确 RTP（枚举）===');
// 单号：押 n1，命中 1 次（n=1）赢 11.4×，P=1/12
{
  let sum = 0; for (let n = 1; n <= 12; n++) sum += rouletteWinMult('n1', n);
  const rtp = sum / 12; // Σ mult / 12
  check('单号 n1 RTP=0.95', Math.abs(rtp - 0.95) < 1e-9, `${(rtp * 100).toFixed(2)}%`);
}
for (const key of ['red', 'black', 'odd', 'even', 'low', 'high']) {
  let hits = 0, sum = 0;
  for (let n = 1; n <= 12; n++) { const m = rouletteWinMult(key, n); if (m > 0) hits++; sum += m; }
  const rtp = sum / 12;
  check(`外围 ${key} RTP=0.95 (命中 ${hits}/12)`, Math.abs(rtp - 0.95) < 1e-9 && hits === 6, `${(rtp * 100).toFixed(2)}% hits=${hits}`);
}

// ===== 3. 无偏（拒绝采样）+ 裸 %12 反例 =====
console.log('\n=== 无偏（拒绝采样）+ 裸%12 反例 ===');
const N = 1200000;
const freq = new Array(13).fill(0);
for (let i = 0; i < N; i++) freq[spinRoulette(crypto.randomBytes(10).toString('hex'), 'cs', i)]++;
const dev = [];
for (let n = 1; n <= 12; n++) dev.push(Math.abs(freq[n] / N - 1 / 12) / (1 / 12));
console.log('  12 号频率:', Array.from({ length: 12 }, (_, i) => (freq[i + 1] / N).toFixed(4)).join(' '));
check('拒绝采样后 12 号严格均匀（最大偏差<1.5%）', Math.max(...dev) < 0.015, `maxDev ${(Math.max(...dev) * 100).toFixed(2)}%`);

// 反例：裸 %12（不拒绝）——低号(1-4)应偏多
function nakedSpin(ss, cs, nonce) {
  const hex = crypto.createHmac('sha256', ss).update(`${cs}:${nonce}:0`).digest('hex');
  return 1 + (parseInt(hex.slice(0, 2), 16) % 12);
}
const nf = new Array(13).fill(0);
for (let i = 0; i < N; i++) nf[nakedSpin(crypto.randomBytes(10).toString('hex'), 'c', i)]++;
const lowAvg = (nf[1] + nf[2] + nf[3] + nf[4]) / 4 / N;   // 号 1-4（byte%12 余 0-3 偏多）
const highAvg = (nf[9] + nf[10] + nf[11] + nf[12]) / 4 / N;
console.log(`  裸%12 反例: 低号(1-4)均频 ${lowAvg.toFixed(4)} vs 高号(9-12)均频 ${highAvg.toFixed(4)} (期望均 0.0833)`);
check('★ 裸%12 反例证明模偏真实（低号偏多、拒绝采样必要）', lowAvg > highAvg && (lowAvg - 1 / 12) > 0.002, `低${lowAvg.toFixed(4)} > 高${highAvg.toFixed(4)}`);

// ===== 4. 确定性 =====
console.log('\n=== 确定性 ===');
const ss = 'a'.repeat(64);
check('同 (ss,cs,nonce) 两次一致', spinRoulette(ss, 'cs', 7) === spinRoulette(ss, 'cs', 7), `n=${spinRoulette(ss, 'cs', 7)}`);
check('不同 nonce 大概率不同', spinRoulette(ss, 'cs', 1) !== spinRoulette(ss, 'cs', 2) || spinRoulette(ss, 'cs', 1) !== spinRoulette(ss, 'cs', 3));

// ===== 5. 完备性：红黑/奇偶/low-high 互补 =====
console.log('\n=== 完备性（互补不重不漏）===');
const nums = Array.from({ length: 12 }, (_, i) => i + 1);
const red = nums.filter((n) => rouletteWinMult('red', n) > 0);
const black = nums.filter((n) => rouletteWinMult('black', n) > 0);
check('红黑互补且各 6（不重不漏）', red.length === 6 && black.length === 6 && red.concat(black).sort((a, b) => a - b).join() === nums.join());
const odd = nums.filter((n) => rouletteWinMult('odd', n) > 0);
const even = nums.filter((n) => rouletteWinMult('even', n) > 0);
check('奇偶互补且各 6', odd.length === 6 && even.length === 6 && odd.concat(even).sort((a, b) => a - b).join() === nums.join());
const low = nums.filter((n) => rouletteWinMult('low', n) > 0);
const high = nums.filter((n) => rouletteWinMult('high', n) > 0);
check('low+high 覆盖全部且各 6', low.length === 6 && high.length === 6 && low.concat(high).sort((a, b) => a - b).join() === nums.join());

// ===== 6. winMult 抽查 =====
console.log('\n=== winMult 抽查 ===');
check('落 8：押 n8 命中 11.4×', rouletteWinMult('n8', 8) === 11.4);
check('落 8：red 命中 1.9×（8∈RED_SET）', rouletteWinMult('red', 8) === 1.9);
check('落 8：odd 未中 0（8 是偶数）', rouletteWinMult('odd', 8) === 0);
check('落 7：black 命中 1.9×（7∉RED_SET）', rouletteWinMult('black', 7) === 1.9);
check('落 3：low 命中 1.9×（3≤6），high 未中 0', rouletteWinMult('low', 3) === 1.9 && rouletteWinMult('high', 3) === 0);
check('落 3：押 n5 未中 0', rouletteWinMult('n5', 3) === 0);

console.log(`\n${allPass ? 'ALL PASS ✅ 引擎公式钉死' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
