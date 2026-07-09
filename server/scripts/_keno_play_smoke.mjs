// Keno /keno/play 端到端 smoke：正常/无明文/风控/payout cap 兜顶赔/可复算==drawn/nonce递增/防假selected/RTP sanity。
import { pool, query } from '../src/db.js';
import { drawKeno, kenoPayout } from '../src/game/keno.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `keno-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (body) => {
  const r = await fetch(`${BASE}/round/keno/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbSeed = async (id) => (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [id])).rows[0];

// 1. 正常注 + 响应形状 + 无明文
console.log('== 正常 + 无明文 ==');
const r1 = await play({ amount: '10', selected: [1, 5, 12, 20, 33], idempotencyKey: kkey('n') });
check('keno 正常注 200', r1.status === 200, `HTTP ${r1.status}`);
check('响应有 drawn(10)/matches/mult/serverSeedHash/nonce', Array.isArray(r1.json.drawn) && r1.json.drawn.length === 10 && Number.isInteger(r1.json.matches) && typeof r1.json.mult === 'number' && r1.json.serverSeedHash?.length === 64 && Number.isInteger(r1.json.nonce), `drawn=${r1.json.drawn} matches=${r1.json.matches} mult=${r1.json.mult}`);
check('响应【无】serverSeed 明文', !('serverSeed' in r1.json), `keys=${Object.keys(r1.json).join(',')}`);

// 2. 可复算：库内 server_seed + 响应 clientSeed/nonce 本地重算 == 响应 drawn
console.log('\n== 可复算 ==');
const row = await dbSeed(r1.json.roundId);
const recalc = drawKeno(row.server_seed, r1.json.clientSeed, r1.json.nonce);
check('本地 drawKeno 重算 == 响应 drawn', JSON.stringify(recalc) === JSON.stringify(r1.json.drawn), `recalc=${recalc}`);
const expMatches = kenoPayout([1, 5, 12, 20, 33], r1.json.drawn).matches;
check('本地 matches == 响应 matches', expMatches === r1.json.matches, `local=${expMatches} resp=${r1.json.matches}`);

// 3. nonce 递增
console.log('\n== nonce 递增 ==');
const seq = [];
for (let i = 0; i < 3; i++) { const r = await play({ amount: '10', selected: [2, 4, 6], idempotencyKey: kkey('seq') }); seq.push(r.json.nonce); }
check('连打 3 注 nonce 递增', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(',')}]`);

// 4. 风控：超 maxBet(100)
console.log('\n== 风控 ==');
const over = await play({ amount: '200', selected: [1, 2, 3], idempotencyKey: kkey('over') });
check('keno bet200 (>maxBet100) → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `HTTP ${over.status} code ${over.code}`);

// 5. payout cap：真顶赔 10000× 是 1/67万，smoke 摸不到 → 由独立 temp-cap 脚本证明（见 _keno_cap_proof）。
console.log('\n== payout cap（顶赔 1/67万 smoke 摸不到，独立 temp-cap 脚本证明）==');

// 6. 防假 selected：客户端传的 matches 不被信（我们本就不收 matches；验服务端按摇号自算）
console.log('\n== 防作弊：matches 服务端自算 ==');
const cheat = await play({ amount: '10', selected: [1, 2, 3], matches: 3, mult: 999, payout: 999999, idempotencyKey: kkey('cheat') });
const trueMatches = kenoPayout([1, 2, 3], cheat.json.drawn).matches;
check('前端塞假 matches/mult/payout 被忽略，服务端自算', cheat.json.matches === trueMatches && cheat.json.mult !== 999, `serverMatches=${cheat.json.matches} serverMult=${cheat.json.mult}`);

// 7. RTP sanity（pick2 max 13× 低方差，几千局收敛到批1精确 92.86% 附近）
console.log('\n== RTP sanity（pick2，低方差）==');
let paid = 0, N = 4000;
for (let i = 0; i < N; i++) { const r = await play({ amount: '1', selected: [7, 22], idempotencyKey: kkey('rtp') }); paid += Number(r.json.payout || 0); }
const mcRtp = paid / N;
// 带宽放宽到 ±~4σ（pick2 的 13× jackpot 使 4000 局 σ≈5.3%）——只求捕捉「引擎坏成 0%/300%」级毛病，
// 精确 RTP=92.86% 由批1超几何精算证明，此处仅 live sanity。
check('pick2 RTP sanity 落在 精确92.86% 合理带 (78–112%)', mcRtp > 0.78 && mcRtp < 1.12, `MC=${(mcRtp * 100).toFixed(2)}% (N=${N}, 精确92.86%)`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
