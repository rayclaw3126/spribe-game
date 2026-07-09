// 批 4 实测：mines/hilo 完整局无 serverSeed 明文 + nonce 跨局递增 + 可复算==结果 + 风控仍拦 + GET/:id 无明文。
import { pool, query } from '../src/db.js';
import { deriveMines } from '../src/game/mines.js';
import { deriveCard } from '../src/game/hilo.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `pf4-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const api = async (path, body, method = 'POST') => {
  const r = await fetch(`${BASE}/${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: method === 'GET' ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbRound = async (id) => (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [id])).rows[0];
// 断言一个响应体绝无 serverSeed 明文，且带 serverSeedHash
const noPlain = (label, obj) => {
  check(`${label}：无 serverSeed 明文`, !('serverSeed' in obj), `keys=${Object.keys(obj).join(',')}`);
  if ('serverSeedHash' in obj) check(`${label}：有 serverSeedHash`, typeof obj.serverSeedHash === 'string' && obj.serverSeedHash.length === 64);
};

// ================= MINES =================
console.log('== MINES 完整局 ==');
const ms = await api('round/mines/start', { amount: '10', mines: 3, idempotencyKey: kkey('ms') });
check('mines start 200', ms.status === 200, `HTTP ${ms.status}`);
noPlain('mines start', ms.json);
check('mines start 有 nonce', Number.isInteger(ms.json.nonce), `nonce=${ms.json.nonce}`);
const mNonce1 = ms.json.nonce;
// cashout（gems=0，mult=1）→ 终局响应
const mc = await api('round/mines/cashout', { roundId: ms.json.roundId });
check('mines cashout 200', mc.status === 200);
noPlain('mines cashout', mc.json);
// 可复算：库内 server_seed + client_seed + nonce 重算雷位 == 落库雷位
{
  const row = await dbRound(ms.json.roundId);
  const recalc = deriveMines(row.server_seed, row.client_seed, row.result.nonce, row.result.mineCount);
  check('mines 重算雷位 == 落库雷位', JSON.stringify(recalc) === JSON.stringify(row.result.mines), `recalc=[${recalc}] db=[${row.result.mines}]`);
}
// bust 路径：mines=24 揭一格几乎必炸
let mineBustSeen = false;
for (let i = 0; i < 8 && !mineBustSeen; i++) {
  const s = await api('round/mines/start', { amount: '10', mines: 24, idempotencyKey: kkey('mb') });
  const rv = await api('round/mines/reveal', { roundId: s.json.roundId, cell: 0 });
  if (rv.json && rv.json.safe === false) { noPlain('mines bust reveal', rv.json); mineBustSeen = true; }
  else { await api('round/mines/cashout', { roundId: s.json.roundId }); } // 收尾
}
check('mines bust 路径已覆盖', mineBustSeen);

// ================= HILO =================
console.log('\n== HILO 完整局 ==');
const hs = await api('round/hilo/start', { amount: '10', idempotencyKey: kkey('hs') });
check('hilo start 200', hs.status === 200, `HTTP ${hs.status}`);
noPlain('hilo start', hs.json);
check('hilo start 有 nonce + card', Number.isInteger(hs.json.nonce) && Number.isInteger(hs.json.card), `nonce=${hs.json.nonce} card=${hs.json.card}`);
// cashout（cum=1）→ 终局响应
const hc = await api('round/hilo/cashout', { roundId: hs.json.roundId });
check('hilo cashout 200', hc.status === 200);
noPlain('hilo cashout', hc.json);
// 可复算：重算首张明牌 == 落库 card
{
  const row = await dbRound(hs.json.roundId);
  const recalc = deriveCard(row.server_seed, row.client_seed, row.result.nonce, 0);
  check('hilo 重算首张明牌 == 落库 card', recalc === row.result.card, `recalc=${recalc} db=${row.result.card}`);
}
// bust 路径：不停猜到错为止
let hiloBustSeen = false;
for (let i = 0; i < 12 && !hiloBustSeen; i++) {
  const s = await api('round/hilo/start', { amount: '10', idempotencyKey: kkey('hb') });
  let card = s.json.card, rid = s.json.roundId, alive = true;
  for (let step = 0; step < 20 && alive; step++) {
    const dir = card <= 7 ? 'low' : 'high'; // 故意选赢面小的方向，加速 bust
    const g = await api('round/hilo/guess', { roundId: rid, dir });
    if (g.json?.correct === false) { noPlain('hilo bust guess', g.json); hiloBustSeen = true; alive = false; }
    else if (g.json?.correct === true) { card = g.json.card; }
    else { alive = false; }
  }
  if (alive) await api('round/hilo/cashout', { roundId: rid });
}
check('hilo bust 路径已覆盖', hiloBustSeen);

// ================= nonce 跨局递增 =================
console.log('\n== nonce 跨局递增 ==');
const a = await api('round/mines/start', { amount: '10', mines: 3, idempotencyKey: kkey('n1') });
await api('round/mines/cashout', { roundId: a.json.roundId });
const b = await api('round/mines/start', { amount: '10', mines: 3, idempotencyKey: kkey('n2') });
await api('round/mines/cashout', { roundId: b.json.roundId });
check('两局 mines start nonce 递增（持久 seed）', b.json.nonce > a.json.nonce, `n1=${a.json.nonce} n2=${b.json.nonce}`);

// ================= 风控仍拦 =================
console.log('\n== 风控仍拦 ==');
const mo = await api('round/mines/start', { amount: '5000', mines: 3, idempotencyKey: kkey('mo') });
check('mines start 5000 仍 400 + bet_above_max', mo.status === 400 && mo.code === 'bet_above_max', `HTTP ${mo.status} code ${mo.code}`);
const ho = await api('round/hilo/start', { amount: '5000', idempotencyKey: kkey('ho') });
check('hilo start 5000 仍 400 + bet_above_max', ho.status === 400 && ho.code === 'bet_above_max', `HTTP ${ho.status} code ${ho.code}`);

// ================= GET /:id 无明文 =================
console.log('\n== GET /round/:id 无 server_seed 明文 ==');
const detail = await api(`round/${ms.json.roundId}`, null, 'GET');
check('GET /:id 200', detail.status === 200);
check('GET /:id 响应无 server_seed 明文', !('server_seed' in detail.json), `keys=${Object.keys(detail.json).join(',')}`);
check('GET /:id 有 result_hash', 'result_hash' in detail.json);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
