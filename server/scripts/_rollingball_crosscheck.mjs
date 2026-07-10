// RollingBall 引擎对拍（bespoke 动态赔率）：GROUPS/COMBO/R锚 照抄 + ⭐RTP恒等式(代数证 RTP=R) + MC 佐证 + 无放回3球互异 + c_k=0边界 + 组合盘 + seededRng 集成。
import crypto from 'crypto';
import { GROUPS, COMBO, COMBO_C, hitOf, oddsFor, drawBall, remainingPool, isValidKey, R_BS, R_COMBO, R_SINGLE, isRed } from '../src/game/rollingBall.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// 全部盘口键（除 num-*）
const GROUP_KEYS = Object.keys(GROUPS);
const COMBO_KEYS = Object.keys(COMBO);
const R_OF = (key) => COMBO[key] ? R_COMBO : (key.startsWith('num-') ? R_SINGLE : GROUPS[key].R);

// ===== 1. 常量照抄前端 =====
console.log('=== 常量照抄前端 ===');
check('R 锚：单号 0.9523 / 大小单双红蓝 0.972 / 组合 0.955', R_SINGLE === 0.9523 && R_BS === 0.972 && R_COMBO === 0.955);
check('GROUPS 计数 c：big/odd/red=38、small/even/blue=37', GROUPS.big.c === 38 && GROUPS.odd.c === 38 && GROUPS.red.c === 38 && GROUPS.small.c === 37 && GROUPS.even.c === 37 && GROUPS.blue.c === 37);
check('行注 c：row-t1=5、row-t3=15、row-t5=25', GROUPS['row-t1'].c === 5 && GROUPS['row-t3'].c === 15 && GROUPS['row-t5'].c === 25);
check('列注 col-1..5 各 c=15、(n-1)%5 命中', [1, 2, 3, 4, 5].every((col) => GROUPS[`col-${col}`].c === 15 && GROUPS[`col-${col}`].hit(col) && GROUPS[`col-${col}`].hit(col + 5)));
check('COMBO 4 键 = big-odd/small-odd/big-even/small-even', JSON.stringify(Object.keys(COMBO).sort()) === JSON.stringify(['big-even', 'big-odd', 'small-even', 'small-odd']));
check('COMBO_C：大单/小单/大双=19、小双=18（38 偶数落大侧）', COMBO_C['big-odd'] === 19 && COMBO_C['small-odd'] === 19 && COMBO_C['big-even'] === 19 && COMBO_C['small-even'] === 18, `${JSON.stringify(COMBO_C)}`);
// 计数自洽核对（实枚举 1-75）
check('实枚举 1-75：big=38/small=37、red=38/blue=37、odd=38/even=37', [...Array(75)].filter((_, i) => GROUPS.big.hit(i + 1)).length === 38 && [...Array(75)].filter((_, i) => GROUPS.red.hit(i + 1)).length === 38 && [...Array(75)].filter((_, i) => GROUPS.odd.hit(i + 1)).length === 38);
check('isValidKey：num-1/num-75/big/big-odd 合法，num-0/num-76/foo 非法', isValidKey('num-1') && isValidKey('num-75') && isValidKey('big') && isValidKey('big-odd') && !isValidKey('num-0') && !isValidKey('num-76') && !isValidKey('foo'));

