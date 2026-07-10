// LineUp 引擎对拍：ODDS/段位带边界/行和分界照抄前端 + 逐行和/段位带精确 RTP(卷积 PMF + 二项) + MC sanity + 无 push + 完备性 + seededRng 集成。
import crypto from 'crypto';
import { drawGrid, deriveRound, hitsOf, MARKETS, ODDS, HAS_PUSH, spin, AWAY_DIGITS, HIGH_DIGITS } from '../src/game/lineUp.js';
import { makeSeededRng } from '../src/lib/seededRng.js';
import { digitSumCounts, probWhere, probBand, binomTailGE } from './lib/digitSumPmf.mjs';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// ===== 1. 常量照抄前端 + HAS_PUSH =====
console.log('=== 常量照抄前端 ===');
check('ODDS = {main:1.95, edge:8.0, mid:2.5}（段位带用调整后 8.0/2.5，非注释参考 7.5/2.3）', JSON.stringify(ODDS) === JSON.stringify({ main: 1.95, edge: 8.0, mid: 2.5 }));
check('AWAY_DIGITS = {0,2,6,7,8}（红牌）', JSON.stringify([...AWAY_DIGITS].sort((a, b) => a - b)) === JSON.stringify([0, 2, 6, 7, 8]));
check('HIGH_DIGITS = {5,6,7,8,9}（高）', JSON.stringify([...HIGH_DIGITS].sort((a, b) => a - b)) === JSON.stringify([5, 6, 7, 8, 9]));
check('HAS_PUSH = false', HAS_PUSH === false);
const keys = Object.keys(MARKETS);
check('MARKETS 键数 = 42（8 全局二元 + 4 段位 + 5×6 行式）', keys.length === 42, `count=${keys.length}`);
// 边界照抄（构造 total/rowSums 采样）
const mk = (over) => ({ total: 0, rowSums: [0, 0, 0, 0, 0], rowAway: [0, 0, 0, 0, 0], homeCount: 0, awayCount: 0, highCount: 0, lowCount: 0, ...over });
check('总和大小分界：big≥113 / small≤112', MARKETS.big.hit(mk({ total: 113 })) && !MARKETS.big.hit(mk({ total: 112 })) && MARKETS.small.hit(mk({ total: 112 })) && !MARKETS.small.hit(mk({ total: 113 })));
check('段位带边界：releg≤95 / mid 96-112 / euro 113-129 / champ≥130', MARKETS['zone-releg'].hit(mk({ total: 95 })) && !MARKETS['zone-releg'].hit(mk({ total: 96 })) && MARKETS['zone-mid'].hit(mk({ total: 96 })) && MARKETS['zone-mid'].hit(mk({ total: 112 })) && MARKETS['zone-euro'].hit(mk({ total: 113 })) && MARKETS['zone-euro'].hit(mk({ total: 129 })) && MARKETS['zone-champ'].hit(mk({ total: 130 })) && !MARKETS['zone-champ'].hit(mk({ total: 129 })));
check('行和大小分界：L1-big rowSum≥23 / L1-small ≤22', MARKETS['L1-big'].hit(mk({ rowSums: [23, 0, 0, 0, 0] })) && !MARKETS['L1-big'].hit(mk({ rowSums: [22, 0, 0, 0, 0] })) && MARKETS['L1-small'].hit(mk({ rowSums: [22, 0, 0, 0, 0] })) && !MARKETS['L1-small'].hit(mk({ rowSums: [23, 0, 0, 0, 0] })));
check('行式红黄分界：L1-home rowAway≤2 / L1-away ≥3', MARKETS['L1-home'].hit(mk({ rowAway: [2, 0, 0, 0, 0] })) && !MARKETS['L1-home'].hit(mk({ rowAway: [3, 0, 0, 0, 0] })) && MARKETS['L1-away'].hit(mk({ rowAway: [3, 0, 0, 0, 0] })));

