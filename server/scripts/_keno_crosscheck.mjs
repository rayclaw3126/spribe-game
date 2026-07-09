// Keno 引擎对拍：精确超几何 RTP（不靠蒙卡）+ 完备性 + 确定性 + 边界。
import crypto from 'crypto';
import { drawKeno, kenoPayout, PAYOUTS, TOTAL, DRAW } from '../src/game/keno.js';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// —— BigInt 组合数，精确无浮点误差 ——
function C(n, k) {
  if (k < 0 || k > n) return 0n;
  k = Math.min(k, n - k);
  let num = 1n, den = 1n;
  for (let i = 0; i < k; i++) { num *= BigInt(n - i); den *= BigInt(i + 1); }
  return num / den;
}
// 命中 h 的精确概率：选 p 个，摇 10 个，池 36 → 超几何 P(X=h)=C(DRAW,h)*C(TOTAL-DRAW,p-h)/C(TOTAL,p)
// 用有理数（分子分母都 BigInt）算精确 RTP，最后一步才转 Number。
function exactRTP(p) {
  const denom = C(TOTAL, p);           // C(36,p)
  const table = PAYOUTS[p] || {};
  // RTP = Σ_h [ C(10,h)*C(26,p-h)/C(36,p) ] * mult(h)
  // 累加成 分子/denom：把每项 mult 乘以 100 变整数避免小数（paytable 只有 3.4 一个非整）
  let numX100 = 0n;
  for (let h = 0; h <= p; h++) {
    const ways = C(DRAW, h) * C(TOTAL - DRAW, p - h);   // 命中 h 的组合数
    const multX100 = BigInt(Math.round((table[h] || 0) * 100));
    numX100 += ways * multX100;
  }
  return Number(numX100) / Number(denom) / 100;
}

console.log('=== 各 picks 精确超几何 RTP（对照 paytable 理论）===');
const rtps = {};
for (let p = 1; p <= 10; p++) {
  const rtp = exactRTP(p);
  rtps[p] = rtp;
  console.log(`  pick ${String(p).padStart(2)}  RTP = ${(rtp * 100).toFixed(3)}%`);
}
// 断言各 picks RTP 在合理区间（paytable 注释称 85–93%），且都 <1（庄家优势）
const allInRange = Object.values(rtps).every(r => r > 0.80 && r < 1.00);
check('各 picks 精确 RTP ∈ (80%,100%)（庄家有优势、非亏本）', allInRange);

console.log('\n=== 顶赔 10000× 档的真实概率/期望贡献 ===');
for (const [p, h] of [[8, 8], [9, 9], [10, 10], [9, 8], [10, 9]]) {
  const prob = Number(C(DRAW, h) * C(TOTAL - DRAW, p - h)) / Number(C(TOTAL, p));
  const mult = PAYOUTS[p][h] || 0;
  console.log(`  pick${p} 命中${h}: P=${prob.toExponential(3)}  mult=${mult}×  期望贡献=${(prob * mult).toFixed(5)}  (1/${Math.round(1 / prob).toLocaleString()} 局)`);
}

console.log('\n=== 完备性：摇号 10 个互异、都在 1–36 ===');
let compOk = true;
for (let i = 0; i < 2000; i++) {
  const ss = crypto.randomBytes(16).toString('hex');
  const d = drawKeno(ss, 'cs', i);
  if (d.length !== DRAW) { compOk = false; break; }
  if (new Set(d).size !== DRAW) { compOk = false; break; }
  if (d.some(n => n < 1 || n > TOTAL || !Number.isInteger(n))) { compOk = false; break; }
}
check('2000 局摇号都恰好 10 个互异球、范围 1–36', compOk);

console.log('\n=== 确定性：同 (serverSeed,clientSeed,nonce) 两次全等 ===');
const ss = 'a'.repeat(64);
const d1 = drawKeno(ss, 'cs', 7), d2 = drawKeno(ss, 'cs', 7);
check('同输入两次 drawKeno 完全一致', JSON.stringify(d1) === JSON.stringify(d2), `[${d1}]`);
check('不同 nonce 结果不同', JSON.stringify(drawKeno(ss, 'cs', 7)) !== JSON.stringify(drawKeno(ss, 'cs', 8)));

console.log('\n=== 边界：pick1 / pick10 赔付命中对 ===');
// pick1 命中 1 → 3.4×
{ const drawn = [5]; const sel = [5]; const { matches, mult } = kenoPayout(sel, drawn.concat([1,2,3,4,6,7,8,9,10])); check('pick1 命中1 → 3.4×', matches === 1 && mult === 3.4, `matches=${matches} mult=${mult}`); }
// pick1 未命中 → 0
{ const { matches, mult } = kenoPayout([11], [1,2,3,4,5,6,7,8,9,10]); check('pick1 未命中 → 0×', matches === 0 && mult === 0); }
// pick10 全中 → 10000×
{ const drawn = [1,2,3,4,5,6,7,8,9,10]; const { matches, mult } = kenoPayout([1,2,3,4,5,6,7,8,9,10], drawn); check('pick10 命中10 → 10000×', matches === 10 && mult === 10000, `matches=${matches} mult=${mult}`); }
// pick10 命中4（低于表最低档5）→ 0
{ const { matches, mult } = kenoPayout([1,2,3,4,11,12,13,14,15,16], [1,2,3,4,20,21,22,23,24,25]); check('pick10 命中4（<最低档5）→ 0×', matches === 4 && mult === 0, `matches=${matches} mult=${mult}`); }

console.log('\n=== 无偏验证：低号 vs 高号选注 MC RTP 都应收敛到精确超几何（证明无模偏套利）===');
const mc = (sel, N) => {
  let paid = 0;
  for (let i = 0; i < N; i++) paid += kenoPayout(sel, drawKeno('mc' + (i % 4099), 'c', i)).mult;
  return paid / N;
};
let biasOk = true;
for (const p of [2, 5]) {
  const N = 500000;
  const low = Array.from({ length: p }, (_, i) => i + 1);              // 最低 p 个号
  const high = Array.from({ length: p }, (_, i) => TOTAL - p + 1 + i); // 最高 p 个号
  const rl = mc(low, N), rh = mc(high, N), ex = rtps[p];
  // 收敛到精确值 ±3%（相对），且低号/高号彼此差 <3%（无偏）
  const okL = Math.abs(rl - ex) / ex < 0.03, okH = Math.abs(rh - ex) / ex < 0.03;
  const okBias = Math.abs(rl - rh) / ex < 0.03;
  if (!(okL && okH && okBias)) biasOk = false;
  console.log(`  pick${p}: 低号 ${(rl*100).toFixed(2)}% · 高号 ${(rh*100).toFixed(2)}% · 精确 ${(ex*100).toFixed(2)}%  ${okL&&okH&&okBias?'✓ 收敛且无偏':'✗ 偏'}`);
}
check('低号/高号 MC RTP 都收敛精确值、彼此无偏差（模偏已消）', biasOk);

console.log(`\n${allPass ? 'ALL PASS ✅ 引擎公式钉死' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
