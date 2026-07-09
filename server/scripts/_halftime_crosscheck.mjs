// HalfTime 引擎对拍：ODDS/五行带边界照抄前端 + 和值带市场精确 RTP(PMF) + 半场超几何精确 RTP + MC sanity 贴精确 + draw 非 push + 完备性 + seededRng 集成。
import crypto from 'crypto';
import { drawRound, deriveRound, halfOf, hitsOf, MARKETS, ODDS, HAS_PUSH, spin } from '../src/game/halfTime.js';
import { makeSeededRng } from '../src/lib/seededRng.js';
import { kenoSumCounts, bigProb, probSumWhere, hyperProb } from './lib/kenoSumPmf.mjs';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// ===== 1. 常量照抄前端 + HAS_PUSH =====
console.log('=== 常量照抄前端 ===');
const EXPECT_ODDS = { over: 1.95, under: 1.90, odd: 1.95, even: 1.95, 'p-oo': 3.8, 'p-oe': 3.8, 'p-uo': 3.8, 'p-ue': 3.8, og: 9.25, df: 4.7, mf: 2.46, at: 4.7, gl: 9.25, h1: 2.4, draw: 4.7, h2: 2.4 };
check('ODDS 逐位照抄（16 项）', JSON.stringify(ODDS) === JSON.stringify(EXPECT_ODDS));
check('HAS_PUSH = false', HAS_PUSH === false);
const keys = Object.keys(MARKETS);
check('MARKETS 键数 = 16（大小2+单双2+二串4+五行带5+半场3）', keys.length === 16, `count=${keys.length}`);
// 五行带边界照抄确认（用 hit 谓词在边界值上采样）
const dr = (sum, lowCount = 10) => ({ sum, lowCount });
check('五行带边界：og≤695 / df 696-763 / mf 764-855 / at 856-923 / gl≥924', MARKETS.og.hit(dr(695)) && !MARKETS.og.hit(dr(696)) && MARKETS.df.hit(dr(696)) && MARKETS.df.hit(dr(763)) && MARKETS.mf.hit(dr(764)) && MARKETS.mf.hit(dr(855)) && MARKETS.at.hit(dr(856)) && MARKETS.at.hit(dr(923)) && MARKETS.gl.hit(dr(924)) && !MARKETS.gl.hit(dr(923)));
check('大小边界：over≥811 / under≤810（810 归 under，非对称）', MARKETS.over.hit(dr(811)) && !MARKETS.over.hit(dr(810)) && MARKETS.under.hit(dr(810)) && !MARKETS.under.hit(dr(811)));

// ===== 2. 和值精确 PMF（DP）=====
console.log('\n=== 和值精确 PMF（DP，1..80 取 20）===');
const t0 = Date.now();
const pmf = kenoSumCounts(80, 20);
console.log(`  PMF 算完 ${Date.now() - t0}ms；total=C(80,20)=${pmf.total}  和值域 [${pmf.minSum}, ${pmf.maxSum}]`);
check('和值域 = [210, 1410]', pmf.minSum === 210 && pmf.maxSum === 1410);
check('total = C(80,20) = 3535316142212174320', pmf.total === 3535316142212174320n);
// PMF 归一：全和值概率和 = 1
let pAll = 0; for (let s = pmf.minSum; s <= pmf.maxSum; s++) pAll += bigProb(pmf.counts[s], pmf.total);
check('PMF 归一（全和值 P 和 ≈ 1）', Math.abs(pAll - 1) < 1e-9, `ΣP=${pAll.toFixed(12)}`);
// 对称性：count(s) == count(1620-s)（和值对称于 810，x↔81-x 双射）
check('和值分布对称于 810（count(s)==count(1620-s)）', [300, 500, 700, 810, 900].every((s) => pmf.counts[s] === pmf.counts[1620 - s]));