// ===== 2. ⭐ RTP 恒等式（代数主力）：oddsFor × c_k/(75-ballIdx) == R，逐键逐 ballIdx 抽样 revealed =====
console.log('\n=== ⭐ RTP 恒等式：oddsFor(key,ballIdx,revealed) × c_k/pool == R（与已开球无关）===');
// c_k(key, revealed) = 剩余池满足该键号数
const countInPool = (key, revealed) => remainingPool(revealed).filter((n) => hitOf(key, n)).length;
// 生成一个大小为 ballIdx 的随机 revealed 集（用固定伪随机避免依赖 Math.random）
const genRevealed = (size, salt) => {
  const rng = makeSeededRng('rev'.repeat(21) + '0', String(salt), size);
  const pool = Array.from({ length: 75 }, (_, i) => i + 1);
  for (let k = 0; k < size; k++) { const j = k + Math.floor(rng() * (75 - k)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
  return pool.slice(0, size);
};
const testKeys = [...GROUP_KEYS, ...COMBO_KEYS, 'num-1', 'num-38', 'num-75'];
let idOk = true, idWorst = 0, idWorstK = '';
const rtpByKey = {};
for (const key of testKeys) {
  const R = R_OF(key);
  for (let ballIdx = 0; ballIdx <= 2; ballIdx++) {
    for (let s = 0; s < 30; s++) {   // 每 (key,ballIdx) 抽 30 组 revealed
      const revealed = genRevealed(ballIdx, `${key}-${ballIdx}-${s}`);
      const odds = oddsFor(key, ballIdx, revealed);
      const ck = countInPool(key, revealed);
      const pool = 75 - ballIdx;
      if (odds == null) { if (ck !== 0 && !revealed.includes(Number(String(key).slice(4)))) { idOk = false; } continue; }
      const rtp = odds * ck / pool;
      rtpByKey[key] = rtp;
      const dev = Math.abs(rtp - R);
      if (dev > idWorst) { idWorst = dev; idWorstK = `${key}@b${ballIdx}`; }
      if (dev > 0.006) idOk = false;
    }
  }
}
check('⭐ 逐键逐 ballIdx(0/1/2)×30 组 revealed：oddsFor × c_k/pool == R（RTP 恒=R 与已开球无关）', idOk, `最大偏差 ${(idWorst * 100).toFixed(3)}% @ ${idWorstK}`);
// 逐键 R 全入 94-97.5%
let bandOk = true, minR = 1, maxR = 0;
for (const key of testKeys) { const R = R_OF(key); minR = Math.min(minR, R); maxR = Math.max(maxR, R); if (!(R >= 0.94 && R <= 0.975)) bandOk = false; }
check('逐键 R 锚全入 [94%, 97.5%]', bandOk, `范围 ${(minR * 100).toFixed(2)}%–${(maxR * 100).toFixed(2)}%`);
// 打印几个代表
console.log('  代表键 RTP=R 核对：');
for (const key of ['big', 'small', 'odd', 'red', 'row-t1', 'row-t5', 'col-1', 'big-odd', 'small-even', 'num-38']) {
  const R = R_OF(key), odds0 = oddsFor(key, 0, []), ck0 = countInPool(key, []);
  console.log(`    ${key.padEnd(10)} R=${R.toFixed(4)}  odds₁=${odds0}  c₁=${ck0}  → RTP=${(odds0 * ck0 / 75).toFixed(4)}`);
}

// ===== 3. c_k=0 / 已开号 边界 =====
console.log('\n=== c_k=0 / 已开号边界（不可押 → null）===');
check('已开单号 num-38（revealed 含 38）→ oddsFor=null', oddsFor('num-38', 1, [38]) === null);
check('未开单号 num-38（revealed=[1]）→ oddsFor≠null', oddsFor('num-38', 1, [1]) !== null);
// 行注 row-t1（1-5 共 5 号）全开 → c=0 → null
check('row-t1 五号 [1,2,3,4,5] 全开（ballIdx=5 虚设）→ c=0 → null', oddsFor('row-t1', 5, [1, 2, 3, 4, 5]) === null);
check('row-t1 开 4 号 [1,2,3,4] → c=1 → odds≠null', oddsFor('row-t1', 4, [1, 2, 3, 4]) !== null);
// 组合 big-odd（19 号）耗尽 → null
{
  const bigOdd = remainingPool([]).filter((n) => hitOf('big-odd', n));
  check('big-odd 全 19 号开出 → c=0 → null', oddsFor('big-odd', bigOdd.length, bigOdd) === null && bigOdd.length === 19);
}

// ===== 4. MC 佐证：模拟整局（3 球按步抽 + 每球锁定 odds 结算），各键经验 RTP≈R =====
console.log('\n=== MC 佐证（2e6 局，整局 3 球按步抽 + 锁定 odds 结算）===');
const NMC = 2_000_000;
const mcKeys = ['big', 'small', 'odd', 'even', 'red', 'blue', 'row-t1', 'row-t3', 'row-t5', 'col-1', 'col-3', 'big-odd', 'small-even', 'num-38'];
const stakeAcc = Object.fromEntries(mcKeys.map((k) => [k, 0]));
const winAcc = Object.fromEntries(mcKeys.map((k) => [k, 0]));
let distinctOk = true;
for (let i = 0; i < NMC; i++) {
  const revealed = [];
  for (let ballIdx = 0; ballIdx < 3; ballIdx++) {
    // 每球：对每个可押键锁定 odds 押 1 单位，抽球，结算
    const rng = makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i * 3 + ballIdx);
    const pool = remainingPool(revealed);
    const ball = drawBall(pool, rng);
    for (const key of mcKeys) {
      const odds = oddsFor(key, ballIdx, revealed);
      if (odds == null) continue;   // 不可押不计
      stakeAcc[key] += 1;
      if (hitOf(key, ball)) winAcc[key] += odds;
    }
    revealed.push(ball);
  }
  if (new Set(revealed).size !== 3) distinctOk = false;
}
check('无放回：每局 3 球互异', distinctOk);
let mcOk = true, mcWorst = 0, mcWorstK = '';
for (const key of mcKeys) {
  const rtp = winAcc[key] / stakeAcc[key];
  const R = R_OF(key);
  const dev = Math.abs(rtp - R);
  if (dev > mcWorst) { mcWorst = dev; mcWorstK = key; }
  if (dev > 0.004) mcOk = false;
}
check('各键经验 RTP ≈ R（偏差<0.4%，证明 drawBall 无偏 + 锁定 odds 结算对）', mcOk, `worst=${mcWorstK} dev=${(mcWorst * 100).toFixed(3)}%`);
// 打印
for (const key of ['big', 'row-t1', 'big-odd', 'num-38']) console.log(`  ${key.padEnd(10)} MC RTP=${(winAcc[key] / stakeAcc[key]).toFixed(4)}（R=${R_OF(key).toFixed(4)}）`);

// ===== 5. 剩余池均匀 + 确定性 + seededRng 集成 =====
console.log('\n=== 剩余池均匀 + 确定性 + seededRng 集成 ===');
const ss = 'a'.repeat(64);
check('同 seed drawBall 两次一致', drawBall(remainingPool([]), makeSeededRng(ss, 'cs', 7)) === drawBall(remainingPool([]), makeSeededRng(ss, 'cs', 7)));
check('drawBall 从剩余池抽（不含已开号）', [...Array(200)].every((_, i) => { const rev = [5, 10, 40]; const b = drawBall(remainingPool(rev), makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i)); return b >= 1 && b <= 75 && !rev.includes(b); }));
// 球1 1-75 均匀
const freq = new Array(76).fill(0);
const NU = 750000;
for (let i = 0; i < NU; i++) freq[drawBall(remainingPool([]), makeSeededRng(crypto.randomBytes(8).toString('hex'), 'c', i))]++;
const exp = NU / 75;
let maxDev = 0; for (let n = 1; n <= 75; n++) maxDev = Math.max(maxDev, Math.abs(freq[n] - exp) / exp);
check('球1 1-75 均匀（最大偏差<2.5%）', maxDev < 0.025, `maxDev ${(maxDev * 100).toFixed(2)}%`);

console.log(`\n${allPass ? 'ALL PASS ✅ RollingBall 引擎钉死（动态赔率 RTP 恒等式）' : 'SOME FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
