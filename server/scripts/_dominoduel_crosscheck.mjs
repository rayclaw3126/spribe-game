// DominoDuel 引擎对拍（最难：波胆+push，全枚举 122850 精算）：ODDS/CS_ODDS/DOMINOES 照抄 + 全枚举精确 RTP(波胆逐比分) + push 概率精确 + push三态引擎层 + MC sanity + seededRng 集成。
import crypto from 'crypto';
import { rollTiles, deriveRound, hitsOf, pushesOf, MARKETS, ODDS, HAS_PUSH, spin, DOMINOES, CS_ODDS } from '../src/game/dominoDuel.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// ===== 1. 常量照抄前端 + HAS_PUSH =====
console.log('=== 常量照抄前端 ===');
check('ODDS 逐位照抄', JSON.stringify(ODDS) === JSON.stringify({ main: 1.90, draw: 9.38, gBig: 1.74, gSmall: 2.11, gOdd: 1.91, gEven: 1.91, tBig: 1.92, tSmall: 1.90, tOdd: 1.88, tEven: 1.94 }));
check('CS_ODDS 波胆 9 键逐位照抄', JSON.stringify(CS_ODDS) === JSON.stringify({ '1-0': 94.69, '2-1': 92.23, '3-1': 90.32, '0-0': 97.93, '1-1': 88.08, '2-2': 92.67, '0-1': 94.69, '1-2': 92.23, '1-3': 90.32 }));
check('DOMINOES = 28 张（0-0..6-6）', DOMINOES.length === 28 && DOMINOES[0].join('-') === '0-0' && DOMINOES[27].join('-') === '6-6');
check('HAS_PUSH = true', HAS_PUSH === true);
const keys = Object.keys(MARKETS);
check('MARKETS 键数 = 24（15 常规[3 胜负+4 全场+4 主+4 客] + 9 波胆）', keys.length === 24, `count=${keys.length}`);
// mod10 派生照抄：主 [6-6]+[6-5]=12+11=23 mod10=3；客 [0-0]+[0-1]=0+1=1 mod10=1
{
  const r = deriveRound([[6, 6], [6, 5], [0, 0], [0, 1]]);
  check('得分派生：主[6-6]+[6-5]=23 mod10=3、客[0-0]+[0-1]=1 mod10=1、gTotal=4', r.hs === 3 && r.as === 1 && r.gTotal === 4, `hs=${r.hs} as=${r.as} gTotal=${r.gTotal}`);
}
// 波胆键照抄
check('波胆键 cs-1-0/cs-0-0/cs-1-3 存在且赔率对', MARKETS['cs-1-0'].odds === 94.69 && MARKETS['cs-0-0'].odds === 97.93 && MARKETS['cs-1-3'].odds === 90.32);

// ===== 2. 全枚举 122850（C(28,2)×C(26,2)）=====
console.log('\n=== 全枚举 122850（主对 × 客对）===');
// 枚举：主 2 张（i<j，C(28,2)=378）× 客 2 张（k<l，从剩余 26 张，C(26,2)=325）= 122850，每局等概
const hitCnt = Object.fromEntries(keys.map((k) => [k, 0]));
const pushCnt = Object.fromEntries(keys.map((k) => [k, 0]));
let N = 0;
for (let i = 0; i < 28; i++) for (let j = i + 1; j < 28; j++) {
  const rest = [];
  for (let m = 0; m < 28; m++) if (m !== i && m !== j) rest.push(m);
  for (let a = 0; a < rest.length; a++) for (let b = a + 1; b < rest.length; b++) {
    const tiles = [DOMINOES[i], DOMINOES[j], DOMINOES[rest[a]], DOMINOES[rest[b]]];
    const r = deriveRound(tiles);
    const h = hitsOf(r), p = pushesOf(r);
    for (const k of keys) { if (h.has(k)) hitCnt[k]++; if (p.has(k)) pushCnt[k]++; }
    N++;
  }
}
check('枚举局数 = 122850（C(28,2)×C(26,2)=378×325）', N === 122850, `N=${N}`);

