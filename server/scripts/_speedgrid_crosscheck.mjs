// SpeedGrid 引擎对拍：MARKETS/ODDS/RED 照抄前端 + 精确 RTP（枚举 24）逐市场 + 完备性 + 确定性 + seededRng 集成。
import { readFileSync } from 'fs';
import crypto from 'crypto';
import { drawCar, hitsOf, MARKETS, ODDS, RED } from '../src/game/speedGrid.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// ===== 1. RED / ODDS 照抄前端 =====
console.log('=== 常量照抄前端 ===');
check('RED = {1,3,6,8,9,11,14,16,17,19,22,24}', JSON.stringify([...RED].sort((a, b) => a - b)) === JSON.stringify([1, 3, 6, 8, 9, 11, 14, 16, 17, 19, 22, 24]));
check('ODDS = {main:1.95, section:2.9, pick:22.85, team:3.85}', JSON.stringify(ODDS) === JSON.stringify({ main: 1.95, section: 2.9, pick: 22.85, team: 3.85 }));
// MARKETS 键集与前端一致（从前端源码抽 RED/ODDS 字面 + 重建市场键比对键名）
const fe = readFileSync('/home/userray/spribe-game/src/games/SpeedGrid.jsx', 'utf8');
const feRed = eval(fe.match(/export const RED = (new Set\(\[[^\]]*\]\))/)[1]);
check('RED 与前端源码逐位一致', JSON.stringify([...feRed].sort((a, b) => a - b)) === JSON.stringify([...RED].sort((a, b) => a - b)));
const expKeys = ['big', 'small', 'odd', 'even', 'red', 'black', 'grid-front', 'grid-mid', 'grid-rear', 'team-1', 'team-2', 'team-3', 'team-4', ...Array.from({ length: 24 }, (_, i) => `car-${i + 1}`)];
check('MARKETS 键集完整（13 盘口 + 24 直选 = 37）', JSON.stringify(Object.keys(MARKETS).sort()) === JSON.stringify(expKeys.sort()) && Object.keys(MARKETS).length === 37);

// ===== 2. 精确 RTP（枚举 24 冠军车号）逐市场 =====
console.log('\n=== 精确 RTP（枚举 24）逐市场 ===');
const rtpOf = (key) => {
  let hits = 0;
  for (let n = 1; n <= 24; n++) if (MARKETS[key].hit(n)) hits++;
  return { p: hits / 24, rtp: (hits / 24) * MARKETS[key].odds, hits };
};
const expect = { big: 0.975, small: 0.975, odd: 0.975, even: 0.975, red: 0.975, black: 0.975, 'grid-front': 0.9667, 'grid-mid': 0.9667, 'grid-rear': 0.9667, 'team-1': 0.9625, 'car-1': 0.9521 };
for (const [key, exp] of Object.entries(expect)) {
  const { p, rtp, hits } = rtpOf(key);
  const ok = Math.abs(rtp - exp) < 0.005;
  console.log(`  ${key.padEnd(11)} p=${p.toFixed(4)}(${hits}/24) × ${MARKETS[key].odds} = RTP ${(rtp * 100).toFixed(2)}%  (期望 ${(exp * 100).toFixed(2)}%)  ${ok ? '✓' : '✗'}`);
  check(`${key} RTP ≈ ${(exp * 100).toFixed(2)}%`, ok);
}
// 全市场 RTP 都在 94–97.5%
let allInBand = true;
for (const key of Object.keys(MARKETS)) { const { rtp } = rtpOf(key); if (!(rtp > 0.94 && rtp < 0.976)) allInBand = false; }
check('全 37 市场 RTP ∈ (94%, 97.6%)', allInBand);

// ===== 3. 完备性：各组划分覆盖 1–24 无重叠无空隙 =====
console.log('\n=== 完备性（各组命中概率和=1）===');
const groupSum = (keys) => { let s = 0; for (let n = 1; n <= 24; n++) if (keys.some((k) => MARKETS[k].hit(n))) s++; return s; };
const disjoint = (keys) => { for (let n = 1; n <= 24; n++) { let c = 0; for (const k of keys) if (MARKETS[k].hit(n)) c++; if (c !== 1) return false; } return true; };
check('大小 互补覆盖 24', disjoint(['big', 'small']));
check('单双 互补覆盖 24', disjoint(['odd', 'even']));
check('红黑 互补覆盖 24', disjoint(['red', 'black']) && groupSum(['red']) === 12);
check('三段 覆盖 24 各 8', disjoint(['grid-front', 'grid-mid', 'grid-rear']) && groupSum(['grid-front']) === 8);
check('4 车队 覆盖 24 各 6', disjoint(['team-1', 'team-2', 'team-3', 'team-4']) && groupSum(['team-1']) === 6);
check('24 直选 覆盖全部各 1', disjoint(Array.from({ length: 24 }, (_, i) => `car-${i + 1}`)));

// ===== 4. 确定性 + seededRng 集成 =====
console.log('\n=== 确定性 + seededRng 集成 ===');
const ss = 'a'.repeat(64);
const n1 = drawCar(makeSeededRng(ss, 'cs', 7));
const n2 = drawCar(makeSeededRng(ss, 'cs', 7));
check('同 seed drawCar 两次一致', n1 === n2 && n1 >= 1 && n1 <= 24, `n=${n1}`);
// 大量抽样：冠军车号 1–24 均匀
const freq = new Array(25).fill(0);
for (let i = 0; i < 480000; i++) freq[drawCar(makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i))]++;
const exp = 480000 / 24;
const maxDev = Math.max(...freq.slice(1).map((c) => Math.abs(c - exp) / exp));
check('drawCar 1–24 均匀（最大偏差<2%）', maxDev < 0.02, `maxDev ${(maxDev * 100).toFixed(2)}%`);
// hitsOf 抽查
check('hitsOf(8)：small/even/red/grid-front/team-2/car-8', JSON.stringify([...hitsOf(8)].sort()) === JSON.stringify(['car-8', 'even', 'grid-front', 'red', 'small', 'team-2'].sort()), `[${[...hitsOf(8)].sort()}]`);

console.log(`\n${allPass ? 'ALL PASS ✅ SpeedGrid 引擎钉死' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
