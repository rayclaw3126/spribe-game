// 信任根 seededRng 对拍：均匀性（[0,1) 分 bins + floor(U×m) 各 m 档）+ 确定性 + 独立性。
import crypto from 'crypto';
import { makeSeededRng } from '../src/lib/seededRng.js';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// ===== 1. 均匀性：[0,1) 分 20 bins =====
console.log('=== 均匀性：[0,1) 分 20 bins ===');
{
  const BINS = 20, N = 4000000;
  const bins = new Array(BINS).fill(0);
  // 用多个 (ss,nonce) 造流，累计采样
  let rng = null, taken = 0;
  for (let i = 0; i < N; i++) {
    if (i % 5000 === 0) { rng = makeSeededRng(crypto.randomBytes(12).toString('hex'), 'cs', i); taken = 0; }
    const u = rng(); taken++;
    bins[Math.min(BINS - 1, Math.floor(u * BINS))]++;
  }
  const exp = N / BINS;
  const maxDev = Math.max(...bins.map((c) => Math.abs(c - exp) / exp));
  console.log(`  20 bins 最大偏差 ${(maxDev * 100).toFixed(2)}%（期望每 bin ${(100 / BINS).toFixed(1)}%）`);
  check('[0,1) 20 bins 均匀（最大偏差<1.5%）', maxDev < 0.015);
}

// ===== 2. floor(U×m) 各 m 档均匀（游戏实际用的 m）=====
console.log('\n=== floor(U×m) 各档均匀（m=6/24/50/80）===');
for (const m of [6, 24, 50, 80]) {
  const N = m * 40000;
  const freq = new Array(m).fill(0);
  let rng = null;
  for (let i = 0; i < N; i++) {
    if (i % 3000 === 0) rng = makeSeededRng(crypto.randomBytes(10).toString('hex'), 'c', i);
    freq[Math.floor(rng() * m)]++;
  }
  const exp = N / m;
  const maxDev = Math.max(...freq.map((c) => Math.abs(c - exp) / exp));
  console.log(`  m=${String(m).padStart(2)}：${m} 桶最大偏差 ${(maxDev * 100).toFixed(2)}%`);
  check(`floor(U×${m}) 均匀（最大偏差<2%）`, maxDev < 0.02);
}

// ===== 3. 确定性：同 (ss,cs,nonce) 造的 rng，连续序列完全一致 =====
console.log('\n=== 确定性 ===');
const ss = 'a'.repeat(64);
const seqA = Array.from({ length: 50 }, makeSeededRng(ss, 'cs', 7));
// makeSeededRng 返回函数；Array.from(len, fn) 会把 fn 当 mapFn 调用（忽略参数）→ 连续取 50 个
const rngB = makeSeededRng(ss, 'cs', 7);
const seqB = Array.from({ length: 50 }, () => rngB());
check('同 (ss,cs,nonce) 连续 50 次序列完全一致', JSON.stringify(seqA) === JSON.stringify(seqB), `first3=[${seqA.slice(0, 3).map((x) => x.toFixed(6)).join(',')}]`);
// 跨块续熵（>4 次调用跨 HMAC 块）也确定
const rngC = makeSeededRng(ss, 'cs', 7);
const seqC = Array.from({ length: 50 }, () => rngC());
check('跨 HMAC 块续熵仍确定（50 次一致）', JSON.stringify(seqA) === JSON.stringify(seqC));

// ===== 4. 独立性：连续 rng() 值不相关（相邻对落 2D 网格均匀）=====
console.log('\n=== 独立性（相邻对 2D 均匀）===');
{
  const G = 10, N = 2000000;
  const grid = Array.from({ length: G * G }, () => 0);
  let rng = makeSeededRng(crypto.randomBytes(12).toString('hex'), 'c', 1);
  let prev = rng();
  for (let i = 1; i < N; i++) {
    if (i % 8000 === 0) { rng = makeSeededRng(crypto.randomBytes(12).toString('hex'), 'c', i); prev = rng(); continue; }
    const cur = rng();
    grid[Math.floor(prev * G) * G + Math.floor(cur * G)]++;
    prev = cur;
  }
  const exp = grid.reduce((s, x) => s + x, 0) / (G * G);
  const maxDev = Math.max(...grid.map((c) => Math.abs(c - exp) / exp));
  console.log(`  10×10 相邻对网格最大偏差 ${(maxDev * 100).toFixed(2)}%`);
  check('相邻 rng() 独立（2D 网格均匀，偏差<3%）', maxDev < 0.03);
}

// ===== 5. 不同 nonce/seed 产不同序列 =====
console.log('\n=== 不同 nonce/seed 不同序列 ===');
const r1 = makeSeededRng(ss, 'cs', 1)(), r2 = makeSeededRng(ss, 'cs', 2)();
const r3 = makeSeededRng('b'.repeat(64), 'cs', 1)();
check('不同 nonce 首值不同', r1 !== r2);
check('不同 serverSeed 首值不同', r1 !== r3);

console.log(`\n${allPass ? 'ALL PASS ✅ 信任根 seededRng 钉死' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