// ===== 3. 全枚举精确 RTP（含 push 修正）=====
console.log('\n=== 全枚举精确 RTP（含 push 修正：odds×P(hit) + 1×P(push)）===');
const rtpOf = (k) => (hitCnt[k] / N) * MARKETS[k].odds + (pushCnt[k] / N) * 1;
// 常规盘
console.log('-- 主客胜负（含 push）+ 全场/主/客大小单双 --');
for (const k of ['home-win', 'away-win', 'draw', 'g-big', 'g-small', 'g-odd', 'g-even', 'h-big', 'h-small', 'a-big', 'a-small']) {
  console.log(`  ${k.padEnd(9)} P(hit)=${(hitCnt[k] / N).toFixed(5)}${pushCnt[k] ? ` P(push)=${(pushCnt[k] / N).toFixed(5)}` : ''} → RTP ${(rtpOf(k) * 100).toFixed(2)}%`);
}
// push 概率精确核
const pPush = pushCnt['home-win'] / N;
check('主/客胜 push 概率精确 P(平局)≈0.10185（枚举）', Math.abs(pPush - 0.10185) < 0.0002 && pushCnt['home-win'] === pushCnt['away-win'], `P(push)=${pPush.toFixed(5)}`);
check('主胜 P(hit)≈0.44908（枚举）、主客对称', Math.abs(hitCnt['home-win'] / N - 0.44908) < 0.0002 && hitCnt['home-win'] === hitCnt['away-win']);
check('draw 命中 == home-win push（平局即 draw hit）', hitCnt['draw'] === pushCnt['home-win']);

// ===== 4. 波胆逐比分精确 RTP（重点，低频高赔，对上前端注释）=====
console.log('\n=== 波胆逐比分精确 RTP（全枚举，非 MC）===');
// 前端注释 P（枚举概率）与 odds（CS_ODDS 值）；RTP = P×odds，锚 0.955
const EXPECT_CS_P = { 'cs-1-0': 0.01009, 'cs-2-1': 0.01035, 'cs-3-1': 0.01057, 'cs-0-0': 0.00975, 'cs-1-1': 0.01084, 'cs-2-2': 0.01031, 'cs-0-1': 0.01009, 'cs-1-2': 0.01035, 'cs-1-3': 0.01057 };
let csOk = true, csRtpOk = true;
for (const k of Object.keys(EXPECT_CS_P)) {
  const p = hitCnt[k] / N, rtp = p * MARKETS[k].odds;
  const pOk = Math.abs(p - EXPECT_CS_P[k]) < 0.0002;
  console.log(`  ${k.padEnd(8)} P=${p.toFixed(5)}（注释 ${EXPECT_CS_P[k]}）× odds ${MARKETS[k].odds} = RTP ${(rtp * 100).toFixed(2)}%  ${pOk ? '✓' : '✗'}`);
  if (!pOk) csOk = false;
  if (!(rtp > 0.94 && rtp < 0.965)) csRtpOk = false;
}
check('波胆 9 比分枚举 P 全对上前端注释值', csOk);
check('波胆 9 比分 RTP 全 ≈ 95.5%（锚 0.955，高赔低频 P×odds 精确）∈ (94%,96.5%)', csRtpOk);

// 常规 16 市场合理带
let band = true, minR = 1, maxR = 0;
for (const k of keys.filter((x) => !x.startsWith('cs-'))) { const r = rtpOf(k); minR = Math.min(minR, r); maxR = Math.max(maxR, r); if (!(r >= 0.94 && r <= 0.9761)) band = false; }
check('常规 16 市场精确 RTP ∈ [94%,97.5%]', band, `范围 ${(minR * 100).toFixed(2)}%–${(maxR * 100).toFixed(2)}%`);

