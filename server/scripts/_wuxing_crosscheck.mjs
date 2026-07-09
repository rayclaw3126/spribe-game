// WuXing 引擎对拍（HalfTime 双胞胎，复用 kenoSumPmf.mjs）：ODDS/五行带边界/龙虎派生照抄前端 + 精确 RTP(PMF) + MC sanity + 和局判输非 push + 完备性 + seededRng 集成。
import crypto from 'crypto';
import { drawKeno, deriveRound, hitsOf, MARKETS, ODDS, HAS_PUSH, spin } from '../src/game/wuXing.js';
import { makeSeededRng } from '../src/lib/seededRng.js';
import { kenoSumCounts, probSumWhere, hyperProb } from './lib/kenoSumPmf.mjs';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// ===== 1. 常量照抄前端 + HAS_PUSH =====
console.log('=== 常量照抄前端 ===');
const EXPECT_ODDS = { main: 1.95, small: 1.92, dt: 2.13, dtTie: 9.55, ud: 2.4, udTie: 4.7, parlay: 3.82, wxGold: 9.35, wxMid: 4.72, wxWater: 2.46, wxEarth: 9.1 };
check('ODDS 逐位照抄（11 项）', JSON.stringify(ODDS) === JSON.stringify(EXPECT_ODDS));
check('HAS_PUSH = false', HAS_PUSH === false);
const keys = Object.keys(MARKETS);
check('MARKETS 键数 = 19（大小2+单双2+龙虎3+上下3+过关4+五行带5）', keys.length === 19, `count=${keys.length}`);
const dr = (sum, up = 10) => ({ sum, up, dragon: Math.floor(sum / 10) % 10, tiger: sum % 10 });
check('五行带边界：金≤695 / 木696-763 / 水764-855 / 火856-923 / 土≥924', MARKETS['wx-gold'].hit(dr(695)) && !MARKETS['wx-gold'].hit(dr(696)) && MARKETS['wx-wood'].hit(dr(696)) && MARKETS['wx-wood'].hit(dr(763)) && MARKETS['wx-water'].hit(dr(764)) && MARKETS['wx-water'].hit(dr(855)) && MARKETS['wx-fire'].hit(dr(856)) && MARKETS['wx-fire'].hit(dr(923)) && MARKETS['wx-earth'].hit(dr(924)) && !MARKETS['wx-earth'].hit(dr(923)));
check('大小边界：big≥811 / small≤810（810 归 small，非对称）', MARKETS.big.hit(dr(811)) && !MARKETS.big.hit(dr(810)) && MARKETS.small.hit(dr(810)) && !MARKETS.small.hit(dr(811)));
// 龙虎派生照抄：dragon=⌊sum/10⌋%10、tiger=sum%10
{
  const r791 = deriveRound([791].length ? [3, 62, 5, 77, 48, 29, 40, 50, 38, 72, 39, 73, 19, 8, 23, 54, 76, 11, 58, 6] : []);
  check('deriveRound 龙虎派生：sum=791 → dragon=⌊791/10⌋%10=9、tiger=791%10=1', r791.sum === 791 && r791.dragon === 9 && r791.tiger === 1, `sum=${r791.sum} dragon=${r791.dragon} tiger=${r791.tiger}`);
  check('deriveRound：龙>虎(9>1) → dragon 命中、tiger/dt-tie 不中', MARKETS.dragon.hit(r791) && !MARKETS.tiger.hit(r791) && !MARKETS['dt-tie'].hit(r791));
}

// ===== 2. 和值精确 PMF（复用 kenoSumPmf.mjs）=====
console.log('\n=== 和值精确 PMF（复用 lib，1..80 取 20）===');
const pmf = kenoSumCounts(80, 20);
check('total = C(80,20)、和值域 [210,1410]', pmf.total === 3535316142212174320n && pmf.minSum === 210 && pmf.maxSum === 1410);

