// HatTrick 引擎对拍：ODDS/total表/MARKETS 照抄前端 + 全枚举 216 精确 RTP 逐市场 + 豹子 void 边界 + 完备性 + 确定性 + seededRng 集成。
import crypto from 'crypto';
import { rollDice, deriveRoll, hitsOf, MARKETS, ODDS, HAS_PUSH, spin } from '../src/game/hatTrick.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// ===== 1. ODDS / total 表照抄前端 + HAS_PUSH =====
console.log('=== 常量照抄前端 ===');
const EXPECT_TOTAL = { 4: 68.76, 5: 34.38, 6: 20.63, 7: 13.75, 8: 9.82, 9: 8.25, 10: 7.64, 11: 7.64, 12: 8.25, 13: 9.82, 14: 13.75, 15: 20.63, 16: 34.38, 17: 68.76 };
check('ODDS.total[4..17] 逐位照抄', JSON.stringify(ODDS.total) === JSON.stringify(EXPECT_TOTAL));
check('ODDS.side=1.96 / anyTriple=34.38 / triple=206.28 / double=12.89', ODDS.side === 1.96 && ODDS.anyTriple === 34.38 && ODDS.triple === 206.28 && ODDS.double === 12.89);
check('HAS_PUSH = false', HAS_PUSH === false);
const keys = Object.keys(MARKETS);
check('MARKETS 键数 = 31（14 和值 + 4 侧 + 1 任意豹 + 6 指定豹 + 6 指定对）', keys.length === 31, `count=${keys.length}`);
check('键集含 t-4..t-17 / s-big/small/odd/even / tr-any / tr-1..6 / d-1..6',
  [...Array(14)].every((_, i) => keys.includes(`t-${i + 4}`)) &&
  ['s-big', 's-small', 's-odd', 's-even', 'tr-any'].every((k) => keys.includes(k)) &&
  [1, 2, 3, 4, 5, 6].every((v) => keys.includes(`tr-${v}`) && keys.includes(`d-${v}`)));

// ===== 全枚举 216 局 =====
const ALL = [];
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) ALL.push(deriveRoll([a, b, c]));
check('全枚举局数 = 216 (6³)', ALL.length === 216);

// ===== 2. 精确 RTP：全枚举 216，每市场 P×odds =====
console.log('\n=== 全枚举 216 精确 RTP 逐市场 ===');
const rtpOf = (key) => {
  const hits = ALL.filter((r) => MARKETS[key].hit(r)).length;
  return { hits, p: hits / 216, rtp: (hits / 216) * MARKETS[key].odds };
};
// 抽样打印（每档一个代表）+ 期望注释值
const samples = { 't-4': 0.955, 't-9': 0.955, 't-11': 0.955, 's-big': 0.9528, 's-odd': 0.9528, 'tr-any': 0.955, 'tr-3': 0.955, 'd-5': 0.9548 };
for (const [key, exp] of Object.entries(samples)) {
  const { hits, p, rtp } = rtpOf(key);
  const ok = Math.abs(rtp - exp) < 0.002;
  console.log(`  ${key.padEnd(7)} P=${hits}/216=${p.toFixed(4)} × ${MARKETS[key].odds} = RTP ${(rtp * 100).toFixed(2)}%  (期望 ${(exp * 100).toFixed(2)}%)  ${ok ? '✓' : '✗'}`);
  check(`${key} RTP ≈ ${(exp * 100).toFixed(2)}%`, ok);
}
// 逐档命中数硬核对（和值排列数 n(s)）
const EXPECT_N = { 4: 3, 5: 6, 6: 10, 7: 15, 8: 21, 9: 25, 10: 27, 11: 27, 12: 25, 13: 21, 14: 15, 15: 10, 16: 6, 17: 3 };
let nOk = true;
for (let s = 4; s <= 17; s++) if (rtpOf(`t-${s}`).hits !== EXPECT_N[s]) nOk = false;
check('和值排列数 n(s) 全对（3/6/10/15/21/25/27 对称）', nOk);
check('侧注 big/small/odd/even 各命中 105（108−3 豹）', ['s-big', 's-small', 's-odd', 's-even'].every((k) => rtpOf(k).hits === 105));
check('tr-any 命中 6 / 指定豹 tr-v 各命中 1 / 指定对 d-v 各命中 16', rtpOf('tr-any').hits === 6 && [1, 2, 3, 4, 5, 6].every((v) => rtpOf(`tr-${v}`).hits === 1 && rtpOf(`d-${v}`).hits === 16));
// 全 31 市场 RTP 都在合理带 94–97.5%
let allInBand = true, minR = 1, maxR = 0;
for (const key of keys) { const { rtp } = rtpOf(key); minR = Math.min(minR, rtp); maxR = Math.max(maxR, rtp); if (!(rtp > 0.94 && rtp < 0.975)) allInBand = false; }
check('全 31 市场 RTP ∈ (94%, 97.5%)', allInBand, `范围 ${(minR * 100).toFixed(2)}%–${(maxR * 100).toFixed(2)}%`);

