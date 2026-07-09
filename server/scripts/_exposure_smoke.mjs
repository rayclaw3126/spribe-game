// exposure 批 2 真机 smoke：堆敞口拦 exposure_over_limit / 开满 10 拦 too_many_open_rounds /
// 正常不误伤 / hilo 行为观察。玩家 alice。
import { pool, query } from '../src/db.js';
const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `expo-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const api = async (path, body) => {
  const r = await fetch(`${BASE}/round/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const balance = async () => Number((await query('SELECT balance FROM wallets WHERE player_id=1')).rows[0].balance);
const openCount = async () => (await query("SELECT count(*)::int n FROM rounds WHERE player_id=1 AND game IN('mines','hilo') AND status='playing'")).rows[0].n;
const cleanup = async () => { await query("UPDATE rounds SET status='cashed' WHERE player_id=1 AND game IN('mines','hilo') AND status='playing'"); };

const startMines = (bet, mines) => api('mines/start', { amount: String(bet), mines, idempotencyKey: kkey('m') });
const startHilo = (bet) => api('hilo/start', { amount: String(bet), idempotencyKey: kkey('h') });

await cleanup();
console.log('清理旧 playing 局，起点 open =', await openCount(), '\n');

// ===== A. 堆敞口 → exposure_over_limit（bet1000 mines1 潜在≈12035，4 局≈48141<50000，第5局超）=====
console.log('== A. 堆敞口拦 exposure_over_limit ==');
let openedA = 0;
for (let i = 1; i <= 4; i++) { const r = await startMines(1000, 1); if (r.status === 200) openedA++; else console.log(`  意外: 第${i}局 ${r.status} ${r.code}`); }
check('前 4 局 bet1000 mines1 正常开', openedA === 4, `opened=${openedA}, openCount=${await openCount()}`);
const balBeforeRej = await balance();
const cntBeforeRej = await openCount();
const rej = await startMines(1000, 1); // 第5局应超敞口
check('第 5 局超敞口 → 400 + exposure_over_limit', rej.status === 400 && rej.code === 'exposure_over_limit', `HTTP ${rej.status} code ${rej.code}`);
check('拒后不扣钱（余额没变）', await balance() === balBeforeRej, `before=${balBeforeRej} after=${await balance()}`);
check('拒后不开局（playing 数没增）', await openCount() === cntBeforeRej, `before=${cntBeforeRej} after=${await openCount()}`);

await cleanup();
// ===== B. 开满 10 → too_many_open_rounds（bet1 mines1 潜在≈12，10 局≈120<<50000，第11局撞局数）=====
console.log('\n== B. 开满 10 拦 too_many_open_rounds ==');
let openedB = 0;
for (let i = 1; i <= 10; i++) { const r = await startMines(1, 1); if (r.status === 200) openedB++; }
check('开满 10 局 bet1（未撞敞口额）', openedB === 10, `opened=${openedB}`);
const rej2 = await startMines(1, 1);
check('第 11 局 → 400 + too_many_open_rounds', rej2.status === 400 && rej2.code === 'too_many_open_rounds', `HTTP ${rej2.status} code ${rej2.code}`);

await cleanup();
// ===== C. 正常不误伤 =====
console.log('\n== C. 正常不误伤 ==');
const c1 = await startMines(10, 3);
const c2 = await startMines(10, 3);
check('开 2 局普通 mines 正常', c1.status === 200 && c2.status === 200, `${c1.status}/${c2.status}`);

await cleanup();
// ===== D. hilo 行为观察（单局潜在=cap 50000）=====
console.log('\n== D. hilo 行为观察 ==');
const h1 = await startHilo(10);
check('第 1 个 hilo 能开（total=50000 未 >50000）', h1.status === 200, `HTTP ${h1.status} code ${h1.code}`);
const h2 = await startHilo(10);
console.log(`  第 2 个 hilo: HTTP ${h2.status} code ${h2.code}  → ${h2.status === 400 && h2.code === 'exposure_over_limit' ? '被拦（只能开 1 个 hilo）' : '未拦'}`);
check('第 2 个 hilo 行为已观察（记录用，非判定）', true, `2nd hilo = ${h2.code || h2.status}`);

await cleanup();
console.log('\n最终 open =', await openCount());
console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
