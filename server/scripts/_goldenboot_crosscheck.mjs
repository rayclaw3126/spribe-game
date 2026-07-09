// GoldenBoot 引擎对拍：ODDS/SUM_N/MARKETS 照抄前端 + 冠军/冠亚和(90有序对枚举)/大小单双精确 RTP + SUM_N 频次实枚举核对 + 完备性 + 确定性 + seededRng 集成。
import crypto from 'crypto';
import { drawRace, deriveRace, hitsOf, MARKETS, ODDS, HAS_PUSH, spin } from '../src/game/goldenBoot.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// ===== 1. 常量照抄前端 + HAS_PUSH =====
console.log('=== 常量照抄前端 ===');
const EXPECT_SUM_N = { 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3, 9: 4, 10: 4, 11: 5, 12: 4, 13: 4, 14: 3, 15: 3, 16: 2, 17: 2, 18: 1, 19: 1 };
const EXPECT_SUM_ODDS = Object.fromEntries(Object.keys(EXPECT_SUM_N).map((s) => [s, Math.round((0.955 * 45 / EXPECT_SUM_N[s]) * 100) / 100]));
check('ODDS.winner=9.6 / big=2.15 / small=1.72 / odd=1.72 / even=2.15', ODDS.winner === 9.6 && ODDS.big === 2.15 && ODDS.small === 1.72 && ODDS.odd === 1.72 && ODDS.even === 2.15);
check('ODDS.sum[3..19] = sumOdds(s) 逐位照抄（42.98/21.49/14.33/10.74/8.60 五档）', JSON.stringify(ODDS.sum) === JSON.stringify(EXPECT_SUM_ODDS), `sum=${JSON.stringify(ODDS.sum)}`);
check('HAS_PUSH = false', HAS_PUSH === false);
const keys = Object.keys(MARKETS);
check('MARKETS 键数 = 31（10 冠军 + 17 冠亚和 + 4 大小单双）', keys.length === 31, `count=${keys.length}`);
check('键集含 w-1..w-10 / sum-3..sum-19 / s-big/small/odd/even',
  [...Array(10)].every((_, i) => keys.includes(`w-${i + 1}`)) &&
  [...Array(17)].every((_, i) => keys.includes(`sum-${i + 3}`)) &&
  ['s-big', 's-small', 's-odd', 's-even'].every((k) => keys.includes(k)));

// ===== 2. SUM_N 频次实枚举核对（埋尸点）：90 有序 (冠,亚) 对统计各冠亚和出现次数 =====
console.log('\n=== SUM_N 频次实枚举核对（90 有序对，埋尸点）===');
const orderedPairs = [];   // 所有 (冠,亚) 有序对，冠≠亚
for (let champ = 1; champ <= 10; champ++) for (let ru = 1; ru <= 10; ru++) if (champ !== ru) orderedPairs.push([champ, ru]);
check('有序 (冠,亚) 对数 = 90 (10×9)', orderedPairs.length === 90);
// 无序对频次 n(s)：有序对每和值出现次数 / 2 = 无序对数
const orderedFreq = {};
for (const [c, r] of orderedPairs) { const s = c + r; orderedFreq[s] = (orderedFreq[s] || 0) + 1; }
let sumNOk = true, sumNDetail = [];
for (let s = 3; s <= 19; s++) {
  const enumUnordered = orderedFreq[s] / 2;   // 有序 → 无序
  if (enumUnordered !== EXPECT_SUM_N[s]) { sumNOk = false; sumNDetail.push(`s=${s} 枚举${enumUnordered}≠表${EXPECT_SUM_N[s]}`); }
}
check('实枚举 90 有序对 → 无序频次 == 照抄 SUM_N 表（3-19 全对）', sumNOk, sumNDetail.join(' '));
check('有序对频次和 = 90（Σ n(s)×2 = 90）', Object.values(orderedFreq).reduce((a, b) => a + b, 0) === 90);
check('无序对数和 = 45（Σ SUM_N = 45）', Object.values(EXPECT_SUM_N).reduce((a, b) => a + b, 0) === 45);

// ===== 3. 精确 RTP =====
console.log('\n=== 精确 RTP ===');
// 冠军直选：P=1/10（冠军在 10 车中均匀）
console.log('-- 冠军直选（P=1/10）--');
let winOk = true;
for (let n = 1; n <= 10; n++) { const rtp = (1 / 10) * MARKETS[`w-${n}`].odds; if (Math.abs(rtp - 0.96) > 0.001) winOk = false; }
check('冠军 w-1..w-10 各 P=1/10 × 9.6 = RTP 96.0%', winOk);

// 冠亚和：90 有序对等概率，逐档 P(s)=orderedFreq[s]/90，RTP=P×odds
console.log('-- 冠亚和（90 有序对等概率）--');
let sumBand = true, sminR = 1, smaxR = 0;
for (let s = 3; s <= 19; s++) {
  const p = orderedFreq[s] / 90;
  const rtp = p * MARKETS[`sum-${s}`].odds;
  sminR = Math.min(sminR, rtp); smaxR = Math.max(smaxR, rtp);
  if (!(rtp > 0.94 && rtp < 0.965)) sumBand = false;
}
check('冠亚和 sum-3..19 逐档 RTP ∈ (94%, 96.5%)', sumBand, `范围 ${(sminR * 100).toFixed(2)}%–${(smaxR * 100).toFixed(2)}%`);
// 抽样打印几档
for (const s of [3, 7, 11, 15, 19]) {
  const p = orderedFreq[s] / 90, rtp = p * MARKETS[`sum-${s}`].odds;
  console.log(`  sum-${s}  P=${orderedFreq[s]}/90=${p.toFixed(4)} × ${MARKETS[`sum-${s}`].odds} = RTP ${(rtp * 100).toFixed(2)}%`);
}

