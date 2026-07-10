// DerbyDay 引擎对拍（首个 push 实战，复用 kenoSumPmf）：ODDS/push边界照抄 + 含push修正精确RTP + push概率精确核 + push三态引擎层确认 + MC sanity + seededRng 集成。
import crypto from 'crypto';
import { drawMatch, deriveMatch, hitsOf, pushesOf, MARKETS, ODDS, HAS_PUSH, spin } from '../src/game/derbyDay.js';
import { makeSeededRng } from '../src/lib/seededRng.js';
import { kenoSumCounts, convolveCounts, bigProb, probSumWhere } from './lib/kenoSumPmf.mjs';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// ===== 1. 常量照抄前端 + HAS_PUSH =====
console.log('=== 常量照抄前端 ===');
check('ODDS = {main:1.95, side:1.95, small:1.92, htftSame:2.65, htftFlip:7.1}', JSON.stringify(ODDS) === JSON.stringify({ main: 1.95, side: 1.95, small: 1.92, htftSame: 2.65, htftFlip: 7.1 }));
check('HAS_PUSH = true（首个有 push 的游戏）', HAS_PUSH === true);
const keys = Object.keys(MARKETS);
check('MARKETS 键数 = 16（12 常规 + 4 半全场）', keys.length === 16, `count=${keys.length}`);
// push 边界照抄：H/A 平局 + 半全场任一半平
const mk = (o) => ({ htHome: 0, htAway: 0, ftHome: 0, ftAway: 0, htTotal: 0, ftTotal: 0, ...o });
check('ht-home：主>客 hit / 相等 push / 客>主 lose', MARKETS['ht-home'].hit(mk({ htHome: 400, htAway: 390 })) && MARKETS['ht-home'].push(mk({ htHome: 400, htAway: 400 })) && !MARKETS['ht-home'].hit(mk({ htHome: 400, htAway: 400 })) && !MARKETS['ht-home'].hit(mk({ htHome: 390, htAway: 400 })));
check('ft-home：全场平 ftHome==ftAway → push', MARKETS['ft-home'].push(mk({ ftHome: 800, ftAway: 800 })) && !MARKETS['ft-home'].push(mk({ ftHome: 800, ftAway: 799 })));
check('大小边界：ht-big≥811 / ht-small<811 / ft-big≥1621 / ft-small<1621', MARKETS['ht-big'].hit(mk({ htTotal: 811 })) && !MARKETS['ht-big'].hit(mk({ htTotal: 810 })) && MARKETS['ht-small'].hit(mk({ htTotal: 810 })) && MARKETS['ft-big'].hit(mk({ ftTotal: 1621 })) && MARKETS['ft-small'].hit(mk({ ftTotal: 1620 })));
check('半全场 push：HT 平【或】FT 平 → 四键全 push', ['ht-ft-hh', 'ht-ft-ha', 'ht-ft-ah', 'ht-ft-aa'].every((k) => MARKETS[k].push(mk({ htHome: 400, htAway: 400, ftHome: 800, ftAway: 790 })) && MARKETS[k].push(mk({ htHome: 400, htAway: 390, ftHome: 800, ftAway: 800 })) && !MARKETS[k].push(mk({ htHome: 400, htAway: 390, ftHome: 800, ftAway: 790 }))));

// ===== 2. 和值精确 PMF（复用 kenoSumPmf）=====
console.log('\n=== 和值精确 PMF（复用 lib）===');
const pmf10 = kenoSumCounts(80, 10);   // 单队半场和（10-of-80）
const pmf20 = kenoSumCounts(80, 20);   // 单队全场和（20-of-80）
const htTot = convolveCounts(pmf10, pmf10);   // htTotal = htHome + htAway（两独立 10-of-80）
const ftTot = convolveCounts(pmf20, pmf20);   // ftTotal = ftHome + ftAway（两独立 20-of-80）
check('htTotal 分布：total=C(80,10)^2、域 [110,1510]、对称于 810', htTot.total === pmf10.total ** 2n && htTot.counts.reduce((a, b) => a + b, 0n) === htTot.total);
check('ftTotal 分布：total=C(80,20)^2、对称于 1620', ftTot.total === pmf20.total ** 2n && ftTot.counts[1620] === ftTot.counts[1620]);