// ===== 3. 和值带市场精确 RTP（PMF，非 MC）=====
console.log('\n=== 和值带市场精确 RTP（PMF）===');
const bandRtp = (key, pred) => { const p = probSumWhere(pmf, pred); return { p, rtp: p * MARKETS[key].odds }; };
const bandMarkets = [
  ['over', (s) => s >= 811], ['under', (s) => s <= 810],
  ['odd', (s) => s % 2 === 1], ['even', (s) => s % 2 === 0],
  ['og', (s) => s <= 695], ['df', (s) => s >= 696 && s <= 763], ['mf', (s) => s >= 764 && s <= 855], ['at', (s) => s >= 856 && s <= 923], ['gl', (s) => s >= 924],
  ['p-oo', (s) => s >= 811 && s % 2 === 1], ['p-oe', (s) => s >= 811 && s % 2 === 0], ['p-uo', (s) => s <= 810 && s % 2 === 1], ['p-ue', (s) => s <= 810 && s % 2 === 0],
];
const exactRtp = {};
let bandBand = true, minR = 1, maxR = 0;
for (const [key, pred] of bandMarkets) {
  const { p, rtp } = bandRtp(key, pred);
  exactRtp[key] = rtp;
  minR = Math.min(minR, rtp); maxR = Math.max(maxR, rtp);
  if (!(rtp >= 0.94 && rtp <= 0.9751)) bandBand = false;   // 97.5% 压线（odd/even 精确 0.975，前端设计上限）含端
  console.log(`  ${key.padEnd(5)} P=${p.toFixed(5)} × ${MARKETS[key].odds} = RTP ${(rtp * 100).toFixed(2)}%`);
}
check('全和值带市场精确 RTP ∈ [94%, 97.5%]（odd/even 97.5% 压线，前端设计上限）', bandBand, `范围 ${(minR * 100).toFixed(2)}%–${(maxR * 100).toFixed(2)}%`);
check('over+under 概率互补 = 1', Math.abs(probSumWhere(pmf, (s) => s >= 811) + probSumWhere(pmf, (s) => s <= 810) - 1) < 1e-9);
check('五行带 og+df+mf+at+gl 概率和 = 1（覆盖全和值域不重不漏）', Math.abs(['og', 'df', 'mf', 'at', 'gl'].reduce((a, [,]) => a, 0) + probSumWhere(pmf, (s) => s <= 695) + probSumWhere(pmf, (s) => s >= 696 && s <= 763) + probSumWhere(pmf, (s) => s >= 764 && s <= 855) + probSumWhere(pmf, (s) => s >= 856 && s <= 923) + probSumWhere(pmf, (s) => s >= 924) - 1) < 1e-9);

// ===== 4. 半场计数超几何精确 RTP =====
console.log('\n=== 半场 h1/draw/h2 超几何精确 RTP（N=80,K=40,n=20）===');
// lowCount = # 球 ≤40，X~Hypergeom(80,40,20)
const pDraw = hyperProb(80, 40, 20, 10);
let pH1 = 0; for (let k = 11; k <= 20; k++) pH1 += hyperProb(80, 40, 20, k);
let pH2 = 0; for (let k = 0; k <= 9; k++) pH2 += hyperProb(80, 40, 20, k);
console.log(`  P(draw=10)=${pDraw.toFixed(5)} × 4.7 = ${(pDraw * ODDS.draw * 100).toFixed(2)}%`);
console.log(`  P(h1>10)=${pH1.toFixed(5)} × 2.4 = ${(pH1 * ODDS.h1 * 100).toFixed(2)}%   P(h2<10)=${pH2.toFixed(5)} × 2.4 = ${(pH2 * ODDS.h2 * 100).toFixed(2)}%`);
check('P(draw=10) ≈ 0.20324（众数）', Math.abs(pDraw - 0.20324) < 0.0005, `${pDraw.toFixed(5)}`);
check('h1/h2 对称 P(>10)==P(<10) ≈ 0.39838', Math.abs(pH1 - pH2) < 1e-9 && Math.abs(pH1 - 0.39838) < 0.0005, `h1=${pH1.toFixed(5)} h2=${pH2.toFixed(5)}`);
check('h1+draw+h2 概率互补 = 1', Math.abs(pH1 + pDraw + pH2 - 1) < 1e-9);
const halfRtp = { h1: pH1 * ODDS.h1, draw: pDraw * ODDS.draw, h2: pH2 * ODDS.h2 };
check('半场市场 RTP ∈ (94%, 97.5%)', Object.values(halfRtp).every((r) => r > 0.94 && r < 0.975), `h1=${(halfRtp.h1 * 100).toFixed(2)}% draw=${(halfRtp.draw * 100).toFixed(2)}% h2=${(halfRtp.h2 * 100).toFixed(2)}%`);

