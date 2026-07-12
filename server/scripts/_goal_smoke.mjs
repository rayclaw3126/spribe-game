// Goal 三段 handler smoke：正常局/tier锁/白名单剥雷位/exposure混合/可复算/风控/无明文/自动结算。
import { pool, query } from '../src/db.js';
import { deriveBombRows, TIERS, COLS } from '../src/game/goal.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `goal-${p}-${Date.now()}-${uid++}`;
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
const getDetail = async (id) => (await api(`${id}`, {}).catch(() => null)) && (await (await fetch(`${BASE}/round/${id}`, { headers: { authorization: `Bearer ${token}` } })).json());
const dbRound = async (id) => (await query('SELECT server_seed, client_seed, result, status, payout FROM rounds WHERE id=$1', [id])).rows[0];
const cleanup = async () => query("UPDATE rounds SET status='cashed' WHERE player_id=1 AND game IN('mines','hilo','goal') AND status='playing'");
// 用库内 server_seed 找本列一个安全行（避雷驱动）
const safeRow = (ss, cs, nonce, step, bombs) => { const b = deriveBombRows(ss, cs, nonce, step, bombs); for (let r = 0; r < 4; r++) if (!b.has(r)) return r; return 0; };

await cleanup();

// ===== 1. 正常局：start md → 逐列避雷 pick → cashout =====
console.log('== 正常局（md，避雷推进，cashout）==');
const s1 = await api('goal/start', { amount: '3', tier: 'md', idempotencyKey: kkey('s') });
check('goal start 200 + serverSeedHash/nonce/tier/无明文', s1.status === 200 && s1.json.serverSeedHash?.length === 64 && Number.isInteger(s1.json.nonce) && s1.json.tier === 'md' && !('serverSeed' in s1.json), `keys=${Object.keys(s1.json).join(',')}`);
const rid = s1.json.roundId;
const row0 = await dbRound(rid);
const bombs = TIERS.md.bombs;
// 推进 3 列（避雷）
let lastCum = 1;
for (let step = 0; step < 3; step++) {
  const safe = safeRow(row0.server_seed, row0.client_seed, s1.json.nonce, step, bombs);
  const p = await api('goal/pick', { roundId: rid, row: safe });
  check(`第${step + 1}列 避雷安全推进 safe=true`, p.status === 200 && p.json.safe === true, `safe=${p.json.safe} cum=${p.json.cum?.toFixed?.(4)}`);
  lastCum = p.json.cum;
}
// cashout
const co = await api('goal/cashout', { roundId: rid });
check('cashout 200 + 无明文 + 有 serverSeedHash', co.status === 200 && !('serverSeed' in co.json) && co.json.serverSeedHash?.length === 64, `payout=${co.json.payout}`);
check('cashout payout = round(bet3 × cum)', Math.abs(Number(co.json.payout) - Math.round(3 * lastCum * 100) / 100) < 0.01, `payout=${co.json.payout} 期望≈${(3 * lastCum).toFixed(2)}`);

await cleanup();

// ===== 2. tier 锁：start md，pick 塞 tier=sm 被忽略（从 result.tier 读）=====
console.log('\n== tier 锁（客户端塞 tier 无效）==');
const s2 = await api('goal/start', { amount: '3', tier: 'md', idempotencyKey: kkey('s2') });
const r2 = await dbRound(s2.json.roundId);
const safe2 = safeRow(r2.server_seed, r2.client_seed, s2.json.nonce, 0, TIERS.md.bombs); // 用 md(2雷) 算安全行
// 塞 tier=sm（1雷）——若被采纳，安全行可能不同；服务端应无视，仍用 md
const p2 = await api('goal/pick', { roundId: s2.json.roundId, row: safe2, tier: 'sm' });
const r2after = await dbRound(s2.json.roundId);
check('pick 塞 tier=sm 被忽略，result.tier 仍 md', r2after.result.tier === 'md', `result.tier=${r2after.result.tier}`);
check('按 md(2雷) 派生的安全行确实安全（证明用 result.tier 不是客户端 tier）', p2.json.safe === true, `safe=${p2.json.safe}`);
await cleanup();