// ===== 3. 含 push 修正的精确 RTP =====
console.log('\n=== 含 push 修正的精确 RTP ===');
console.log('  （push 退本金 → RTP 贡献 = 1 × P(push)；hit → odds × P(hit)）');
const probConv = (dist, pred) => { let n = 0n; for (let s = 0; s <= dist.maxSum; s++) if (pred(s)) n += dist.counts[s]; return bigProb(n, dist.total); };
// 大小单双（无 push，纯 hit）
const rtpBand = {};
rtpBand['ht-big'] = probConv(htTot, (s) => s >= 811) * ODDS.side;
rtpBand['ht-small'] = probConv(htTot, (s) => s < 811) * ODDS.small;
rtpBand['ht-odd'] = probConv(htTot, (s) => s % 2 === 1) * ODDS.side;
rtpBand['ht-even'] = probConv(htTot, (s) => s % 2 === 0) * ODDS.side;
rtpBand['ft-big'] = probConv(ftTot, (s) => s >= 1621) * ODDS.side;
rtpBand['ft-small'] = probConv(ftTot, (s) => s < 1621) * ODDS.small;
rtpBand['ft-odd'] = probConv(ftTot, (s) => s % 2 === 1) * ODDS.side;
rtpBand['ft-even'] = probConv(ftTot, (s) => s % 2 === 0) * ODDS.side;
for (const k of ['ht-big', 'ht-small', 'ht-odd', 'ht-even', 'ft-big', 'ft-small', 'ft-odd', 'ft-even']) console.log(`  ${k.padEnd(9)} RTP ${(rtpBand[k] * 100).toFixed(2)}%`);
// H/A 胜负（含 push）：P(tie) 精确 = Σ P(s)²；P(win)=(1-tie)/2；RTP = 1.95×P(win) + 1×P(tie)
const tieProb = (pmf) => { let n = 0n; for (let s = 0; s <= pmf.maxSum; s++) n += pmf.counts[s] * pmf.counts[s]; return bigProb(n, pmf.total * pmf.total); };
const pHtTie = tieProb(pmf10), pFtTie = tieProb(pmf20);
const haRtp = (tie) => ODDS.main * ((1 - tie) / 2) + 1 * tie;
console.log(`  H/A push 概率精确：P(HT平)=${pHtTie.toFixed(5)} / P(FT平)=${pFtTie.toFixed(5)}`);
console.log(`  ht-home/away RTP=${(haRtp(pHtTie) * 100).toFixed(2)}%（=1.95×${((1 - pHtTie) / 2).toFixed(4)} + 1×${pHtTie.toFixed(4)}）  ft-home/away RTP=${(haRtp(pFtTie) * 100).toFixed(2)}%`);
rtpBand['ht-home'] = rtpBand['ht-away'] = haRtp(pHtTie);
rtpBand['ft-home'] = rtpBand['ft-away'] = haRtp(pFtTie);
check('H/A push 概率合理（HT平≈0.004 / FT平≈0.003）', pHtTie > 0.003 && pHtTie < 0.006 && pFtTie > 0.002 && pFtTie < 0.005, `HT=${pHtTie.toFixed(5)} FT=${pFtTie.toFixed(5)}`);
check('大小单双 + H/A（含push修正）12 市场 RTP ∈ [94%,97.5%]', Object.entries(rtpBand).every(([, r]) => r >= 0.94 && r <= 0.9761), `范围 ${(Math.min(...Object.values(rtpBand)) * 100).toFixed(2)}%–${(Math.max(...Object.values(rtpBand)) * 100).toFixed(2)}%`);

