// Momentum 引擎对拍：factorOf 照抄前端 + ⭐E[F]=0.97 代数 + ⭐超鞅多策略 RTP≤0.97 + crash 分布 + 逐柱复算一致 + seededRng 集成。
import crypto from 'crypto';
import { factorOf, stepFactor, walkPath, CRASH_FLOOR, BARS, hashSeed } from '../src/game/momentum.js';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// ===== 1. factorOf 照抄前端 + 常量 =====
console.log('=== factorOf 照抄前端 + 常量 ===');
// 逐位照抄前端公式：u<0.5 ? 0.58+0.84u : 1+0.6(u-0.5)
const feFactorOf = (u) => (u < 0.5 ? 0.58 + 0.84 * u : 1 + 0.6 * (u - 0.5));
let fMatch = true;
for (let i = 0; i <= 1000; i++) { const u = i / 1000; if (Math.abs(factorOf(u) - feFactorOf(u)) > 1e-12) fMatch = false; }
check('factorOf 逐位照抄前端（1000 点全等）', fMatch);
check('CRASH_FLOOR = 0.05、BARS = 31', CRASH_FLOOR === 0.05 && BARS === 31);
check('factorOf 值域：u=0→0.58 / u→0.5⁻→1.00 / u=0.5→1.00 / u=1→1.30', Math.abs(factorOf(0) - 0.58) < 1e-12 && Math.abs(factorOf(0.4999999) - 1) < 1e-6 && factorOf(0.5) === 1 && Math.abs(factorOf(1) - 1.3) < 1e-12);

// ===== 2. ⭐ E[F]=0.97 代数（主力）=====
console.log('\n=== ⭐ E[F]=0.97 代数 ===');
// 跌段 ∫₀^0.5(0.58+0.84u)du = 0.58×0.5 + 0.84×0.5²/2 = 0.395（段均值 0.79）
const seg1 = 0.58 * 0.5 + 0.84 * (0.5 * 0.5) / 2;
// 涨段 ∫_0.5^1(1+0.6(u-0.5))du = 0.5 + 0.6×0.5²/2 = 0.575（段均值 1.15）
const seg2 = 0.5 + 0.6 * (0.5 * 0.5) / 2;
const EF = seg1 + seg2;
console.log(`  跌段积分=${seg1}（均值 ${(seg1 / 0.5).toFixed(2)}）+ 涨段积分=${seg2}（均值 ${(seg2 / 0.5).toFixed(2)}）= E[F]=${EF}`);
check('E[F] = 0.395 + 0.575 = 0.97（精确）', Math.abs(EF - 0.97) < 1e-12 && Math.abs(seg1 / 0.5 - 0.79) < 1e-12 && Math.abs(seg2 / 0.5 - 1.15) < 1e-12);
// 数值细网格积分佐证
let grid = 0; const N = 2_000_000; for (let i = 0; i < N; i++) grid += factorOf((i + 0.5) / N);
check('细网格数值积分 ∫factorOf ≈ 0.97', Math.abs(grid / N - 0.97) < 1e-4, `${(grid / N).toFixed(6)}`);

// ===== 3. HMAC 引擎：u 均匀 + 逐柱复算一致 + 确定性 =====
console.log('\n=== HMAC 引擎（u 均匀 + 逐柱复算 + 确定性）===');
const ss = 'a'.repeat(64);
// 同 (serverSeed,clientSeed,nonce) 两次 walkPath 全等
check('同 seed walkPath 两次全等（确定性）', JSON.stringify(walkPath(ss, 'cs', 7)) === JSON.stringify(walkPath(ss, 'cs', 7)));
// stepFactor 用的 u 均匀（反解 u：F<1 跌段 u=(F-0.58)/0.84；F≥1 涨段 u=0.5+(F-1)/0.6）——统计落 [0,1) 均匀
const uOf = (f) => (f < 1 ? (f - 0.58) / 0.84 : 0.5 + (f - 1) / 0.6);
const bins = new Array(10).fill(0); const NU = 600000;
for (let i = 0; i < NU; i++) { const f = stepFactor(crypto.randomBytes(8).toString('hex'), 'c', i, i % 31); bins[Math.min(9, Math.floor(uOf(f) * 10))]++; }
const expBin = NU / 10;
let maxDev = 0; for (let b = 0; b < 10; b++) maxDev = Math.max(maxDev, Math.abs(bins[b] - expBin) / expBin);
check('stepFactor 派生 u 均匀（10 桶最大偏差<2%，52-bit floor 免拒绝采样）', maxDev < 0.02, `maxDev ${(maxDev * 100).toFixed(2)}%`);
// walkPath 逐柱 == 独立 stepFactor 复算（同 absorption）
{
  const wp = walkPath(ss, 'cs', 9);
  let x = 1, ok = true;
  for (let bi = 0; bi < wp.bars.length; bi++) {
    const f = stepFactor(ss, 'cs', 9, bi);
    x = Math.round(x * f * 100) / 100; if (x <= CRASH_FLOOR) x = 0;
    if (Math.abs(wp.bars[bi].f - f) > 1e-12 || wp.bars[bi].x !== x) ok = false;
  }
  check('walkPath 逐柱 == 独立 stepFactor 复算（整条路径一致）', ok);
  check('walkPath 结构：bars ≤ 31、crashBar(null|数)、finalX（bust=0）', wp.bars.length <= 31 && (wp.crashBar === null || Number.isInteger(wp.crashBar)) && (wp.crashBar === null ? wp.finalX > 0 : wp.finalX === 0));
}
check('commitHash = sha256(serverSeed) 64 hex', hashSeed(ss).length === 64);

