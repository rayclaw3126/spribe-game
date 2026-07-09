// 批 A 对拍：前端 crypto.subtle 重算 dice == 后端开出的 roll（钉死算法地基）。
// 跑法：cd server && node scripts/_fairverify_crosscheck.mjs（node18+，globalThis.crypto.subtle）
import { pool, query } from '../src/db.js';
import { verifyDice } from '../../src/lib/fairVerify.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `fvx-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

// 反例用：把 hex 字符串【解码成字节】当 key（错误做法），证明它对不上
const enc = new TextEncoder();
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
async function verifyDiceWrongKey(serverSeed, clientSeed, nonce) {
  const key = await crypto.subtle.importKey('raw', hexToBytes(serverSeed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${clientSeed}:${nonce}`));
  const bytes = new Uint8Array(sig);
  let hex = ''; for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  const r = parseInt(hex.slice(0, 13), 16) / 2 ** 52;
  return Math.floor(r * 100 * 100) / 100;
}

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const playDice = async (target, direction) => {
  const r = await fetch(`${BASE}/round/dice/play`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount: '10', target, direction, idempotencyKey: kkey('d') }),
  });
  return (await r.json());
};

console.log('node', process.version, '| crypto.subtle:', typeof globalThis.crypto?.subtle, '\n');

// ---- 打 5 局不同 nonce，逐局对拍 ----
const params = [[50, 'under'], [30, 'over'], [77, 'under'], [10, 'over'], [60, 'under']];
console.log('局 | nonce | 后端 roll | 前端 roll(subtle) | ===');
console.log('---|-------|-----------|-------------------|----');
let recomputeAllOk = true;
const samples = [];
for (let i = 0; i < params.length; i++) {
  const [target, direction] = params[i];
  const resp = await playDice(target, direction);
  // server_seed 明文只在库里（响应不含，模型 A）
  const row = (await query('SELECT server_seed FROM rounds WHERE id = $1', [resp.roundId])).rows[0];
  const feRoll = await verifyDice(row.server_seed, resp.clientSeed, resp.nonce);
  const ok = feRoll === resp.roll;
  if (!ok) recomputeAllOk = false;
  samples.push({ serverSeed: row.server_seed, clientSeed: resp.clientSeed, nonce: resp.nonce, roll: resp.roll });
  console.log(`${String(i + 1).padStart(2)} | ${String(resp.nonce).padStart(5)} | ${String(resp.roll).padStart(9)} | ${String(feRoll).padStart(17)} | ${ok ? '✓' : '✗ 不符'}`);
}
check('★ 5 局 subtle 重算 roll === 后端 roll（UTF-8 key 正确）', recomputeAllOk);

// ---- 反例：hexToBytes 当 key 应对不上（证明坑真实、我们踩对了边）----
console.log('\n反例（hexToBytes 当 key，错误做法）：');
let wrongMismatchAll = true;
for (const s of samples) {
  const wrong = await verifyDiceWrongKey(s.serverSeed, s.clientSeed, s.nonce);
  const mismatch = wrong !== s.roll;
  if (!mismatch) wrongMismatchAll = false;
  console.log(`   nonce=${s.nonce}  错误key算=${wrong}  后端=${s.roll}  ${mismatch ? '≠ 对不上(符合预期)' : '⚠ 竟相等'}`);
}
check('★ 反例 hexToBytes-key 全部对不上（证明 UTF-8 key 是必须）', wrongMismatchAll);

console.log(`\n${allPass ? 'ALL PASS ✅ 算法地基钉死' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