// ===== 2. 独立数字和 PMF（卷积，25 位总和 & 5 位行和）=====
console.log('\n=== 独立数字和 PMF（卷积）===');
const pmf25 = digitSumCounts(25, 10);   // 总和 0-225
const pmf5 = digitSumCounts(5, 10);     // 行和 0-45
check('总和 PMF：total=10^25、和值域 [0,225]', pmf25.total === 10n ** 25n && pmf25.maxSum === 225);
check('行和 PMF：total=10^5、和值域 [0,45]', pmf5.total === 100000n && pmf5.maxSum === 45);
check('总和 PMF 对称于 112.5（count(s)==count(225-s)）', [0, 50, 100, 112, 150].every((s) => pmf25.counts[s] === pmf25.counts[225 - s]));
check('行和 PMF 对称于 22.5（count(s)==count(45-s)）', [0, 10, 20, 22, 30].every((s) => pmf5.counts[s] === pmf5.counts[45 - s]));

// ===== 3. 精确 RTP =====
console.log('\n=== 精确 RTP ===');
// 二元盘：全部精确 0.5 → 1.95×0.5=97.5%
const pBigTotal = probWhere(pmf25, (s) => s >= 113);
const pOddTotal = probWhere(pmf25, (s) => s % 2 === 1);
const pRowBig = probWhere(pmf5, (s) => s >= 23);
const pRowOdd = probWhere(pmf5, (s) => s % 2 === 1);
const pCount25 = binomTailGE(25, 13);   // homeCount/awayCount/highCount/lowCount ≥13，Bin(25,1/2)
const pRowAway = binomTailGE(5, 3);     // rowAway≥3，Bin(5,1/2)
console.log(`  二元盘 P：总和大 ${pBigTotal.toFixed(6)} / 总和奇 ${pOddTotal.toFixed(6)} / 行和大 ${pRowBig.toFixed(6)} / 行和奇 ${pRowOdd.toFixed(6)} / 计数≥13 ${pCount25.toFixed(6)} / 行红≥3 ${pRowAway.toFixed(6)}`);
check('全二元盘精确 P=0.5（总和/行和大小·单双、红黄/高低计数、行式）', [pBigTotal, pOddTotal, pRowBig, pRowOdd, pCount25, pRowAway].every((p) => Math.abs(p - 0.5) < 1e-9));
check('二元盘 RTP = 1.95 × 0.5 = 97.5%（带上沿）', Math.abs(1.95 * 0.5 - 0.975) < 1e-9);
// 段位带（总和 PMF）
const pReleg = probBand(pmf25, 0, 95), pChamp = probBand(pmf25, 130, 225);
const pMid = probBand(pmf25, 96, 112), pEuro = probBand(pmf25, 113, 129);
console.log(`  段位 P：降级≤95 ${pReleg.toFixed(6)} / 夺冠≥130 ${pChamp.toFixed(6)} / 中游96-112 ${pMid.toFixed(6)} / 欧战113-129 ${pEuro.toFixed(6)}`);
check('段位边（降级/夺冠）P≈0.118991 对称、RTP 8.0×P=95.19%', Math.abs(pReleg - 0.118991) < 1e-5 && Math.abs(pReleg - pChamp) < 1e-12 && Math.abs(pReleg * ODDS.edge - 0.9519) < 0.001, `releg=${pReleg.toFixed(6)} rtp=${(pReleg * ODDS.edge * 100).toFixed(2)}%`);
check('段位中（中游/欧战）P≈0.381009 对称、RTP 2.5×P=95.25%', Math.abs(pMid - 0.381009) < 1e-5 && Math.abs(pMid - pEuro) < 1e-12 && Math.abs(pMid * ODDS.mid - 0.9525) < 0.001, `mid=${pMid.toFixed(6)} rtp=${(pMid * ODDS.mid * 100).toFixed(2)}%`);
check('段位 4 带覆盖全域和=1（无重叠无空隙）', Math.abs(pReleg + pMid + pEuro + pChamp - 1) < 1e-9);
check('大小互补=1、段位无平局无中点（225/45 奇数）', Math.abs(probWhere(pmf25, (s) => s >= 113) + probWhere(pmf25, (s) => s <= 112) - 1) < 1e-9);

