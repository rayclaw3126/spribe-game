// MiniRoulette /roulette/play 端到端：正常多注/部分赢/总额风控/防负注额/防假key/可复算/防作弊/nonce/无明文。
import { pool, query } from '../src/db.js';
import { spinRoulette, rouletteWinMult } from '../src/game/miniRoulette.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `roul-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (body) => {
  const r = await fetch(`${BASE}/round/roulette/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbSeed = async (id) => (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [id])).rows[0];

// 1. 正常多注 + 无明文 + 逐 key 结算正确
console.log('== 正常多注 ==');
const r1 = await play({ bets: { n8: 10, red: 10, odd: 10 }, idempotencyKey: kkey('n') });
check('roulette 多注 200', r1.status === 200, `HTTP ${r1.status}`);
check('响应有 n/perKeyPayout/totalPayout/serverSeedHash/nonce', Number.isInteger(r1.json.n) && r1.json.n >= 1 && r1.json.n <= 12 && typeof r1.json.perKeyPayout === 'object' && r1.json.serverSeedHash?.length === 64 && Number.isInteger(r1.json.nonce), `n=${r1.json.n} perKey=${JSON.stringify(r1.json.perKeyPayout)}`);
check('响应【无】serverSeed 明文', !('serverSeed' in r1.json), `keys=${Object.keys(r1.json).join(',')}`);
// 逐 key 结算：本地按落号 n 重算每 key payout == 响应
{
  const n = r1.json.n;
  const expPer = {};
  for (const [k, a] of Object.entries({ n8: 10, red: 10, odd: 10 })) { const m = rouletteWinMult(k, n); if (m > 0) expPer[k] = Math.round(a * m * 100) / 100; }
  const expTotal = Object.values(expPer).reduce((s, x) => s + x, 0);
  check('逐 key payout + 总额 == 本地按落号重算', JSON.stringify(r1.json.perKeyPayout) === JSON.stringify(expPer) && Math.abs(Number(r1.json.totalPayout) - expTotal) < 0.01, `落号${n} perKey=${JSON.stringify(r1.json.perKeyPayout)} total=${r1.json.totalPayout}`);
}

// 2. 部分赢：押 n1..n12 全部（必中 1 个单号）→ 只中落号那个
console.log('\n== 部分赢（押满 12 单号必中 1 个）==');
const allNums = {}; for (let i = 1; i <= 12; i++) allNums[`n${i}`] = 1; // 总注 12
const r2 = await play({ bets: allNums, idempotencyKey: kkey('part') });
check('押满 12 单号 → 只中落号 n{n}，payout=1×11.4=11.4', r2.status === 200 && Object.keys(r2.json.perKeyPayout).length === 1 && r2.json.perKeyPayout[`n${r2.json.n}`] === 11.4, `落号${r2.json.n} perKey=${JSON.stringify(r2.json.perKeyPayout)}`);

// 3. 总注额风控：Σ > 100
console.log('\n== 总注额风控 ==');
const over = await play({ bets: { red: 60, black: 60 }, idempotencyKey: kkey('over') }); // Σ=120>100
check('Σ注额 120 > maxBet100 → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `HTTP ${over.status} code ${over.code}`);

// 4. 防负注额（多注特有刷钱路子）
console.log('\n== 防负注额 ==');
const neg = await play({ bets: { n8: -50, red: 10 }, idempotencyKey: kkey('neg') });
check('塞负注额 {n8:-50} → 400（amount 必须 >0）', neg.status === 400, `HTTP ${neg.status} error=${neg.json?.error}`);
const zero = await play({ bets: { red: 0 }, idempotencyKey: kkey('zero') });
check('塞 0 注额 → 400', zero.status === 400);

// 5. 防假 key
console.log('\n== 防假 key ==');
const badN = await play({ bets: { n99: 10 }, idempotencyKey: kkey('bn') });
check('非法单号 {n99} → 400', badN.status === 400, `HTTP ${badN.status}`);
const badKey = await play({ bets: { foo: 10 }, idempotencyKey: kkey('bk') });
check('非法 key {foo} → 400', badKey.status === 400);
// key 数量上限
const tooMany = {}; for (let i = 0; i < 30; i++) tooMany[`n${(i % 12) + 1}`] = 1; // 但重复 key 会被对象去重…改用不同：混合
const many = {}; for (let i = 1; i <= 12; i++) many[`n${i}`] = 1; ['red', 'black', 'odd', 'even', 'low', 'high'].forEach(k => many[k] = 1); // 18 个，合法
const okMany = await play({ bets: many, idempotencyKey: kkey('many') });
check('18 个合法 key（≤22）正常', okMany.status === 200, `HTTP ${okMany.status}`);

// 6. 可复算：库内 server_seed 本地 spinRoulette 重算 == 响应 n
console.log('\n== 可复算 ==');
const row = await dbSeed(r1.json.roundId);
const recalcN = spinRoulette(row.server_seed, r1.json.clientSeed, r1.json.nonce);
check('本地 spinRoulette == 响应落号 n', recalcN === r1.json.n, `recalc=${recalcN} resp=${r1.json.n}`);

// 7. 防作弊：塞假 payout/mult/n
console.log('\n== 防作弊 ==');
const cheat = await play({ bets: { red: 10 }, n: 8, perKeyPayout: { red: 99999 }, totalPayout: 99999, idempotencyKey: kkey('cheat') });
const trueRow = await dbSeed(cheat.json.roundId);
const trueN = spinRoulette(trueRow.server_seed, cheat.json.clientSeed, cheat.json.nonce);
check('前端塞假 n/payout 被忽略，服务端自算', cheat.json.n === trueN && Number(cheat.json.totalPayout) !== 99999, `serverN=${cheat.json.n} total=${cheat.json.totalPayout}`);

// 8. nonce 递增
console.log('\n== nonce ==');
const seq = [];
for (let i = 0; i < 3; i++) { const r = await play({ bets: { red: 1 }, idempotencyKey: kkey('seq') }); seq.push(r.json.nonce); }
check('连打 3 注 nonce 递增', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(',')}]`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