// ===== 3. 精确 RTP（和值带/龙虎/大小单双用 PMF；上下用超几何）=====
console.log('\n=== 精确 RTP ===');
// 龙虎派生谓词（吃和值 s）
const dOf = (s) => Math.floor(s / 10) % 10, tOf = (s) => s % 10;
const exact = {};
const bandMarkets = [
  ['big', (s) => s >= 811], ['small', (s) => s <= 810],
  ['odd', (s) => s % 2 === 1], ['even', (s) => s % 2 === 0],
  ['dragon', (s) => dOf(s) > tOf(s)], ['tiger', (s) => tOf(s) > dOf(s)], ['dt-tie', (s) => dOf(s) === tOf(s)],
  ['big-odd', (s) => s >= 811 && s % 2 === 1], ['small-odd', (s) => s <= 810 && s % 2 === 1], ['big-even', (s) => s >= 811 && s % 2 === 0], ['small-even', (s) => s <= 810 && s % 2 === 0],
  ['wx-gold', (s) => s <= 695], ['wx-wood', (s) => s >= 696 && s <= 763], ['wx-water', (s) => s >= 764 && s <= 855], ['wx-fire', (s) => s >= 856 && s <= 923], ['wx-earth', (s) => s >= 924],
];
console.log('-- 和值型市场（PMF）--');
for (const [key, pred] of bandMarkets) {
  const p = probSumWhere(pmf, pred);
  exact[key] = p * MARKETS[key].odds;
  console.log(`  ${key.padEnd(11)} P=${p.toFixed(5)} × ${MARKETS[key].odds} = RTP ${(exact[key] * 100).toFixed(2)}%`);
}
// 上/下/上下和：超几何（X = ≤40 球数，Hypergeom(80,40,20)）
console.log('-- 上下型市场（超几何）--');
let pUpTie = hyperProb(80, 40, 20, 10);
let pUp = 0; for (let k = 11; k <= 20; k++) pUp += hyperProb(80, 40, 20, k);
let pDown = 0; for (let k = 0; k <= 9; k++) pDown += hyperProb(80, 40, 20, k);
exact.up = pUp * ODDS.ud; exact.down = pDown * ODDS.ud; exact['ud-tie'] = pUpTie * ODDS.udTie;
console.log(`  up   P=${pUp.toFixed(5)} × 2.4 = ${(exact.up * 100).toFixed(2)}%   down P=${pDown.toFixed(5)} × 2.4 = ${(exact.down * 100).toFixed(2)}%   ud-tie P=${pUpTie.toFixed(5)} × 4.7 = ${(exact['ud-tie'] * 100).toFixed(2)}%`);

// 逐市场合理带
let band = true, minR = 1, maxR = 0;
for (const k of keys) { const r = exact[k]; minR = Math.min(minR, r); maxR = Math.max(maxR, r); if (!(r >= 0.94 && r <= 0.9751)) band = false; }
check('全 19 市场精确 RTP ∈ [94%, 97.5%]', band, `范围 ${(minR * 100).toFixed(2)}%–${(maxR * 100).toFixed(2)}%`);
// 关键概率对上前端注释
check('龙虎：P(龙>虎)≈0.4499、P(龙虎和)≈0.1001（三向和为 1）', Math.abs(probSumWhere(pmf, (s) => dOf(s) > tOf(s)) - 0.4499) < 0.002 && Math.abs(probSumWhere(pmf, (s) => dOf(s) === tOf(s)) - 0.1001) < 0.002 && Math.abs(probSumWhere(pmf, (s) => dOf(s) > tOf(s)) + probSumWhere(pmf, (s) => tOf(s) > dOf(s)) + probSumWhere(pmf, (s) => dOf(s) === tOf(s)) - 1) < 1e-9);
check('上下：P(上)=P(下)≈0.3985、P(上下和)≈0.2033（三向和为 1）', Math.abs(pUp - 0.3985) < 0.001 && Math.abs(pUp - pDown) < 1e-9 && Math.abs(pUpTie - 0.2033) < 0.001 && Math.abs(pUp + pDown + pUpTie - 1) < 1e-9);
check('big+small 互补=1、五行带 5 段和=1', Math.abs(probSumWhere(pmf, (s) => s >= 811) + probSumWhere(pmf, (s) => s <= 810) - 1) < 1e-9 && Math.abs(probSumWhere(pmf, (s) => s <= 695) + probSumWhere(pmf, (s) => s >= 696 && s <= 763) + probSumWhere(pmf, (s) => s >= 764 && s <= 855) + probSumWhere(pmf, (s) => s >= 856 && s <= 923) + probSumWhere(pmf, (s) => s >= 924) - 1) < 1e-9);