// 全 42 市场精确 RTP 合理带
const exact = {};
for (const k of keys) {
  if (k.startsWith('zone-')) exact[k] = (k === 'zone-releg' || k === 'zone-champ') ? pReleg * ODDS.edge : pMid * ODDS.mid;
  else exact[k] = 0.5 * ODDS.main;   // 全二元盘
}
let band = true, minR = 1, maxR = 0;
for (const k of keys) { const r = exact[k]; minR = Math.min(minR, r); maxR = Math.max(maxR, r); if (!(r >= 0.94 && r <= 0.9751)) band = false; }
check('全 42 市场精确 RTP ∈ [94%, 97.5%]', band, `范围 ${(minR * 100).toFixed(2)}%–${(maxR * 100).toFixed(2)}%`);

// ===== 4. 无 push =====
console.log('\n=== 无 push ===');
check('spin().pushes 恒空集（二元盘精确互补，无退注）', [...Array(30)].every((_, i) => spin(makeSeededRng('a'.repeat(64), 'c', i)).pushes.size === 0));

// ===== 5. MC sanity（5e6 局，证明 drawGrid 对）=====
console.log('\n=== MC sanity（5e6 局，各市场 MC RTP 贴精确）===');
const NMC = 5_000_000;
const mcHit = Object.fromEntries(keys.map((k) => [k, 0]));
let totAcc = 0;
for (let i = 0; i < NMC; i++) {
  const r = deriveRound(drawGrid(makeSeededRng('lumc', 'c', i)));
  totAcc += r.total;
  for (const k of keys) if (MARKETS[k].hit(r)) mcHit[k]++;
}
check('MC 总和均值 ≈ 112.5', Math.abs(totAcc / NMC - 112.5) < 0.3, `mean=${(totAcc / NMC).toFixed(3)}`);
let mcOk = true, worst = 0, worstK = '';
for (const k of keys) { const mcR = (mcHit[k] / NMC) * MARKETS[k].odds; const dev = Math.abs(mcR - exact[k]); if (dev > worst) { worst = dev; worstK = k; } if (dev > 0.006) mcOk = false; }
check('全市场 MC RTP 贴精确（最大偏差<0.6%，证明 drawGrid 无偏）', mcOk, `worst=${worstK} dev=${(worst * 100).toFixed(3)}%`);

// ===== 6. 完备性 + 确定性 + seededRng 集成 =====
console.log('\n=== 完备性 + 确定性 + seededRng 集成 ===');
const ss = 'a'.repeat(64);
check('同 seed drawGrid 两次一致', JSON.stringify(drawGrid(makeSeededRng(ss, 'cs', 7))) === JSON.stringify(drawGrid(makeSeededRng(ss, 'cs', 7))));
const sp = spin(makeSeededRng(ss, 'cs', 7));
check('spin 返回 {drawResult:{grid[25],rowSums[5],total}, hits:Set, pushes:Set(空)}',
  Array.isArray(sp.drawResult.grid) && sp.drawResult.grid.length === 25 && sp.drawResult.grid.every((n) => n >= 0 && n <= 9) &&
  Array.isArray(sp.drawResult.rowSums) && sp.drawResult.rowSums.length === 5 &&
  sp.drawResult.total === sp.drawResult.grid.reduce((a, b) => a + b, 0) &&
  sp.drawResult.rowSums.reduce((a, b) => a + b, 0) === sp.drawResult.total &&
  sp.hits instanceof Set && sp.pushes instanceof Set && sp.pushes.size === 0,
  `total=${sp.drawResult.total} rowSums=${sp.drawResult.rowSums}`);
// 每位 0-9 均匀（25 位 × 抽样）
const digFreq = new Array(10).fill(0);
const NMC2 = 300000;
for (let i = 0; i < NMC2; i++) for (const d of drawGrid(makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i))) digFreq[d]++;
const expDig = (NMC2 * 25) / 10;
let maxDev = 0; for (let d = 0; d < 10; d++) maxDev = Math.max(maxDev, Math.abs(digFreq[d] - expDig) / expDig);
check('25 位各 0-9 均匀（可放回无偏，最大偏差<2%）', maxDev < 0.02, `maxDev ${(maxDev * 100).toFixed(2)}%`);

console.log(`\n${allPass ? 'ALL PASS ✅ LineUp 引擎钉死（digitSumPmf 可复用）' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
