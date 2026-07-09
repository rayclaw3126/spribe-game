// GoldenBoot /goldenboot/play 端到端（脚手架红利，验 GoldenBoot 特化）：多注/部分赢/可复算/冠亚和命中/风控/防负注/防假key/防作弊/nonce/无明文。
import { pool, query } from '../src/db.js';
import { drawRace, deriveRace, hitsOf, MARKETS, ODDS } from '../src/game/goldenBoot.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `gb-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: process.env.ALICE_PW, type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (body) => {
  const r = await fetch(`${BASE}/round/goldenboot/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbSeed = async (id) => (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [id])).rows[0];
const localOutcome = (ranking, stake) => {
  const r = deriveRace(ranking);
  const h = hitsOf(r);
  const exp = {};
  for (const [k, a] of Object.entries(stake)) exp[k] = h.has(k) ? { outcome: 'hit', payout: Math.round(a * MARKETS[k].odds * 100) / 100 } : { outcome: 'lose', payout: 0 };
  return exp;
};

// 1. 正常多注（冠军 + 冠亚和 + 大小）+ 无明文
console.log('== 正常多注 ==');
const stake1 = { 'w-3': 10, 'sum-11': 5, 's-big': 5 };
const r1 = await play({ bets: stake1, idempotencyKey: kkey('n') });
check('goldenboot 多注 200', r1.status === 200, `HTTP ${r1.status}`);
check('响应有 drawResult.ranking[10]/champion/sprintSum/perKeyOutcome/serverSeedHash/nonce/balanceAfter',
  Array.isArray(r1.json.drawResult?.ranking) && r1.json.drawResult.ranking.length === 10 &&
  new Set(r1.json.drawResult.ranking).size === 10 &&
  r1.json.drawResult.champion === r1.json.drawResult.ranking[0] &&
  r1.json.drawResult.sprintSum === r1.json.drawResult.ranking[0] + r1.json.drawResult.ranking[1] &&
  typeof r1.json.perKeyOutcome === 'object' && r1.json.serverSeedHash?.length === 64 && Number.isInteger(r1.json.nonce) && r1.json.balanceAfter != null,
  `ranking=${r1.json.drawResult?.ranking} sum=${r1.json.drawResult?.sprintSum}`);
check('响应【无】serverSeed 明文', !('serverSeed' in r1.json));
check('逐 key 三态(hit/lose) == 本地按 ranking 重算', JSON.stringify(r1.json.perKeyOutcome) === JSON.stringify(localOutcome(r1.json.drawResult.ranking, stake1)), `ranking=${r1.json.drawResult.ranking} outcome=${JSON.stringify(r1.json.perKeyOutcome)}`);

// 2. 可复算：库内 server_seed 造 rng 重算洗牌 == 响应 ranking
console.log('\n== 可复算 ==');
const row = await dbSeed(r1.json.roundId);
const recalcRank = drawRace(makeSeededRng(row.server_seed, r1.json.clientSeed, r1.json.nonce));
check('本地 seededRng+drawRace == 响应 ranking', JSON.stringify(recalcRank) === JSON.stringify(r1.json.drawResult.ranking), `recalc=${recalcRank} resp=${r1.json.drawResult.ranking}`);

// 3. 部分赢：押互补 s-big + s-small（必中其一）
console.log('\n== 部分赢（大小互补必中其一）==');
const r3 = await play({ bets: { 's-big': 10, 's-small': 10 }, idempotencyKey: kkey('side') });
const bigHit = r3.json.perKeyOutcome['s-big'].outcome === 'hit', smallHit = r3.json.perKeyOutcome['s-small'].outcome === 'hit';
check('大小必中且仅中其一（部分赢）', bigHit !== smallHit, `big=${r3.json.perKeyOutcome['s-big'].outcome} small=${r3.json.perKeyOutcome['s-small'].outcome} sum=${r3.json.drawResult.sprintSum}`);
const sideOdds = bigHit ? ODDS.big : ODDS.small;
check('部分赢总派息 = 命中侧 10×赔率', Number(r3.json.totalPayout) === Math.round(10 * sideOdds * 100) / 100, `total=${r3.json.totalPayout} 期望=${10 * sideOdds}`);

// 4. 冠亚和命中：循环开到某局，押其冠亚和 sum-N 确认命中该档赔率（先探一局拿 sum，再针对性下注同不了，改验：多注全押 17 档冠亚和，凑到命中一次）
console.log('\n== 冠亚和命中（循环凑一档命中，验赔率）==');
let sumWin = null, tries = 0;
for (; tries < 200 && !sumWin; tries++) {
  const r = await play({ bets: { 'sum-11': 5 }, idempotencyKey: kkey('sum') });
  if (r.json.perKeyOutcome['sum-11'].outcome === 'hit') sumWin = r;
}
if (sumWin) {
  const oc = sumWin.json.perKeyOutcome['sum-11'];
  check(`冠亚和 sum-11 命中（冠亚和=${sumWin.json.drawResult.sprintSum}）→ 派息 5×${ODDS.sum[11]}`, sumWin.json.drawResult.sprintSum === 11 && oc.payout === Math.round(5 * ODDS.sum[11] * 100) / 100, `sum=${sumWin.json.drawResult.sprintSum} payout=${oc.payout}`);
  console.log(`  （${tries} 次凑到冠亚和=11）`);
} else {
  check('冠亚和命中（200 次未凑到 sum=11，跳过）', false, '异常：P=10/90≈11% 应命中');
}

// 5. 总额风控 Σ>100
console.log('\n== 总额风控 ==');
const over = await play({ bets: { 's-big': 60, 's-small': 60 }, idempotencyKey: kkey('over') });
check('Σ注额 120 > maxBet100 → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `${over.status}/${over.code}`);

// 6. 防负注 + 防假 key（w-99 超冠军 1-10 / sum-99 超冠亚和 3-19）
console.log('\n== 防负注 + 防假 key ==');
const neg = await play({ bets: { 'w-1': -50, 's-big': 10 }, idempotencyKey: kkey('neg') });
check('负注额 {w-1:-50} → 400', neg.status === 400, `${neg.status} ${neg.json?.error}`);
const badKey = await play({ bets: { 'w-99': 10 }, idempotencyKey: kkey('bk') });
check('非法 key {w-99}（冠军仅 1-10）→ 400', badKey.status === 400, `${badKey.status} ${badKey.json?.error}`);
const badKey2 = await play({ bets: { 'sum-99': 10 }, idempotencyKey: kkey('bk2') });
check('非法 key {sum-99}（冠亚和仅 3-19）→ 400', badKey2.status === 400, `${badKey2.status}`);
const badKey3 = await play({ bets: { 'sum-2': 10 }, idempotencyKey: kkey('bk3') });
check('非法 key {sum-2}（冠亚和最小 3）→ 400', badKey3.status === 400, `${badKey3.status}`);

// 7. 防作弊：塞假 ranking/payout → 服务端覆盖
console.log('\n== 防作弊 ==');
const cheat = await play({ bets: { 'w-1': 10 }, drawResult: { ranking: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], champion: 1, sprintSum: 3 }, perKeyOutcome: { 'w-1': { outcome: 'hit', payout: 99999 } }, totalPayout: 99999, idempotencyKey: kkey('cheat') });
const trueRow = await dbSeed(cheat.json.roundId);
const trueRank = drawRace(makeSeededRng(trueRow.server_seed, cheat.json.clientSeed, cheat.json.nonce));
check('前端塞假 ranking/payout 被忽略，服务端自算', JSON.stringify(cheat.json.drawResult.ranking) === JSON.stringify(trueRank) && Number(cheat.json.totalPayout) !== 99999, `serverRank=${cheat.json.drawResult.ranking} total=${cheat.json.totalPayout}`);

// 8. nonce 递增
console.log('\n== nonce ==');
const seq = [];
for (let i = 0; i < 3; i++) { const r = await play({ bets: { 's-big': 1 }, idempotencyKey: kkey('seq') }); seq.push(r.json.nonce); }
check('连打 3 注 nonce 递增', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(',')}]`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
