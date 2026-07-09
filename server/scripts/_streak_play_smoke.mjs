// StreakRoll /streak/play 端到端 smoke：正常两档/无明文/可复算/nonce/风控/防作弊/RTP sanity。
import { pool, query } from '../src/db.js';
import { drawStreak, streakPayout } from '../src/game/streakRoll.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `streak-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (body) => {
  const r = await fetch(`${BASE}/round/streak/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbSeed = async (id) => (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [id])).rows[0];

// 1. 正常 + 无明文（normal 档）
console.log('== 正常 + 无明文（normal）==');
const r1 = await play({ amount: '10', color: 'B', risk: 'normal', idempotencyKey: kkey('n') });
check('streak 正常注 200', r1.status === 200, `HTTP ${r1.status}`);
check('响应有 landed/idx/mult/serverSeedHash/nonce', ['B', 'R', 'F'].includes(r1.json.landed) && Number.isInteger(r1.json.idx) && typeof r1.json.mult === 'number' && r1.json.serverSeedHash?.length === 64 && Number.isInteger(r1.json.nonce), `landed=${r1.json.landed} idx=${r1.json.idx} mult=${r1.json.mult}`);
check('响应【无】serverSeed 明文', !('serverSeed' in r1.json), `keys=${Object.keys(r1.json).join(',')}`);

// 2. 两档都测：mult 按档走
console.log('\n== 两档 pattern/mult ==');
// 押 F 直到命中，确认 normal F=30.4 / high F=7.6（或验落格 F 时 mult 对档）
let normalFmult = null, highFmult = null;
for (let i = 0; i < 200 && (normalFmult === null || highFmult === null); i++) {
  const rn = await play({ amount: '1', color: 'F', risk: 'normal', idempotencyKey: kkey('fn') });
  if (rn.json.landed === 'F' && normalFmult === null) normalFmult = rn.json.mult;
  const rh = await play({ amount: '1', color: 'F', risk: 'high', idempotencyKey: kkey('fh') });
  if (rh.json.landed === 'F' && highFmult === null) highFmult = rh.json.mult;
}
check('normal 落 F 中 → mult 30.40', normalFmult === 30.4, `normalFmult=${normalFmult}`);
check('high 落 F 中 → mult 7.60', highFmult === 7.6, `highFmult=${highFmult}`);

// 3. 可复算：库内 server_seed 本地重算 == 响应 landed
console.log('\n== 可复算 ==');
const row = await dbSeed(r1.json.roundId);
const recalc = drawStreak(row.server_seed, r1.json.clientSeed, r1.json.nonce, 'normal');
check('本地 drawStreak.landed == 响应 landed', recalc.landed === r1.json.landed && recalc.idx === r1.json.idx, `recalc landed=${recalc.landed} idx=${recalc.idx}`);
check('本地 streakPayout.mult == 响应 mult', streakPayout(r1.json.color, 'normal', recalc.landed).mult === r1.json.mult);

// 4. nonce 递增
console.log('\n== nonce 递增 ==');
const seq = [];
for (let i = 0; i < 3; i++) { const r = await play({ amount: '10', color: 'R', risk: 'normal', idempotencyKey: kkey('seq') }); seq.push(r.json.nonce); }
check('连打 3 注 nonce 递增', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(',')}]`);

// 5. 风控
console.log('\n== 风控 ==');
const over = await play({ amount: '200', color: 'B', risk: 'normal', idempotencyKey: kkey('over') });
check('streak bet200 (>maxBet100) → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `HTTP ${over.status} code ${over.code}`);
const badColor = await play({ amount: '10', color: 'X', risk: 'normal', idempotencyKey: kkey('bc') });
check('非法 color → 400', badColor.status === 400);
const badRisk = await play({ amount: '10', color: 'B', risk: 'insane', idempotencyKey: kkey('br') });
check('非法 risk → 400', badRisk.status === 400);

// 6. 防作弊：客户端塞假 landed/mult/payout 被忽略
console.log('\n== 防作弊 ==');
const cheat = await play({ amount: '10', color: 'B', risk: 'normal', landed: 'F', mult: 999, payout: 999999, idempotencyKey: kkey('cheat') });
const trueLanded = (await dbSeed(cheat.json.roundId));
const trueRecalc = drawStreak(trueLanded.server_seed, cheat.json.clientSeed, cheat.json.nonce, 'normal');
check('前端塞假 landed/mult/payout 被忽略，服务端自算', cheat.json.landed === trueRecalc.landed && cheat.json.mult !== 999, `serverLanded=${cheat.json.landed} serverMult=${cheat.json.mult}`);

// 7. RTP sanity（押 B normal，几千局，精确 0.95）
console.log('\n== RTP sanity（B normal）==');
let paid = 0, N = 4000;
for (let i = 0; i < N; i++) { const r = await play({ amount: '1', color: 'B', risk: 'normal', idempotencyKey: kkey('rtp') }); paid += Number(r.json.payout || 0); }
const rtp = paid / N;
check('B normal RTP sanity 落在 精确95% 合理带 (88–102%)', rtp > 0.88 && rtp < 1.02, `MC=${(rtp * 100).toFixed(2)}% (N=${N}, 精确95%)`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
