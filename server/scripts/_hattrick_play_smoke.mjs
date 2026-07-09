// HatTrick /hattrick/play 端到端（脚手架红利，验 HatTrick 特化）：多注/豹子void/部分赢/可复算/风控/防负注/防假key/防作弊/顶赔钳制/nonce/无明文。
import { pool, query } from '../src/db.js';
import { rollDice, deriveRoll, hitsOf, MARKETS, ODDS } from '../src/game/hatTrick.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `ht-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: process.env.ALICE_PW, type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (body) => {
  const r = await fetch(`${BASE}/round/hattrick/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbSeed = async (id) => (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [id])).rows[0];
const localOutcome = (dice, stake) => {
  const r = deriveRoll(dice);
  const h = hitsOf(r);
  const exp = {};
  for (const [k, a] of Object.entries(stake)) exp[k] = h.has(k) ? { outcome: 'hit', payout: Math.round(a * MARKETS[k].odds * 100) / 100 } : { outcome: 'lose', payout: 0 };
  return exp;
};

// 1. 正常多注（和值 + 侧注 + 对子）+ 无明文
console.log('== 正常多注 ==');
const stake1 = { 't-9': 10, 's-big': 5, 'd-3': 5 };
const r1 = await play({ bets: stake1, idempotencyKey: kkey('n') });
check('hattrick 多注 200', r1.status === 200, `HTTP ${r1.status}`);
check('响应有 drawResult.dice[3]/sum/perKeyOutcome/serverSeedHash/nonce/balanceAfter',
  Array.isArray(r1.json.drawResult?.dice) && r1.json.drawResult.dice.length === 3 && r1.json.drawResult.dice.every((d) => d >= 1 && d <= 6) &&
  r1.json.drawResult.sum === r1.json.drawResult.dice.reduce((a, b) => a + b, 0) &&
  typeof r1.json.perKeyOutcome === 'object' && r1.json.serverSeedHash?.length === 64 && Number.isInteger(r1.json.nonce) && r1.json.balanceAfter != null,
  `dice=${r1.json.drawResult?.dice} sum=${r1.json.drawResult?.sum} outcome=${JSON.stringify(r1.json.perKeyOutcome)}`);
check('响应【无】serverSeed 明文', !('serverSeed' in r1.json));
check('逐 key 三态(hit/lose) == 本地按 dice 重算', JSON.stringify(r1.json.perKeyOutcome) === JSON.stringify(localOutcome(r1.json.drawResult.dice, stake1)), `dice=${r1.json.drawResult.dice} outcome=${JSON.stringify(r1.json.perKeyOutcome)}`);

// 2. 可复算：库内 server_seed 造 rng 重算 3 骰 == 响应 dice
console.log('\n== 可复算 ==');
const row = await dbSeed(r1.json.roundId);
const recalcDice = rollDice(makeSeededRng(row.server_seed, r1.json.clientSeed, r1.json.nonce));
check('本地 seededRng+rollDice == 响应 dice', JSON.stringify(recalcDice) === JSON.stringify(r1.json.drawResult.dice), `recalc=${recalcDice} resp=${r1.json.drawResult.dice}`);

// 3. 豹子 void 边界（埋尸点）：循环开到一局豹子，确认大小单双判输不退 + tr-any/指定豹命中
console.log('\n== 豹子 void 边界（循环凑豹子）==');
let tripleRound = null, tries = 0;
for (; tries < 300 && !tripleRound; tries++) {
  const r = await play({ bets: { 's-big': 1, 's-small': 1, 's-odd': 1, 's-even': 1, 'tr-any': 1 }, idempotencyKey: kkey('tri') });
  const d = r.json.drawResult.dice;
  if (d[0] === d[1] && d[1] === d[2]) tripleRound = r;
}
if (tripleRound) {
  const d = tripleRound.json.drawResult.dice;
  const oc = tripleRound.json.perKeyOutcome;
  const sidesLose = ['s-big', 's-small', 's-odd', 's-even'].every((k) => oc[k].outcome === 'lose' && oc[k].payout === 0);
  check(`豹子 [${d}] 大小单双四侧全 lose（判输不退，非 push）`, sidesLose, `sides=${JSON.stringify({ big: oc['s-big'].outcome, small: oc['s-small'].outcome, odd: oc['s-odd'].outcome, even: oc['s-even'].outcome })}`);
  check('豹子局 tr-any 命中', oc['tr-any'].outcome === 'hit' && oc['tr-any'].payout === ODDS.anyTriple, `tr-any=${JSON.stringify(oc['tr-any'])}`);
  check('豹子局响应无 push 字段/退注（三态里无 push）', !JSON.stringify(oc).includes('push'));
  console.log(`  （${tries} 次凑到豹子 [${d}]）`);
} else {
  check('豹子 void 边界（300 次未凑到豹子，跳过）', false, '异常：概率上应命中');
}

// 4. 部分赢：押互补 s-big + s-small（非豹必中其一），确认部分赢
console.log('\n== 部分赢（大小互补，非豹必中其一）==');
let partial = null;
for (let i = 0; i < 20 && !partial; i++) {
  const r = await play({ bets: { 's-big': 10, 's-small': 10 }, idempotencyKey: kkey('part') });
  const d = r.json.drawResult.dice;
  if (!(d[0] === d[1] && d[1] === d[2])) partial = r;   // 取一局非豹
}
{
  const oc = partial.json.perKeyOutcome;
  const bigHit = oc['s-big'].outcome === 'hit', smallHit = oc['s-small'].outcome === 'hit';
  check('非豹局大小必中且仅中其一（部分赢）', bigHit !== smallHit, `big=${oc['s-big'].outcome} small=${oc['s-small'].outcome} sum=${partial.json.drawResult.sum}`);
  check('部分赢总派息 = 命中侧 10×1.96 = 19.60', Number(partial.json.totalPayout) === 19.6, `total=${partial.json.totalPayout}`);
}

// 5. 总额风控 Σ>100
console.log('\n== 总额风控 ==');
const over = await play({ bets: { 's-big': 60, 's-small': 60 }, idempotencyKey: kkey('over') });
check('Σ注额 120 > maxBet100 → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `${over.status}/${over.code}`);

// 6. 防负注 + 防假 key（t-99 超和值 4-17）
console.log('\n== 防负注 + 防假 key ==');
const neg = await play({ bets: { 't-9': -50, 's-big': 10 }, idempotencyKey: kkey('neg') });
check('负注额 {t-9:-50} → 400', neg.status === 400, `${neg.status} ${neg.json?.error}`);
const badKey = await play({ bets: { 't-99': 10 }, idempotencyKey: kkey('bk') });
check('非法 key {t-99}（和值仅 4-17）→ 400', badKey.status === 400, `${badKey.status} ${badKey.json?.error}`);
const badKey2 = await play({ bets: { 'tr-9': 10 }, idempotencyKey: kkey('bk2') });
check('非法 key {tr-9}（指定豹仅 1-6）→ 400', badKey2.status === 400, `${badKey2.status}`);

// 7. 防作弊：塞假 dice/payout → 服务端覆盖
console.log('\n== 防作弊 ==');
const cheat = await play({ bets: { 'tr-5': 10 }, drawResult: { dice: [5, 5, 5], sum: 15 }, perKeyOutcome: { 'tr-5': { outcome: 'hit', payout: 99999 } }, totalPayout: 99999, idempotencyKey: kkey('cheat') });
const trueRow = await dbSeed(cheat.json.roundId);
const trueDice = rollDice(makeSeededRng(trueRow.server_seed, cheat.json.clientSeed, cheat.json.nonce));
check('前端塞假 dice/payout 被忽略，服务端自算', JSON.stringify(cheat.json.drawResult.dice) === JSON.stringify(trueDice) && Number(cheat.json.totalPayout) !== 99999, `serverDice=${cheat.json.drawResult.dice} total=${cheat.json.totalPayout}`);

// 8. 顶赔钳制 sanity：单市场顶赔 = 指定豹 206.28×maxBet100 = 20628 < cap 50000
console.log('\n== 顶赔钳制 sanity ==');
const maxSingle = ODDS.triple * 100;
check('单市场顶赔 206.28×100=20628 < cap 50000（钳制不触发）', maxSingle < 50000, `maxSingle=${maxSingle}`);
// Σstake≤100 下最大派息 = 全押最高赔市场（指定豹）→ 20628；分散只会更低（高赔集中占优）→ cap 分支纯兜底
check('Σstake≤maxBet 下最大可能派息 ≤ 单市场顶赔 20628 < 50000（多注无法超 cap，钳制留作兜底）', maxSingle < 50000);

// 9. nonce 递增
console.log('\n== nonce ==');
const seq = [];
for (let i = 0; i < 3; i++) { const r = await play({ bets: { 's-big': 1 }, idempotencyKey: kkey('seq') }); seq.push(r.json.nonce); }
check('连打 3 注 nonce 递增', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(',')}]`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