// 大小单双：按 90 有序对统计
console.log('-- 大小单双（90 有序对）--');
const sideCount = (pred) => orderedPairs.filter(([c, r]) => pred(c + r)).length;
const bigC = sideCount((s) => s >= 12), smallC = sideCount((s) => s <= 11), oddC = sideCount((s) => s % 2 === 1), evenC = sideCount((s) => s % 2 === 0);
check('big 冠亚和≥12 → 40/90 × 2.15 = RTP 95.56%', bigC === 40 && Math.abs((40 / 90) * ODDS.big - 0.9556) < 0.001, `bigC=${bigC} rtp=${((bigC / 90) * ODDS.big * 100).toFixed(2)}%`);
check('small 冠亚和≤11 → 50/90 × 1.72 = RTP 95.56%', smallC === 50 && Math.abs((50 / 90) * ODDS.small - 0.9556) < 0.001, `smallC=${smallC} rtp=${((smallC / 90) * ODDS.small * 100).toFixed(2)}%`);
check('odd 和为单 → 50/90 × 1.72 = RTP 95.56%', oddC === 50 && Math.abs((oddC / 90) * ODDS.odd - 0.9556) < 0.001, `oddC=${oddC}`);
check('even 和为双 → 40/90 × 2.15 = RTP 95.56%', evenC === 40 && Math.abs((evenC / 90) * ODDS.even - 0.9556) < 0.001, `evenC=${evenC}`);

// ===== 4. 完备性（90 有序对逐对判定，不重不漏）=====
console.log('\n=== 完备性（90 有序对）===');
let compOk = true;
for (const [c, r] of orderedPairs) {
  const res = { winner: c, runnerUp: r, sprintSum: c + r };
  const h = hitsOf(res);
  const sumHits = keys.filter((k) => k.startsWith('sum-') && h.has(k)).length;   // 恰中 1 个冠亚和
  const bs = (h.has('s-big') ? 1 : 0) + (h.has('s-small') ? 1 : 0);              // 大小互补
  const oe = (h.has('s-odd') ? 1 : 0) + (h.has('s-even') ? 1 : 0);              // 单双互补
  const win = keys.filter((k) => k.startsWith('w-') && h.has(k)).length;         // 恰中 1 个冠军
  if (sumHits !== 1 || bs !== 1 || oe !== 1 || win !== 1) compOk = false;
}
check('每对恰中 1 冠军 + 1 冠亚和，大小/单双各互补命中其一', compOk);
// 全 31 市场 RTP 合理带
let allBand = true, minR = 1, maxR = 0;
for (let n = 1; n <= 10; n++) { const rtp = 0.1 * MARKETS[`w-${n}`].odds; minR = Math.min(minR, rtp); maxR = Math.max(maxR, rtp); }
for (let s = 3; s <= 19; s++) { const rtp = (orderedFreq[s] / 90) * MARKETS[`sum-${s}`].odds; minR = Math.min(minR, rtp); maxR = Math.max(maxR, rtp); }
for (const [k, c] of [['s-big', bigC], ['s-small', smallC], ['s-odd', oddC], ['s-even', evenC]]) { const rtp = (c / 90) * MARKETS[k].odds; minR = Math.min(minR, rtp); maxR = Math.max(maxR, rtp); }
check('全 31 市场 RTP ∈ (94%, 96.5%)', minR > 0.94 && maxR < 0.965, `范围 ${(minR * 100).toFixed(2)}%–${(maxR * 100).toFixed(2)}%`);

// ===== 5. 确定性 + seededRng 集成 =====
console.log('\n=== 确定性 + seededRng 集成 ===');
const ss = 'a'.repeat(64);
check('同 seed drawRace 两次一致', JSON.stringify(drawRace(makeSeededRng(ss, 'cs', 7))) === JSON.stringify(drawRace(makeSeededRng(ss, 'cs', 7))));
const sp = spin(makeSeededRng(ss, 'cs', 7));
check('spin 返回 {drawResult:{ranking[10],champion,runnerUp,sprintSum}, hits:Set, pushes:Set(空)}',
  Array.isArray(sp.drawResult.ranking) && sp.drawResult.ranking.length === 10 &&
  new Set(sp.drawResult.ranking).size === 10 && sp.drawResult.ranking.every((n) => n >= 1 && n <= 10) &&
  sp.drawResult.champion === sp.drawResult.ranking[0] && sp.drawResult.runnerUp === sp.drawResult.ranking[1] &&
  sp.drawResult.sprintSum === sp.drawResult.champion + sp.drawResult.runnerUp &&
  sp.hits instanceof Set && sp.pushes instanceof Set && sp.pushes.size === 0,
  `ranking=${sp.drawResult.ranking} sum=${sp.drawResult.sprintSum}`);
check('drawRace 恒为 1-10 全排列（无重无漏）', [...Array(50)].every((_, i) => { const o = drawRace(makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i)); return new Set(o).size === 10 && o.every((n) => n >= 1 && n <= 10); }));
// 每个位置（名次）各车号均匀：统计冠军位车号分布
const winFreq = new Array(11).fill(0);
const NU = 600000;
for (let i = 0; i < NU; i++) winFreq[drawRace(makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i))[0]]++;
const exp = NU / 10;
let maxDev = 0;
for (let n = 1; n <= 10; n++) maxDev = Math.max(maxDev, Math.abs(winFreq[n] - exp) / exp);
check('冠军位 1-10 车号均匀（洗牌无偏，最大偏差<2%）', maxDev < 0.02, `maxDev ${(maxDev * 100).toFixed(2)}%`);

console.log(`\n${allPass ? 'ALL PASS ✅ GoldenBoot 引擎钉死' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