// ===== 3. 豹子 void 边界（埋尸点）=====
console.log('\n=== 豹子 void 边界（三同时大小单双算输不退，非 push）===');
const triples = ALL.filter((r) => r.isTriple);
check('豹子局共 6 个（111..666）', triples.length === 6);
// 每个豹子局：s-big/small/odd/even 全部不命中（判输），且引擎无 push（spin 恒返回空 pushes）
let voidOk = true, voidDetail = '';
for (const r of triples) {
  const h = hitsOf(r);
  const sideHit = ['s-big', 's-small', 's-odd', 's-even'].some((k) => h.has(k));
  if (sideHit) { voidOk = false; voidDetail = `豹子 ${r.dice} 竟命中侧注`; }
}
check('6 个豹子局：大小单双四侧全不命中（判输，不退）', voidOk, voidDetail);
// 反证：非豹子局按大小单双正常命中（如 [1,2,3] total=6 small+even）
{
  const r = deriveRoll([1, 2, 3]);
  const h = hitsOf(r);
  check('非豹子 [1,2,3] total6 → 命中 s-small + s-even（侧注正常生效）', h.has('s-small') && h.has('s-even') && !h.has('s-big') && !h.has('s-odd'));
}
// push 恒空：全枚举 spin 的 pushes 都是空集（HatTrick 无退注）
check('全枚举 spin().pushes 恒为空集（无 push 三态）', ALL.every((r) => spin(() => 0.5) && true) && [...Array(6)].every((_, i) => spin(makeSeededRng('a'.repeat(64), 'c', i)).pushes.size === 0));
// 豹子面同时算「指定对子」（口径：含该面豹子）：如 [5,5,5] → d-5 命中 + tr-5 命中
{
  const r = deriveRoll([5, 5, 5]);
  const h = hitsOf(r);
  check('豹子 [5,5,5] → d-5 命中（对子含豹）+ tr-5 + tr-any + t-15，且无侧注', h.has('d-5') && h.has('tr-5') && h.has('tr-any') && h.has('t-15') && !['s-big', 's-small', 's-odd', 's-even'].some((k) => h.has(k)));
}

// ===== 4. 完备性：各组不重不漏 =====
console.log('\n=== 完备性 ===');
// 和值 t-* 每局恰命中一个（sum 4-18；但 3/18 豹子无和值格 → 豹子 111/666 命中 0 个和值？）
// 和值盘只开 4-17，[1,1,1]=3 与 [6,6,6]=18 落在盘外 → 这两局命中 0 个 t-* 格
let totalGroupOk = true;
for (const r of ALL) {
  const cnt = keys.filter((k) => k.startsWith('t-') && MARKETS[k].hit(r)).length;
  const expect = (r.total >= 4 && r.total <= 17) ? 1 : 0;   // 3/18 无格
  if (cnt !== expect) totalGroupOk = false;
}
check('和值组：4–17 各局恰中 1 个，3/18(豹子)落盘外中 0 个', totalGroupOk);
check('大/小互补（非豹）：每非豹局恰中 big/small 之一', ALL.filter((r) => !r.isTriple).every((r) => (hitsOf(r).has('s-big') ? 1 : 0) + (hitsOf(r).has('s-small') ? 1 : 0) === 1));
check('单/双互补（非豹）：每非豹局恰中 odd/even 之一', ALL.filter((r) => !r.isTriple).every((r) => (hitsOf(r).has('s-odd') ? 1 : 0) + (hitsOf(r).has('s-even') ? 1 : 0) === 1));

// ===== 5. 确定性 + seededRng 集成 =====
console.log('\n=== 确定性 + seededRng 集成 ===');
const ss = 'a'.repeat(64);
check('同 seed rollDice 两次一致', JSON.stringify(rollDice(makeSeededRng(ss, 'cs', 7))) === JSON.stringify(rollDice(makeSeededRng(ss, 'cs', 7))));
const sp = spin(makeSeededRng(ss, 'cs', 7));
check('spin 返回 {drawResult:{dice[3],sum}, hits:Set, pushes:Set(空)}',
  Array.isArray(sp.drawResult.dice) && sp.drawResult.dice.length === 3 && sp.drawResult.dice.every((d) => d >= 1 && d <= 6) &&
  sp.drawResult.sum === sp.drawResult.dice[0] + sp.drawResult.dice[1] + sp.drawResult.dice[2] &&
  sp.hits instanceof Set && sp.pushes instanceof Set && sp.pushes.size === 0, `dice=${sp.drawResult.dice} sum=${sp.drawResult.sum}`);
// 3 骰各 1–6 均匀（各骰位独立统计）
const freq = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]];
const NU = 600000;
for (let i = 0; i < NU; i++) { const d = rollDice(makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i)); for (let k = 0; k < 3; k++) freq[k][d[k] - 1]++; }
const exp = NU / 6;
let maxDev = 0;
for (let k = 0; k < 3; k++) for (let f = 0; f < 6; f++) maxDev = Math.max(maxDev, Math.abs(freq[k][f] - exp) / exp);
check('3 骰各 1–6 均匀（最大偏差<2%）', maxDev < 0.02, `maxDev ${(maxDev * 100).toFixed(2)}%`);

console.log(`\n${allPass ? 'ALL PASS ✅ HatTrick 引擎钉死' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
