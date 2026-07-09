// 批 C 端到端：复刻 SeedFairness 抽屉的真实数据流。
// GET /seed/current → 打几注 dice → POST /seed/rotate 拿 revealed 明文 →
// verifyDice(revealed.serverSeed, 该局clientSeed, nonce) === 后端开出的 roll。
import { pool } from '../src/db.js';
import { verifyDice } from '../../src/lib/fairVerify.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `e2e-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const api = async (path, { method = 'GET', body } = {}) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
};

// 1. GET /seed/current（抽屉打开时的调用）
const cur = await api('/seed/current');
check('GET /seed/current 200 + 有 hash/clientSeed/nonce + 无明文',
  cur.status === 200 && cur.json.serverSeedHash?.length === 64 && typeof cur.json.clientSeed === 'string' && Number.isInteger(cur.json.nonce) && !('serverSeed' in cur.json),
  `nonce=${cur.json.nonce}`);

// 2. 打 3 注 dice（这些局用当前 active 种子，rotate 后可验）
const rounds = [];
for (let i = 0; i < 3; i++) {
  const r = await api('/round/dice/play', { method: 'POST', body: { amount: '10', target: 50, direction: 'under', idempotencyKey: kkey('d') } });
  rounds.push({ roll: r.json.roll, clientSeed: r.json.clientSeed, nonce: r.json.nonce });
}
console.log('打 3 注 dice：', rounds.map(r => `n${r.nonce}=${r.roll}`).join('  '));

// 3. POST /seed/rotate（轮换金钮）→ revealed 明文
const rot = await api('/seed/rotate', { method: 'POST', body: {} });
check('POST /seed/rotate 200 + revealed 有 serverSeed 明文 + active nonce=0',
  rot.status === 200 && rot.json.revealed?.serverSeed?.length === 64 && rot.json.active?.nonce === 0);
const revealedSeed = rot.json.revealed.serverSeed;

// 4. ★ 端到端：用 revealed 明文本地重算这 3 局 == 后端开出的 roll
console.log('\n★ 本地验证器（verifyDice）重算历史局：');
let e2eOk = true;
for (const r of rounds) {
  const local = await verifyDice(revealedSeed, r.clientSeed, r.nonce);
  const ok = local === r.roll;
  if (!ok) e2eOk = false;
  console.log(`   nonce=${r.nonce}  本地=${local}  后端=${r.roll}  ${ok ? '✓ 一致' : '✗ 不符'}`);
}
check('★ revealed.serverSeed 本地重算 3 局 == 后端 roll（端到端）', e2eOk);

// 5. 设 clientSeed：刚 rotate → nonce=0 应成功；再打一注 nonce>0 应被拒
const set0 = await api('/seed/client', { method: 'POST', body: { clientSeed: 'e2e-custom-seed' } });
check('设 clientSeed 在 nonce=0 成功', set0.status === 200 && set0.json.clientSeed === 'e2e-custom-seed', `HTTP ${set0.status}`);
await api('/round/dice/play', { method: 'POST', body: { amount: '10', target: 50, direction: 'under', idempotencyKey: kkey('bump') } });
const setN = await api('/seed/client', { method: 'POST', body: { clientSeed: 'should-reject' } });
check('设 clientSeed 在 nonce>0 被拒(409)', setN.status === 409, `HTTP ${setN.status}`);

console.log(`\n${allPass ? 'ALL PASS ✅ 端到端可验证公平打通' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
