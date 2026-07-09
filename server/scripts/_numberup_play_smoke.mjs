// NumberUp /numberup/play 端到端（脚手架红利，验 NumberUp 特化）：多注/部分赢/可复算/风控/防负注/防假key/防作弊/nonce/无明文。
import { pool, query } from '../src/db.js';
import { drawNumber, deriveNum, hitsOf, MARKETS } from '../src/game/numberUp.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `nu-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: process.env.ALICE_PW, type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (body) => {
  const r = await fetch(`${BASE}/round/numberup/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbSeed = async (id) => (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [id])).rows[0];

// 1. 正常多注（押号 + 首位 + 大小）+ 无明文
console.log('== 正常多注 ==');
const r1 = await play({ bets: { 'n-27': 10, 'fd-2': 5, 's-high': 8 }, idempotencyKey: kkey('n') });
check('numberup 多注 200', r1.status === 200, `HTTP ${r1.status}`);
check('响应有 drawResult.num(0-49)/perKeyOutcome/serverSeedHash/nonce/balanceAfter', Number.isInteger(r1.json.drawResult?.num) && r1.json.drawResult.num >= 0 && r1.json.drawResult.num <= 49 && typeof r1.json.perKeyOutcome === 'object' && r1.json.serverSeedHash?.length === 64 && Number.isInteger(r1.json.nonce) && r1.json.balanceAfter != null, `num=${r1.json.drawResult?.num} outcome=${JSON.stringify(r1.json.perKeyOutcome)} bal=${r1.json.balanceAfter}`);
check('响应【无】serverSeed 明文', !('serverSeed' in r1.json));

// 逐 key 三态本地按落号重算 == 响应
{
  const num = r1.json.drawResult.num;
  const h = hitsOf(deriveNum(num));
  const stake = { 'n-27': 10, 'fd-2': 5, 's-high': 8 };
  const exp = {};
  for (const [k, a] of Object.entries(stake)) exp[k] = h.has(k) ? { outcome: 'hit', payout: Math.round(a * MARKETS[k].odds * 100) / 100 } : { outcome: 'lose', payout: 0 };
  check('逐 key 三态(hit/lose) == 本地按落号重算', JSON.stringify(r1.json.perKeyOutcome) === JSON.stringify(exp), `落号${num} outcome=${JSON.stringify(r1.json.perKeyOutcome)}`);
}

// 2. 部分赢：押 n-27 + s-high，本地枚举找一个落号=27 的种子较难；改验统计——押互补两侧必中其一
console.log('\n== 部分赢（大小互补必中其一）==');
const r2 = await play({ bets: { 's-high': 10, 's-low': 10 }, idempotencyKey: kkey('side') });
const hi = r2.json.perKeyOutcome['s-high'].outcome === 'hit', lo = r2.json.perKeyOutcome['s-low'].outcome === 'hit';
check('大小必中且仅中其一（部分赢）', hi !== lo, `high=${r2.json.perKeyOutcome['s-high'].outcome} low=${r2.json.perKeyOutcome['s-low'].outcome} num=${r2.json.drawResult.num}`);
// 命中侧派息 = 10×1.91，未中侧 0；总派息 = 19.10
check('部分赢总派息 = 命中侧 10×1.91 = 19.10', Number(r2.json.totalPayout) === 19.1, `total=${r2.json.totalPayout}`);

// 3. 可复算：库内 server_seed 造 rng 重算 drawNumber == 响应 num
console.log('\n== 可复算 ==');
const row = await dbSeed(r1.json.roundId);
const recalcNum = drawNumber(makeSeededRng(row.server_seed, r1.json.clientSeed, r1.json.nonce));
check('本地 seededRng+drawNumber == 响应落号 num', recalcNum === r1.json.drawResult.num, `recalc=${recalcNum} resp=${r1.json.drawResult.num}`);

// 4. 总额风控 Σ>100
console.log('\n== 总额风控 ==');
const over = await play({ bets: { 's-high': 60, 's-low': 60 }, idempotencyKey: kkey('over') });
check('Σ注额 120 > maxBet100 → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `${over.status}/${over.code}`);

// 5. 防负注 + 防假 key（n-99 超 49）
console.log('\n== 防负注 + 防假 key ==');
const neg = await play({ bets: { 'n-05': -50, 's-high': 10 }, idempotencyKey: kkey('neg') });
check('负注额 {n-05:-50} → 400', neg.status === 400, `${neg.status} ${neg.json?.error}`);
const badKey = await play({ bets: { 'n-99': 10 }, idempotencyKey: kkey('bk') });
check('非法 key {n-99}（超 49）→ 400', badKey.status === 400, `${badKey.status} ${badKey.json?.error}`);
const badKey2 = await play({ bets: { 'fd-9': 10 }, idempotencyKey: kkey('bk2') });
check('非法 key {fd-9}（首位仅 0-4）→ 400', badKey2.status === 400, `${badKey2.status}`);

// 6. 防作弊：塞假 num/payout → 服务端覆盖
console.log('\n== 防作弊 ==');
const cheat = await play({ bets: { 'n-01': 10 }, drawResult: { num: 1 }, perKeyOutcome: { 'n-01': { outcome: 'hit', payout: 99999 } }, totalPayout: 99999, idempotencyKey: kkey('cheat') });
const trueRow = await dbSeed(cheat.json.roundId);
const trueNum = drawNumber(makeSeededRng(trueRow.server_seed, cheat.json.clientSeed, cheat.json.nonce));
check('前端塞假 num/payout 被忽略，服务端自算', cheat.json.drawResult.num === trueNum && Number(cheat.json.totalPayout) !== 99999, `serverNum=${cheat.json.drawResult.num} total=${cheat.json.totalPayout}`);

// 7. nonce 递增
console.log('\n== nonce ==');
const seq = [];
for (let i = 0; i < 3; i++) { const r = await play({ bets: { 's-high': 1 }, idempotencyKey: kkey('seq') }); seq.push(r.json.nonce); }
check('连打 3 注 nonce 递增', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(',')}]`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