// ===== 4. ⭐ 超鞅红线 RTP：多兑现策略经验 RTP 全 ≤ 0.97 =====
console.log('\n=== ⭐ 超鞅红线：多策略 RTP ≤ 0.97（crash 游戏正确验法）===');
// 快速走一条路径（factorOf(Math.random())，与 walkPath 同 absorption，用于大样本策略 RTP）
const fastWalk = () => {
  const bars = []; let x = 1;
  for (let bi = 0; bi < BARS; bi++) {
    const f = factorOf(Math.random());
    x = Math.round(x * f * 100) / 100;
    if (x <= CRASH_FLOOR) { x = 0; bars.push(x); break; }
    bars.push(x);
  }
  return bars;   // bars[i] = 第 i+1 柱的 X（末元素可能=0 表 bust）
};
const NMC = 3_000_000;
// 策略：cash@bar-k（活到第 k 柱按其 X 兑，否则 0）、cash@target-T（首次 X≥T 付 T，否则末柱 X）、hold（末柱 X）
const cashBarK = (bars, k) => (bars.length >= k && bars[k - 1] > 0 ? bars[k - 1] : 0);
const cashTargetT = (bars, T) => { for (const x of bars) { if (x === 0) return 0; if (x >= T) return T; } return bars[bars.length - 1]; };
const hold = (bars) => bars[bars.length - 1];
const acc = { b1: 0, b5: 0, b10: 0, t2: 0, t5: 0, hold: 0 };
let bustByBar = new Array(BARS + 1).fill(0); let finalXAcc = 0, maxXSeen = 0;
for (let i = 0; i < NMC; i++) {
  const bars = fastWalk();
  acc.b1 += cashBarK(bars, 1); acc.b5 += cashBarK(bars, 5); acc.b10 += cashBarK(bars, 10);
  acc.t2 += cashTargetT(bars, 2); acc.t5 += cashTargetT(bars, 5); acc.hold += hold(bars);
  const fx = bars[bars.length - 1]; finalXAcc += fx; maxXSeen = Math.max(maxXSeen, ...bars);
  if (fx === 0) { const crashK = bars.length; for (let k = crashK; k <= BARS; k++) bustByBar[k]++; }
}
const rtp = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v / NMC]));
console.log('  策略 RTP：', Object.entries(rtp).map(([k, v]) => `${k}=${(v * 100).toFixed(2)}%`).join('  '));
check('⭐ cash@bar-1 RTP ≈ 0.97（X₁ 必不 bust，E[X₁]=E[F]=0.97 最紧）', Math.abs(rtp.b1 - 0.97) < 0.003, `${(rtp.b1 * 100).toFixed(3)}%`);
check('⭐ 全策略 RTP ≤ 0.97（超鞅红线：任意兑现策略 E[X_τ]≤0.97）', Object.values(rtp).every((r) => r <= 0.9705), `max=${(Math.max(...Object.values(rtp)) * 100).toFixed(3)}%`);
check('cash@bar-5 ≤ cash@bar-1、cash@bar-10 ≤ cash@bar-5（越晚兑越低，复利递减）', rtp.b5 <= rtp.b1 && rtp.b10 <= rtp.b5, `b1=${rtp.b1.toFixed(4)} b5=${rtp.b5.toFixed(4)} b10=${rtp.b10.toFixed(4)}`);

// ===== 5. crash 分布 =====
console.log('\n=== crash 分布 ===');
console.log(`  P(bust by bar k)：k=5 ${(bustByBar[5] / NMC * 100).toFixed(2)}% / k=10 ${(bustByBar[10] / NMC * 100).toFixed(2)}% / k=20 ${(bustByBar[20] / NMC * 100).toFixed(2)}% / k=31 ${(bustByBar[31] / NMC * 100).toFixed(2)}%`);
console.log(`  E[finalX]=${(finalXAcc / NMC).toFixed(4)}  观测 maxX=${maxXSeen.toFixed(2)}`);
check('P(bust) 单调递增（k 越大累计 bust 越多）', bustByBar[5] <= bustByBar[10] && bustByBar[10] <= bustByBar[20] && bustByBar[20] <= bustByBar[31]);
check('E[finalX] ≤ 0.97（hold 到底≤单柱期望，复利+bust 拖累）', finalXAcc / NMC <= 0.97);
// bust 是少数（~21%）；多数局 survive 到 31 柱但 finalX<1（0.97/步复利下漂 → hold RTP 仅 ~38%，非"多数崩"）
check('bust 少数（P(bust by 31) ∈ [15%,30%]）+ hold RTP≈E[finalX]（多数 survive 但 finalX<1，下漂非崩）', bustByBar[31] / NMC > 0.15 && bustByBar[31] / NMC < 0.30 && Math.abs(rtp.hold - finalXAcc / NMC) < 1e-9, `P(bust by 31)=${(bustByBar[31] / NMC * 100).toFixed(2)}% E[finalX]=${(finalXAcc / NMC).toFixed(3)}`);

console.log(`\n${allPass ? 'ALL PASS ✅ Momentum 引擎钉死（E[F]=0.97 + 超鞅 RTP≤0.97）' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
