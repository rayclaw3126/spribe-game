// NumberUp 引擎对拍：ODDS/MARKETS 照抄前端 + 精确 RTP（枚举 50）逐市场 + 完备性 + 确定性 + seededRng 集成。
import crypto from 'crypto';
import { drawNumber, deriveNum, hitsOf, MARKETS, ODDS, HAS_PUSH, spin } from '../src/game/numberUp.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// ===== 1. ODDS 照抄前端 + HAS_PUSH =====
console.log('=== 常量照抄前端 ===');
check('ODDS = {pick:47.5, firstDigit:4.75, lastDigit:9.5, side:1.91}', JSON.stringify(ODDS) === JSON.stringify({ pick: 47.5, firstDigit: 4.75, lastDigit: 9.5, side: 1.91 }));
check('HAS_PUSH = false', HAS_PUSH === false);
const keys = Object.keys(MARKETS);
check('MARKETS 键数 = 69（直选50+首位5+尾位10+大小单双4）', keys.length === 69, `count=${keys.length}`);
check('键集含 n-00..n-49 / fd-0..4 / ld-0..9 / s-high/low/odd/even', keys.includes('n-00') && keys.includes('n-49') && keys.includes('fd-4') && keys.includes('ld-9') && ['s-high', 's-low', 's-odd', 's-even'].every((k) => keys.includes(k)));

// ===== 2. 精确 RTP（枚举 0–49）逐市场 =====
console.log('\n=== 精确 RTP（枚举 50）逐市场 ===');
const rtpOf = (key) => {
  let hits = 0;
  for (let num = 0; num < 50; num++) if (MARKETS[key].hit(deriveNum(num))) hits++;
  return { p: hits / 50, rtp: (hits / 50) * MARKETS[key].odds, hits };
};
const samples = { 'n-07': 0.95, 'fd-2': 0.95, 'ld-5': 0.95, 's-high': 0.955, 's-low': 0.955, 's-odd': 0.955, 's-even': 0.955 };
for (const [key, exp] of Object.entries(samples)) {
  const { p, rtp, hits } = rtpOf(key);
  const ok = Math.abs(rtp - exp) < 0.002;
  console.log(`  ${key.padEnd(7)} p=${p.toFixed(4)}(${hits}/50) × ${MARKETS[key].odds} = RTP ${(rtp * 100).toFixed(2)}%  (期望 ${(exp * 100).toFixed(1)}%)  ${ok ? '✓' : '✗'}`);
  check(`${key} RTP ≈ ${(exp * 100).toFixed(1)}%`, ok);
}
// 全 69 市场 RTP 都在 94–95.6%
let allInBand = true, minR = 1, maxR = 0;
for (const key of keys) { const { rtp } = rtpOf(key); minR = Math.min(minR, rtp); maxR = Math.max(maxR, rtp); if (!(rtp > 0.94 && rtp < 0.956)) allInBand = false; }
check('全 69 市场 RTP ∈ (94%, 95.6%)', allInBand, `范围 ${(minR * 100).toFixed(2)}%–${(maxR * 100).toFixed(2)}%`);

// ===== 3. 完备性：各组互补覆盖 50 =====
console.log('\n=== 完备性（各组命中概率和=1）===');
const nums = Array.from({ length: 50 }, (_, i) => i);
const disjoint = (ks) => { for (const num of nums) { let c = 0; for (const k of ks) if (MARKETS[k].hit(deriveNum(num))) c++; if (c !== 1) return false; } return true; };
const groupCount = (ks) => { let s = 0; for (const num of nums) if (ks.some((k) => MARKETS[k].hit(deriveNum(num)))) s++; return s; };
check('直选 50 键覆盖全部各 1', disjoint(nums.map((n) => `n-${String(n).padStart(2, '0')}`)));
check('首位 5 键覆盖 50 各 10', disjoint(['fd-0', 'fd-1', 'fd-2', 'fd-3', 'fd-4']) && groupCount(['fd-0']) === 10);
check('尾位 10 键覆盖 50 各 5', disjoint(['ld-0', 'ld-1', 'ld-2', 'ld-3', 'ld-4', 'ld-5', 'ld-6', 'ld-7', 'ld-8', 'ld-9']) && groupCount(['ld-0']) === 5);
check('大小 互补各 25', disjoint(['s-high', 's-low']) && groupCount(['s-high']) === 25);
check('单双 互补各 25', disjoint(['s-odd', 's-even']) && groupCount(['s-odd']) === 25);

// ===== 4. 确定性 + seededRng 集成 =====
console.log('\n=== 确定性 + seededRng 集成 ===');
const ss = 'a'.repeat(64);
check('同 seed drawNumber 两次一致', drawNumber(makeSeededRng(ss, 'cs', 7)) === drawNumber(makeSeededRng(ss, 'cs', 7)));
// spin 集成
const sp = spin(makeSeededRng(ss, 'cs', 7));
check('spin 返回 {drawResult.num, hits:Set, pushes:Set(空)}', Number.isInteger(sp.drawResult.num) && sp.drawResult.num >= 0 && sp.drawResult.num < 50 && sp.hits instanceof Set && sp.pushes instanceof Set && sp.pushes.size === 0, `num=${sp.drawResult.num} hits=${[...sp.hits].slice(0, 4)}`);
// 0–49 均匀
const NU = 2000000;
const freq = new Array(50).fill(0);
for (let i = 0; i < NU; i++) freq[drawNumber(makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i))]++;
const exp = NU / 50;
const maxDev = Math.max(...freq.map((c) => Math.abs(c - exp) / exp));
// 50 桶 2e6 样本：单桶 std≈0.5%，最大偏差 <2% 为正常方差（信任根对拍已严证 floor(U×50) 均匀）
check('drawNumber 0–49 均匀（最大偏差<2%）', maxDev < 0.02, `maxDev ${(maxDev * 100).toFixed(2)}%`);
// hitsOf 抽查：号 27 → 直选 n-27 / 首位 fd-2 / 尾位 ld-7 / high / odd
const r27 = hitsOf(deriveNum(27));
check('hitsOf(27) = n-27/fd-2/ld-7/s-high/s-odd', JSON.stringify([...r27].sort()) === JSON.stringify(['fd-2', 'ld-7', 'n-27', 's-high', 's-odd'].sort()), `[${[...r27].sort()}]`);

console.log(`\n${allPass ? 'ALL PASS ✅ NumberUp 引擎钉死' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