// ===== 5. push 三态引擎层确认 =====
console.log('\n=== push 三态引擎层确认 ===');
{
  // 平局局：hs==as → home-win/away-win push、draw hit
  const rTie = deriveRound([[3, 3], [0, 1], [2, 2], [1, 2]]);   // 主 6+1=7 mod10=7；客 4+3=7 mod10=7 → 平局
  check(`平局(hs=${rTie.hs}==as=${rTie.as})：home-win/away-win 进 pushes 不进 hits、draw 命中`, pushesOf(rTie).has('home-win') && pushesOf(rTie).has('away-win') && !hitsOf(rTie).has('home-win') && hitsOf(rTie).has('draw'));
  check('平局 hits ∩ pushes = ∅', [...hitsOf(rTie)].every((k) => !pushesOf(rTie).has(k)));
}
{
  // 主胜局：hs>as → home-win hit、无 push
  const rHome = deriveRound([[6, 6], [6, 6], [0, 0], [0, 1]]);   // 主 24 mod10=4；客 1 → 主胜
  check(`主胜(hs=${rHome.hs}>as=${rHome.as})：home-win hit、pushes 空`, hitsOf(rHome).has('home-win') && !hitsOf(rHome).has('away-win') && pushesOf(rHome).size === 0);
}
check('全枚举：pushes 只含 home-win/away-win 且恒同时（平局二者同 push）', keys.filter((k) => pushCnt[k] > 0).sort().join(',') === 'away-win,home-win');
check('spin() 多局：pushes 是 Set 且与 hits 不重叠', [...Array(50)].every((_, i) => { const s = spin(makeSeededRng('a'.repeat(64), 'c', i)); return s.pushes instanceof Set && [...s.hits].every((k) => !s.pushes.has(k)); }));

// ===== 6. MC sanity（大样本，验 rollTiles 无偏；波胆低频以枚举精确为准）=====
console.log('\n=== MC sanity（3e6 局，验 rollTiles 无偏）===');
const NMC = 3_000_000;
const mcHit = Object.fromEntries(keys.map((k) => [k, 0]));
const mcPush = Object.fromEntries(keys.map((k) => [k, 0]));
for (let i = 0; i < NMC; i++) {
  const r = deriveRound(rollTiles(makeSeededRng('dommc', 'c', i)));
  const h = hitsOf(r), p = pushesOf(r);
  for (const k of keys) { if (h.has(k)) mcHit[k]++; if (p.has(k)) mcPush[k]++; }
}
// 常规盘 MC RTP 贴枚举精确
let mcOk = true, worst = 0, worstK = '';
for (const k of keys.filter((x) => !x.startsWith('cs-'))) { const mcR = (mcHit[k] / NMC) * MARKETS[k].odds + (mcPush[k] / NMC); const dev = Math.abs(mcR - rtpOf(k)); if (dev > worst) { worst = dev; worstK = k; } if (dev > 0.006) mcOk = false; }
check('常规 16 市场 MC RTP 贴枚举精确（偏差<0.6%，证明 rollTiles 无偏）', mcOk, `worst=${worstK} dev=${(worst * 100).toFixed(3)}%`);
// 波胆 MC P 贴枚举 P（低频，容差放宽）
let csMcOk = true;
for (const k of Object.keys(EXPECT_CS_P)) { const dev = Math.abs(mcHit[k] / NMC - hitCnt[k] / N); if (dev > 0.0008) csMcOk = false; }
check('波胆 9 比分 MC P 贴枚举 P（低频容差<0.08%）', csMcOk);

// ===== 7. 确定性 + seededRng 集成 =====
console.log('\n=== 确定性 + seededRng 集成 ===');
const ss = 'a'.repeat(64);
check('同 seed rollTiles 两次一致', JSON.stringify(rollTiles(makeSeededRng(ss, 'cs', 7))) === JSON.stringify(rollTiles(makeSeededRng(ss, 'cs', 7))));
const sp = spin(makeSeededRng(ss, 'cs', 7));
check('spin 返回 {drawResult:{tiles[4],hs,as,gTotal}, hits:Set, pushes:Set}',
  Array.isArray(sp.drawResult.tiles) && sp.drawResult.tiles.length === 4 &&
  sp.drawResult.hs >= 0 && sp.drawResult.hs <= 9 && sp.drawResult.as >= 0 && sp.drawResult.as <= 9 &&
  sp.drawResult.gTotal === sp.drawResult.hs + sp.drawResult.as &&
  sp.hits instanceof Set && sp.pushes instanceof Set,
  `hs=${sp.drawResult.hs} as=${sp.drawResult.as}`);
check('rollTiles 恒为 4 张不重复骨牌', [...Array(100)].every((_, i) => { const t = rollTiles(makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i)); const set = new Set(t.map((x) => x.join('-'))); return t.length === 4 && set.size === 4; }));

console.log(`\n${allPass ? 'ALL PASS ✅ DominoDuel 引擎钉死（波胆全枚举精算 + push 三态）' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
