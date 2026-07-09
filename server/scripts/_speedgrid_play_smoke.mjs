// SpeedGrid /speedgrid/play 端到端（通用轮次 handler 首验）：正常多注/部分赢/两态/风控/防负注/防假key/可复算/防作弊/nonce/无明文。
import { pool, query } from '../src/db.js';
import { drawCar, hitsOf, MARKETS } from '../src/game/speedGrid.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `sg-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (body) => {
  const r = await fetch(`${BASE}/round/speedgrid/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbSeed = async (id) => (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [id])).rows[0];

// 1. 正常多注 + 无明文
console.log('== 正常多注 ==');
const r1 = await play({ bets: { big: 10, small: 10, 'car-8': 5 }, idempotencyKey: kkey('n') });
check('speedgrid 多注 200', r1.status === 200, `HTTP ${r1.status}`);
check('响应有 drawResult.n/perKeyOutcome/totalPayout/serverSeedHash/nonce', Number.isInteger(r1.json.drawResult?.n) && r1.json.drawResult.n >= 1 && r1.json.drawResult.n <= 24 && typeof r1.json.perKeyOutcome === 'object' && r1.json.serverSeedHash?.length === 64 && Number.isInteger(r1.json.nonce), `n=${r1.json.drawResult?.n} outcome=${JSON.stringify(r1.json.perKeyOutcome)}`);
check('响应【无】serverSeed 明文', !('serverSeed' in r1.json));

// 逐 key 三态本地重算 == 响应
{
  const n = r1.json.drawResult.n;
  const h = hitsOf(n);
  const exp = {};
  for (const [k, a] of Object.entries({ big: 10, small: 10, 'car-8': 5 })) {
    if (h.has(k)) exp[k] = { outcome: 'hit', payout: Math.round(a * MARKETS[k].odds * 100) / 100 };
    else exp[k] = { outcome: 'lose', payout: 0 };
  }
  check('逐 key 三态(hit/lose) == 本地按落号重算', JSON.stringify(r1.json.perKeyOutcome) === JSON.stringify(exp), `落号${n} outcome=${JSON.stringify(r1.json.perKeyOutcome)}`);
  // 大小必中其一（互补），部分赢
  const bigWon = r1.json.perKeyOutcome.big.outcome === 'hit', smallWon = r1.json.perKeyOutcome.small.outcome === 'hit';
  check('大小必中且仅中其一（部分赢）', bigWon !== smallWon, `big=${r1.json.perKeyOutcome.big.outcome} small=${r1.json.perKeyOutcome.small.outcome}`);
}

// 2. 总额风控
console.log('\n== 总额风控 ==');
const over = await play({ bets: { big: 60, small: 60 }, idempotencyKey: kkey('over') });
check('Σ注额 120 > maxBet100 → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `${over.status}/${over.code}`);

// 3. 防负注额 + 防假 key
console.log('\n== 防负注额 + 防假 key ==');
const neg = await play({ bets: { big: -50, small: 10 }, idempotencyKey: kkey('neg') });
check('负注额 {big:-50} → 400', neg.status === 400, `${neg.status} ${neg.json?.error}`);
const zero = await play({ bets: { big: 0 }, idempotencyKey: kkey('z') });
check('0 注额 → 400', zero.status === 400);
const badKey = await play({ bets: { 'car-99': 10 }, idempotencyKey: kkey('bk') });
check('非法 key {car-99} → 400', badKey.status === 400);
const badKey2 = await play({ bets: { foo: 10 }, idempotencyKey: kkey('bk2') });
check('非法 key {foo} → 400', badKey2.status === 400);

// 4. 可复算：库内 server_seed 造 rng 重算 drawCar == 响应
console.log('\n== 可复算 ==');
const row = await dbSeed(r1.json.roundId);
const recalcN = drawCar(makeSeededRng(row.server_seed, r1.json.clientSeed, r1.json.nonce));
check('本地 seededRng+drawCar == 响应落号 n', recalcN === r1.json.drawResult.n, `recalc=${recalcN} resp=${r1.json.drawResult.n}`);

// 5. 防作弊：塞假 drawResult/payout
console.log('\n== 防作弊 ==');
const cheat = await play({ bets: { 'car-1': 10 }, drawResult: { n: 1 }, perKeyOutcome: { 'car-1': { outcome: 'hit', payout: 99999 } }, totalPayout: 99999, idempotencyKey: kkey('cheat') });
const trueRow = await dbSeed(cheat.json.roundId);
const trueN = drawCar(makeSeededRng(trueRow.server_seed, cheat.json.clientSeed, cheat.json.nonce));
check('前端塞假 drawResult/payout 被忽略，服务端自算', cheat.json.drawResult.n === trueN && Number(cheat.json.totalPayout) !== 99999, `serverN=${cheat.json.drawResult.n} total=${cheat.json.totalPayout}`);

// 6. nonce 递增
console.log('\n== nonce ==');
const seq = [];
for (let i = 0; i < 3; i++) { const r = await play({ bets: { big: 1 }, idempotencyKey: kkey('seq') }); seq.push(r.json.nonce); }
check('连打 3 注 nonce 递增', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(',')}]`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