// ===== 5. draw 非 push 确认 =====
console.log('\n=== draw 非 push ===');
check('draw 是独立 hit 市场（lowCount===10 命中，有赔率 4.7）', MARKETS.draw.hit(dr(810, 10)) && !MARKETS.draw.hit(dr(810, 11)) && MARKETS.draw.odds === 4.7);
check('spin().pushes 恒空集（draw 判 hit/lose 两态，不退注）', [...Array(30)].every((_, i) => spin(makeSeededRng('a'.repeat(64), 'c', i)).pushes.size === 0));

// ===== 6. MC sanity（主体，证明引擎 drawRound 对）=====
console.log('\n=== MC sanity（5e6 局，验和值分布贴 PMF + 各市场 MC RTP 贴精确）===');
const NMC = 5_000_000;
const mcHit = Object.fromEntries(keys.map((k) => [k, 0]));
let sumAcc = 0, sumSq = 0;
for (let i = 0; i < NMC; i++) {
  const r = deriveRound(drawRound(makeSeededRng('mc', 'c', i)));
  sumAcc += r.sum; sumSq += r.sum * r.sum;
  for (const k of keys) if (MARKETS[k].hit(r)) mcHit[k]++;
}
const meanSum = sumAcc / NMC, sd = Math.sqrt(sumSq / NMC - meanSum * meanSum);
check('MC 和值均值 ≈ 810（对称中心）', Math.abs(meanSum - 810) < 1.5, `mean=${meanSum.toFixed(2)} sd=${sd.toFixed(1)}`);
// 各市场 MC RTP 贴精确 RTP（band 用 PMF，half 用超几何）
const allExact = { ...exactRtp, ...halfRtp };
let mcOk = true, worst = 0, worstK = '';
for (const k of keys) {
  const mcR = (mcHit[k] / NMC) * MARKETS[k].odds;
  const dev = Math.abs(mcR - allExact[k]);
  if (dev > worst) { worst = dev; worstK = k; }
  if (dev > 0.006) mcOk = false;   // 5e6 样本，RTP 偏差应 <0.6%（窄带 og/gl 方差稍大）
}
check('全市场 MC RTP 贴精确（最大偏差<0.6%，证明 drawRound 无偏）', mcOk, `worst=${worstK} dev=${(worst * 100).toFixed(3)}%`);

// ===== 7. 完备性 + 确定性 + seededRng 集成 =====
console.log('\n=== 完备性 + 确定性 + seededRng 集成 ===');
const ss = 'a'.repeat(64);
check('同 seed drawRound 两次一致', JSON.stringify(drawRound(makeSeededRng(ss, 'cs', 7))) === JSON.stringify(drawRound(makeSeededRng(ss, 'cs', 7))));
const sp = spin(makeSeededRng(ss, 'cs', 7));
check('spin 返回 {drawResult:{balls[20],sum,lowCount}, hits:Set, pushes:Set(空)}',
  Array.isArray(sp.drawResult.balls) && sp.drawResult.balls.length === 20 && new Set(sp.drawResult.balls).size === 20 &&
  sp.drawResult.balls.every((n) => n >= 1 && n <= 80) &&
  sp.drawResult.sum === sp.drawResult.balls.reduce((a, b) => a + b, 0) &&
  sp.drawResult.lowCount === sp.drawResult.balls.filter((n) => n <= 40).length &&
  sp.hits instanceof Set && sp.pushes instanceof Set && sp.pushes.size === 0,
  `sum=${sp.drawResult.sum} lowCount=${sp.drawResult.lowCount}`);
check('drawRound 恒为 20 个 1-80 不重复球', [...Array(100)].every((_, i) => { const b = drawRound(makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i)); return b.length === 20 && new Set(b).size === 20 && b.every((n) => n >= 1 && n <= 80); }));
// 每球位均匀：统计所有开出球号频次（20×NMC2 抽样），1-80 应均匀
const ballFreq = new Array(81).fill(0);
const NMC2 = 300000;
for (let i = 0; i < NMC2; i++) for (const b of drawRound(makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i))) ballFreq[b]++;
const expBall = (NMC2 * 20) / 80;
let maxDev = 0; for (let n = 1; n <= 80; n++) maxDev = Math.max(maxDev, Math.abs(ballFreq[n] - expBall) / expBall);
check('1-80 每球开出频次均匀（无放回无偏，最大偏差<2%）', maxDev < 0.02, `maxDev ${(maxDev * 100).toFixed(2)}%`);

console.log(`\n${allPass ? 'ALL PASS ✅ HalfTime 引擎钉死（PMF 可复用给 WuXing）' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