// ===== 3. 白名单：playing 中 GET /:id 无雷位 =====
console.log('\n== 白名单（playing 无雷位）==');
const s3 = await api('goal/start', { amount: '3', tier: 'lg', idempotencyKey: kkey('s3') });
const r3 = await dbRound(s3.json.roundId);
await api('goal/pick', { roundId: s3.json.roundId, row: safeRow(r3.server_seed, r3.client_seed, s3.json.nonce, 0, TIERS.lg.bombs) });
const detail = await getDetail(s3.json.roundId);
const keys = Object.keys(detail.result || {});
check('GET /:id playing: result 只有白名单字段（无 bombs/未来雷）', keys.every(k => ['tier', 'picks', 'cum', 'step', 'nonce', 'status'].includes(k)) && !keys.includes('bombs'), `result_keys=${keys.join(',')}`);
check('GET /:id 无 server_seed 明文', !('server_seed' in detail), '');
await cleanup();

// ===== 4. 可复算：库内 server_seed 逐列重算走过的列 == 实际 =====
console.log('\n== 可复算（逐列 deriveBombRows）==');
const s4 = await api('goal/start', { amount: '3', tier: 'lg', idempotencyKey: kkey('s4') });
const r4 = await dbRound(s4.json.roundId);
let recomputeOk = true;
for (let step = 0; step < 4; step++) {
  const bset = deriveBombRows(r4.server_seed, r4.client_seed, s4.json.nonce, step, TIERS.lg.bombs);
  const safe = [0, 1, 2, 3].find(r => !bset.has(r));
  const p = await api('goal/pick', { roundId: s4.json.roundId, row: safe });
  if (p.json.safe !== true) recomputeOk = false; // 本地算的安全行，服务端也应判安全
}
check('本地 deriveBombRows 逐列算的安全行，服务端逐列都判 safe（可复算一致）', recomputeOk);
await cleanup();

// ===== 5. exposure：goal lg 堆敞口 + 混合 =====
console.log('\n== exposure（goal lg 堆 + 混合）==');
const g1 = await api('goal/start', { amount: '3', tier: 'lg', idempotencyKey: kkey('e1') }); // 潜在 39714
check('第 1 个 goal lg 开（39714<50000）', g1.status === 200);
const g2 = await api('goal/start', { amount: '3', tier: 'lg', idempotencyKey: kkey('e2') }); // 79428>50000
check('第 2 个 goal lg → exposure_over_limit', g2.status === 400 && g2.code === 'exposure_over_limit', `${g2.status}/${g2.code}`);
// 混合：留着 g1(39714) 再开 mines bet100 mines2(潜在14889) → 54603>50000
const mx = await api('mines/start', { amount: '100', mines: 2, idempotencyKey: kkey('em') });
check('goal lg + mines 混合敞口 → mines 被拦 exposure_over_limit', mx.status === 400 && mx.code === 'exposure_over_limit', `${mx.status}/${mx.code}`);
await cleanup();

// ===== 6. 风控 + nonce 递增 =====
console.log('\n== 风控 + nonce ==');
const over = await api('goal/start', { amount: '4', tier: 'sm', idempotencyKey: kkey('over') });
check('goal bet4 (>maxBet3) → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `${over.status}/${over.code}`);
const n1 = await api('goal/start', { amount: '1', tier: 'sm', idempotencyKey: kkey('n1') });
const n2 = await api('goal/start', { amount: '1', tier: 'sm', idempotencyKey: kkey('n2') });
check('连开 goal nonce 递增', n2.json.nonce > n1.json.nonce, `n1=${n1.json.nonce} n2=${n2.json.nonce}`);
await cleanup();

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
