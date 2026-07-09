// 批 2 可验证公平实测：instant 局响应无 serverSeed 明文 + nonce 跨局递增 + 可复算==结果 + 风控仍拦。
// 从 server 目录跑，直连 game 派生函数 + db 查库重算。
import { pool, query } from '../src/db.js';
import { rollDice } from '../src/game/dice.js';
import { derivePath } from '../src/game/plinko.js';
import { deriveMult } from '../src/game/limbo.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `pf2-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (path, body) => {
  const r = await fetch(`${BASE}/round/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbSeed = async (roundId) => (await query('SELECT server_seed, client_seed FROM rounds WHERE id=$1', [roundId])).rows[0];

// ---------- 1. 响应形状：有 hash/nonce，无 serverSeed 明文 ----------
console.log('== 响应形状 (无明文 + 有 hash + 有 nonce) ==');
const d0 = await play('dice/play', { amount: '10', target: 50, direction: 'under', idempotencyKey: kkey('d') });
check('dice 200', d0.status === 200, `HTTP ${d0.status}`);
check('dice 响应【无】serverSeed 明文', !('serverSeed' in d0.json), `keys=${Object.keys(d0.json).join(',')}`);
check('dice 响应有 serverSeedHash', typeof d0.json.serverSeedHash === 'string' && d0.json.serverSeedHash.length === 64);
check('dice 响应有 nonce', Number.isInteger(d0.json.nonce), `nonce=${d0.json.nonce}`);

const p0 = await play('plinko/play', { amount: '10', risk: 'green', rows: 16, idempotencyKey: kkey('p') });
check('plinko 200 + 无明文 + 有hash+nonce', p0.status === 200 && !('serverSeed' in p0.json) && p0.json.serverSeedHash?.length === 64 && Number.isInteger(p0.json.nonce), `keys=${Object.keys(p0.json).join(',')}`);

const l0 = await play('limbo/play', { amount: '10', target: 2, idempotencyKey: kkey('l') });
check('limbo 200 + 无明文 + 有hash+nonce', l0.status === 200 && !('serverSeed' in l0.json) && l0.json.serverSeedHash?.length === 64 && Number.isInteger(l0.json.nonce), `keys=${Object.keys(l0.json).join(',')}`);

// ---------- 2. nonce 跨局递增（持久 seed，非每局新种） ----------
console.log('\n== nonce 跨局递增 ==');
const seq = [];
for (let i = 0; i < 3; i++) {
  const r = await play('dice/play', { amount: '10', target: 50, direction: 'under', idempotencyKey: kkey('seq') });
  seq.push(r.json.nonce);
}
check('连打 3 注 nonce 严格递增 (n, n+1, n+2)', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(', ')}]`);
// 同一把 seed：3 局的 serverSeedHash 应相同（持久 seed 未换）
const hashes = [];
for (const n of seq) { /* already have via seq bets? re-fetch hash from last 3 rounds not needed */ }
check('持久 seed：连打的 serverSeedHash 恒定（未每局换种）',
  (await (async () => {
    const a = await play('dice/play', { amount: '10', target: 50, direction: 'under', idempotencyKey: kkey('h1') });
    const b = await play('dice/play', { amount: '10', target: 50, direction: 'under', idempotencyKey: kkey('h2') });
    return a.json.serverSeedHash === b.json.serverSeedHash;
  })()), 'two bets share serverSeedHash');

// ---------- 3. 可复算 == 响应结果（用库里 server_seed + 响应 clientSeed/nonce 重算） ----------
console.log('\n== 可复算 == 结果 ==');
const dSeed = await dbSeed(d0.json.roundId);
const dRecalc = rollDice(dSeed.server_seed, d0.json.clientSeed, d0.json.nonce);
check('dice 重算 roll == 响应 roll', dRecalc === d0.json.roll, `recalc=${dRecalc} resp=${d0.json.roll}`);
check('dice 库内 client_seed == 响应 clientSeed', dSeed.client_seed === d0.json.clientSeed);

const pSeed = await dbSeed(p0.json.roundId);
const pRecalc = derivePath(pSeed.server_seed, p0.json.clientSeed, p0.json.nonce, 16);
check('plinko 重算 path == 响应 path', JSON.stringify(pRecalc) === JSON.stringify(p0.json.path), `recalc=${pRecalc.join('')} resp=${(p0.json.path || []).join('')}`);

const lSeed = await dbSeed(l0.json.roundId);
const lRecalc = deriveMult(lSeed.server_seed, l0.json.clientSeed, l0.json.nonce);
check('limbo 重算 finalMult == 响应 finalMult', lRecalc === l0.json.finalMult, `recalc=${lRecalc} resp=${l0.json.finalMult}`);

// ---------- 4. 风控未被破坏 ----------
console.log('\n== 风控仍拦 ==');
const over = await play('dice/play', { amount: '600', target: 50, direction: 'under', idempotencyKey: kkey('over') });
check('dice 600 仍 400 + bet_above_max', over.status === 400 && over.code === 'bet_above_max', `HTTP ${over.status} code ${over.code}`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