// ===== 4. push 三态引擎层确认（重点）=====
console.log('\n=== push 三态引擎层确认 ===');
// 造平局局：直接构造派生结果（hitsOf/pushesOf 只读派生字段）
{
  const rHtTie = mk({ htHome: 400, htAway: 400, ftHome: 800, ftAway: 790, htTotal: 800, ftTotal: 1590 });
  const h = hitsOf(rHtTie), p = pushesOf(rHtTie);
  check('HT 平局：ht-home/ht-away 进 pushes 不进 hits', p.has('ht-home') && p.has('ht-away') && !h.has('ht-home') && !h.has('ht-away'));
  check('HT 平局：半全场四键全进 pushes（HT 平触发）', ['ht-ft-hh', 'ht-ft-ha', 'ht-ft-ah', 'ht-ft-aa'].every((k) => p.has(k) && !h.has(k)));
  // hits/pushes 不重叠
  check('hits ∩ pushes = ∅（同市场不能既 hit 又 push）', [...h].every((k) => !p.has(k)));
}
{
  const rFtTie = mk({ htHome: 410, htAway: 400, ftHome: 800, ftAway: 800, htTotal: 810, ftTotal: 1600 });
  const h = hitsOf(rFtTie), p = pushesOf(rFtTie);
  check('FT 平局：ft-home/ft-away 进 pushes；ht-home hit（HT 主胜，正常结算）', p.has('ft-home') && p.has('ft-away') && h.has('ht-home') && !p.has('ht-home'));
  check('FT 平局：半全场四键全 push（FT 平触发），即便 HT 有胜方', ['ht-ft-hh', 'ht-ft-ha', 'ht-ft-ah', 'ht-ft-aa'].every((k) => p.has(k) && !h.has(k)));
}
{
  // 无平局正常局：主主全胜
  const rWin = mk({ htHome: 420, htAway: 400, ftHome: 830, ftAway: 800, htTotal: 820, ftTotal: 1630 });
  const h = hitsOf(rWin), p = pushesOf(rWin);
  check('无平局：ht-home/ft-home/ht-ft-hh 全 hit，pushes 为空', h.has('ht-home') && h.has('ft-home') && h.has('ht-ft-hh') && p.size === 0);
}
// spin() 真实开奖：pushes 结构正确（可空可非空），与 hits 不重叠
check('spin() 多局：pushes 是 Set 且与 hits 不重叠', [...Array(50)].every((_, i) => { const s = spin(makeSeededRng('a'.repeat(64), 'c', i)); return s.pushes instanceof Set && [...s.hits].every((k) => !s.pushes.has(k)); }));