// ===== 4. 和局判输非 push =====
console.log('\n=== 和局判输非 push ===');
// 龙虎和局(dragon==tiger)：dragon/tiger 两向盘皆 lose（不退），dt-tie 命中
{
  const rTie = dr(770);   // sum=770 → d=7,t=0? ⌊770/10⌋%10=7, 770%10=0 → 龙>虎，非和。找个 dragon==tiger 的
  // 找和局和值：dragon==tiger，如 sum=800→d=0,t=0 和；sum=616→d=1,t=6 否；sum=770→d=7,t=0否
  const tieSum = 800; const rt = dr(tieSum);   // 800: ⌊800/10⌋%10=0, 800%10=0 → 龙虎和
  check(`龙虎和局(sum=${tieSum},d=${rt.dragon}=t=${rt.tiger})：dragon/tiger 两向皆 lose（判输不退）、dt-tie 命中`, !MARKETS.dragon.hit(rt) && !MARKETS.tiger.hit(rt) && MARKETS['dt-tie'].hit(rt));
}
// 上下和局(up==10)：up/down 两向皆 lose，ud-tie 命中
{
  const rt = dr(700, 10);
  check('上下和局(up=10)：up/down 两向皆 lose（判输不退）、ud-tie 命中', !MARKETS.up.hit(rt) && !MARKETS.down.hit(rt) && MARKETS['ud-tie'].hit(rt));
}
check('spin().pushes 恒空集（和局判 hit/lose 两态，不退注）', [...Array(30)].every((_, i) => spin(makeSeededRng('a'.repeat(64), 'c', i)).pushes.size === 0));

// ===== 5. MC sanity（5e6 局，证明 drawKeno 对）=====
console.log('\n=== MC sanity（5e6 局，各市场 MC RTP 贴精确）===');
const NMC = 5_000_000;
const mcHit = Object.fromEntries(keys.map((k) => [k, 0]));
let sumAcc = 0;
for (let i = 0; i < NMC; i++) {
  const r = deriveRound(drawKeno(makeSeededRng('wxmc', 'c', i)));
  sumAcc += r.sum;
  for (const k of keys) if (MARKETS[k].hit(r)) mcHit[k]++;
}
check('MC 和值均值 ≈ 810', Math.abs(sumAcc / NMC - 810) < 1.5, `mean=${(sumAcc / NMC).toFixed(2)}`);
let mcOk = true, worst = 0, worstK = '';
for (const k of keys) { const mcR = (mcHit[k] / NMC) * MARKETS[k].odds; const dev = Math.abs(mcR - exact[k]); if (dev > worst) { worst = dev; worstK = k; } if (dev > 0.006) mcOk = false; }
check('全市场 MC RTP 贴精确（最大偏差<0.6%，证明 drawKeno 无偏）', mcOk, `worst=${worstK} dev=${(worst * 100).toFixed(3)}%`);

// ===== 6. 完备性 + 确定性 + seededRng 集成 =====
console.log('\n=== 完备性 + 确定性 + seededRng 集成 ===');
const ss = 'a'.repeat(64);
check('同 seed drawKeno 两次一致', JSON.stringify(drawKeno(makeSeededRng(ss, 'cs', 7))) === JSON.stringify(drawKeno(makeSeededRng(ss, 'cs', 7))));
const sp = spin(makeSeededRng(ss, 'cs', 7));
check('spin 返回 {drawResult:{balls[20],sum,dragon,tiger}, hits:Set, pushes:Set(空)}',
  Array.isArray(sp.drawResult.balls) && sp.drawResult.balls.length === 20 && new Set(sp.drawResult.balls).size === 20 &&
  sp.drawResult.balls.every((n) => n >= 1 && n <= 80) &&
  sp.drawResult.sum === sp.drawResult.balls.reduce((a, b) => a + b, 0) &&
  sp.drawResult.dragon === Math.floor(sp.drawResult.sum / 10) % 10 && sp.drawResult.tiger === sp.drawResult.sum % 10 &&
  sp.hits instanceof Set && sp.pushes instanceof Set && sp.pushes.size === 0,
  `sum=${sp.drawResult.sum} dragon=${sp.drawResult.dragon} tiger=${sp.drawResult.tiger}`);
check('drawKeno 恒为 20 个 1-80 不重复球', [...Array(100)].every((_, i) => { const b = drawKeno(makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i)); return b.length === 20 && new Set(b).size === 20 && b.every((n) => n >= 1 && n <= 80); }));
const ballFreq = new Array(81).fill(0);
const NMC2 = 300000;
for (let i = 0; i < NMC2; i++) for (const b of drawKeno(makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i))) ballFreq[b]++;
const expBall = (NMC2 * 20) / 80;
let maxDev = 0; for (let n = 1; n <= 80; n++) maxDev = Math.max(maxDev, Math.abs(ballFreq[n] - expBall) / expBall);
check('1-80 每球开出频次均匀（部分 FY 无偏，最大偏差<2%）', maxDev < 0.02, `maxDev ${(maxDev * 100).toFixed(2)}%`);

console.log(`\n${allPass ? 'ALL PASS ✅ WuXing 引擎钉死（PMF lib 复用成功）' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
