// exposure 批2收尾：hilo exposureMult 口径重验（小注可并发 / 混玩不互锁 / 大注严管 / 双闸没坏）。
import { pool, query } from '../src/db.js';
const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `expoh-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const api = async (path, body) => {
  const r = await fetch(`${BASE}/round/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null };
};
const cleanup = async () => query("UPDATE rounds SET status='cashed' WHERE player_id=1 AND game IN('mines','hilo') AND status='playing'");
const mines = (bet, m) => api('mines/start', { amount: String(bet), mines: m, idempotencyKey: kkey('m') });
const hilo = (bet) => api('hilo/start', { amount: String(bet), idempotencyKey: kkey('h') });

await cleanup();
await query('UPDATE wallets SET balance=1000000 WHERE player_id=1');   // 充值消除对余额的隐性依赖（多局堆敞口需足额本金）

// 1. 小注 hilo 可并发（bet10 潜在=2000，5 局=10000<50000）
console.log('== 小注 hilo 可并发 ==');
let ok1 = 0; for (let i = 0; i < 5; i++) if ((await hilo(10)).status === 200) ok1++;
check('开 5 个 bet10 hilo 全成功（total=10000）', ok1 === 5, `opened=${ok1}`);
await cleanup();

// 2. hilo + mines 混玩不互锁（mines100/mines2=14889 + 5×hilo10=10000 = 24889 < 50000）
console.log('\n== hilo + mines 混玩不互锁 ==');
const mx = await mines(100, 2);
let ok2 = 0; for (let i = 0; i < 5; i++) if ((await hilo(10)).status === 200) ok2++;
check('1 局 mines(14889) + 5 局小注 hilo 共存', mx.status === 200 && ok2 === 5, `mines=${mx.status} hilo=${ok2}`);
await cleanup();

// 3. 大注 hilo 严管（maxBet=100，bet100 潜在=min(100×200,50000)=20000；开 2 个共 40000<50000，第 3 个 60000>50000 被拦）
console.log('\n== 大注 hilo 严管 ==');
let okBig = 0; for (let i = 0; i < 2; i++) if ((await hilo(100)).status === 200) okBig++;
check('bet100 hilo 开 2 个成功（total=40000<50000）', okBig === 2, `opened=${okBig}`);
const after = await hilo(100);
check('第 3 个 hilo → exposure_over_limit（60000>50000）', after.status === 400 && after.code === 'exposure_over_limit', `HTTP ${after.status} code ${after.code}`);
await cleanup();

// 4. 双闸没坏
console.log('\n== 双闸没坏 ==');
for (let i = 0; i < 3; i++) await mines(100, 2); // 3×14889=44667
const g1 = await mines(100, 2); // 第4局 59556>50000 超敞口
check('exposure_over_limit 仍拦', g1.status === 400 && g1.code === 'exposure_over_limit', `${g1.status}/${g1.code}`);
await cleanup();
for (let i = 0; i < 10; i++) await mines(1, 1); // 10 局小注
const g2 = await mines(1, 1); // 第11局
check('too_many_open_rounds 仍拦', g2.status === 400 && g2.code === 'too_many_open_rounds', `${g2.status}/${g2.code}`);
await cleanup();
await query('UPDATE wallets SET balance=462.74 WHERE player_id=1');   // 还原基线余额

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
