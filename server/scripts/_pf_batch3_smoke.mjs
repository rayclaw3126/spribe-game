// 批 3 实测：/seed current/rotate/client 闭环。核心=hash闭环 + 历史局可复算。
import crypto from 'crypto';
import { pool, query } from '../src/db.js';
import { rollDice } from '../src/game/dice.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `pf3-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const api = async (path, body, method = 'POST') => {
  const r = await fetch(`${BASE}/${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: method === 'GET' ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};

// ---- 起点：先 rotate 到干净新种子（nonce=0），隔离历史 ----
await api('seed/rotate', {});

// ================= 1. GET /seed/current 无明文 =================
console.log('== GET /seed/current ==');
const cur0 = await api('seed/current', null, 'GET');
check('current 200', cur0.status === 200);
check('current 无 serverSeed 明文', !('serverSeed' in cur0.json), `keys=${Object.keys(cur0.json).join(',')}`);
check('current 有 serverSeedHash+clientSeed+nonce', typeof cur0.json.serverSeedHash === 'string' && cur0.json.serverSeedHash.length === 64 && typeof cur0.json.clientSeed === 'string' && Number.isInteger(cur0.json.nonce));
check('current 起点 nonce=0', cur0.json.nonce === 0, `nonce=${cur0.json.nonce}`);

// ================= 2. 打 3 注 dice，nonce 涨 & 记录用于历史验证 =================
console.log('\n== 打 3 注 dice（历史局，供 rotate 后验证）==');
const bets = [];
for (let i = 0; i < 3; i++) {
  const r = await api('round/dice/play', { amount: '10', target: 50, direction: 'under', idempotencyKey: kkey('h') });
  bets.push({ roundId: r.json.roundId, roll: r.json.roll, clientSeed: r.json.clientSeed, nonce: r.json.nonce });
}
const curAfter = await api('seed/current', null, 'GET');
check('打注后 current nonce == 3', curAfter.json.nonce === 3, `nonce=${curAfter.json.nonce}`);
check('打注后 current 仍无明文', !('serverSeed' in curAfter.json));
const hashBeforeRotate = curAfter.json.serverSeedHash;

// ================= 3. POST /seed/rotate —— hash 闭环 =================
console.log('\n== POST /seed/rotate（hash 闭环 = provably-fair 核心）==');
const rot = await api('seed/rotate', { clientSeed: 'my-custom-seed-123' });
check('rotate 200', rot.status === 200);
check('rotate revealed【有】serverSeed 明文', typeof rot.json.revealed?.serverSeed === 'string' && rot.json.revealed.serverSeed.length === 64, `len=${rot.json.revealed?.serverSeed?.length}`);
// ★ 闭环①：reveal 的明文 sha256 == 之前公开的 hash
check('★ sha256(revealed.serverSeed) == revealed.serverSeedHash', sha256(rot.json.revealed.serverSeed) === rot.json.revealed.serverSeedHash);
check('★ sha256(revealed.serverSeed) == rotate前公布的 current hash', sha256(rot.json.revealed.serverSeed) === hashBeforeRotate, `sha=${sha256(rot.json.revealed.serverSeed).slice(0,12)} hashBefore=${hashBeforeRotate.slice(0,12)}`);
check('rotate active nonce=0', rot.json.active?.nonce === 0);
check('rotate active【无】serverSeed 明文', !('serverSeed' in (rot.json.active || {})), `active_keys=${Object.keys(rot.json.active || {}).join(',')}`);
check('rotate active clientSeed == 传入的自定义', rot.json.active.clientSeed === 'my-custom-seed-123');

// ================= 4. rotate 后 current 变新种子、nonce 归零 =================
console.log('\n== rotate 后 current ==');
const cur2 = await api('seed/current', null, 'GET');
check('rotate 后 current hash 变了（新种子）', cur2.json.serverSeedHash !== hashBeforeRotate);
check('rotate 后 current nonce=0', cur2.json.nonce === 0);
check('rotate 后 current clientSeed == 自定义', cur2.json.clientSeed === 'my-custom-seed-123');

// ================= 5. ★ 端到端：用 revealed.serverSeed 重算历史 3 局 == 当时 roll =================
console.log('\n== ★ 端到端历史局验证（玩家真能用 revealed 明文验公平）==');
const revealedServerSeed = rot.json.revealed.serverSeed;
let recomputeAllOk = true;
for (const b of bets) {
  const recalc = rollDice(revealedServerSeed, b.clientSeed, b.nonce);
  const ok = recalc === b.roll;
  if (!ok) recomputeAllOk = false;
  console.log(`   round ${b.roundId}: nonce=${b.nonce} recalc=${recalc} vs roll=${b.roll}  ${ok ? '✓' : '✗'}`);
}
check('★ revealed.serverSeed 重算 3 局历史 == 当时 roll', recomputeAllOk);

// ================= 6. POST /seed/client —— nonce=0 成功 / nonce>0 被拒 =================
console.log('\n== POST /seed/client ==');
// 此刻 nonce=0（刚 rotate）→ 应成功
const setOk = await api('seed/client', { clientSeed: 'fresh-client-abc' });
check('client set 在 nonce=0 成功', setOk.status === 200 && setOk.json.clientSeed === 'fresh-client-abc', `HTTP ${setOk.status}`);
// 打一注让 nonce>0
await api('round/dice/play', { amount: '10', target: 50, direction: 'under', idempotencyKey: kkey('bump') });
const setRej = await api('seed/client', { clientSeed: 'should-be-rejected' });
check('client set 在 nonce>0 被拒（409）', setRej.status === 409, `HTTP ${setRej.status} msg=${setRej.json?.error}`);
// 非法 clientSeed
const setBad = await api('seed/client', { clientSeed: '' });
check('client set 空串被拒（400）', setBad.status === 400, `HTTP ${setBad.status}`);

// ================= 7. 并发双 rotate —— 最终只有一条 active =================
console.log('\n== 并发双 rotate（不变量：恰一条 active）==');
const [r1, r2] = await Promise.all([api('seed/rotate', {}), api('seed/rotate', {})]);
const activeCount = (await query(`SELECT count(*)::int n FROM player_seeds WHERE player_id=1 AND status='active'`)).rows[0].n;
check('并发双 rotate 后恰有 1 条 active', activeCount === 1, `active_count=${activeCount} (r1=${r1.status}, r2=${r2.status})`);
check('并发两方都是 200 或 一方 409（均合法）', [r1.status, r2.status].every((s) => s === 200 || s === 409));

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