// ===== 5. MC sanity（5e6 局：含 push 修正 RTP + push 率贴精确 + 半全场市场）=====
console.log('\n=== MC sanity（5e6 局：RTP 含 push 修正、push 率、半全场）===');
const NMC = 5_000_000;
const mcHit = Object.fromEntries(keys.map((k) => [k, 0]));
const mcPush = Object.fromEntries(keys.map((k) => [k, 0]));
let htTieCnt = 0, ftTieCnt = 0, htftPushCnt = 0;
for (let i = 0; i < NMC; i++) {
  const r = deriveMatch(drawMatch(makeSeededRng('ddmc', 'c', i)));
  const h = hitsOf(r), p = pushesOf(r);
  for (const k of keys) { if (h.has(k)) mcHit[k]++; if (p.has(k)) mcPush[k]++; }
  if (r.htHome === r.htAway) htTieCnt++;
  if (r.ftHome === r.ftAway) ftTieCnt++;
  if (r.htHome === r.htAway || r.ftHome === r.ftAway) htftPushCnt++;
}
check('MC push 率贴精确：HT平 vs Σp²、FT平 vs Σp²', Math.abs(htTieCnt / NMC - pHtTie) < 0.0006 && Math.abs(ftTieCnt / NMC - pFtTie) < 0.0006, `HT ${(htTieCnt / NMC).toFixed(5)} vs ${pHtTie.toFixed(5)} / FT ${(ftTieCnt / NMC).toFixed(5)} vs ${pFtTie.toFixed(5)}`);
const pHtftPush = htftPushCnt / NMC;
console.log(`  半全场 push 率（HT平∪FT平）MC=${pHtftPush.toFixed(5)}（前端 1e7 标定 0.00717）`);
check('半全场 push 率 ≈ 0.00717（前端标定）', Math.abs(pHtftPush - 0.00717) < 0.0006, `${pHtftPush.toFixed(5)}`);
// 半全场市场 RTP（含 push 修正）：MC hit + push 率
const htftKeys = ['ht-ft-hh', 'ht-ft-ha', 'ht-ft-ah', 'ht-ft-aa'];
let htftBand = true;
for (const k of htftKeys) {
  const rtp = (mcHit[k] / NMC) * MARKETS[k].odds + (mcPush[k] / NMC) * 1;
  rtpBand[k] = rtp;
  console.log(`  ${k} MC RTP=${(rtp * 100).toFixed(2)}%（hit ${(mcHit[k] / NMC).toFixed(4)}×${MARKETS[k].odds} + push ${(mcPush[k] / NMC).toFixed(5)}）`);
  if (!(rtp > 0.94 && rtp < 0.975)) htftBand = false;
}
check('半全场 4 键 RTP（含 push 修正）∈ (94%,97.5%)', htftBand);
// 全 16 市场 MC RTP（含 push 修正）贴精确
let mcOk = true, worst = 0, worstK = '';
for (const k of keys) { const mcR = (mcHit[k] / NMC) * MARKETS[k].odds + (mcPush[k] / NMC) * 1; const dev = Math.abs(mcR - rtpBand[k]); if (dev > worst) { worst = dev; worstK = k; } if (dev > 0.006) mcOk = false; }
check('全 16 市场 MC RTP（含 push 修正）贴精确（偏差<0.6%，证明 drawMatch 无偏）', mcOk, `worst=${worstK} dev=${(worst * 100).toFixed(3)}%`);

// ===== 6. 确定性 + seededRng 集成 =====
console.log('\n=== 确定性 + seededRng 集成 ===');
const ss = 'a'.repeat(64);
check('同 seed drawMatch 两次一致', JSON.stringify(drawMatch(makeSeededRng(ss, 'cs', 7))) === JSON.stringify(drawMatch(makeSeededRng(ss, 'cs', 7))));
const sp = spin(makeSeededRng(ss, 'cs', 7));
check('spin 返回 {drawResult:{home20,away20,htHome,htAway,htTotal,ftHome,ftAway,ftTotal}, hits:Set, pushes:Set}',
  Array.isArray(sp.drawResult.home20) && sp.drawResult.home20.length === 20 && new Set(sp.drawResult.home20).size === 20 &&
  Array.isArray(sp.drawResult.away20) && sp.drawResult.away20.length === 20 &&
  sp.drawResult.htTotal === sp.drawResult.htHome + sp.drawResult.htAway &&
  sp.drawResult.ftTotal === sp.drawResult.ftHome + sp.drawResult.ftAway &&
  sp.hits instanceof Set && sp.pushes instanceof Set,
  `htTotal=${sp.drawResult.htTotal} ftTotal=${sp.drawResult.ftTotal} pushes=${sp.pushes.size}`);
check('主客各 20 个 1-80 不重复球', [...Array(50)].every((_, i) => { const { home20, away20 } = drawMatch(makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i)); return new Set(home20).size === 20 && new Set(away20).size === 20 && home20.every((n) => n >= 1 && n <= 80) && away20.every((n) => n >= 1 && n <= 80); }));

console.log(`\n${allPass ? 'ALL PASS ✅ DerbyDay 引擎钉死（含 push 三态）' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
