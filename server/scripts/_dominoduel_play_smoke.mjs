// DominoDuel /dominoduel/play 端到端（波胆+push 重点）：正常/可复算/⭐波胆命中(高赔派息)/⭐push复用(退注账)/混合三态/风控/防负注/防假key/防作弊/nonce/无明文。
import { pool, query } from '../src/db.js';
import { rollTiles, deriveRound, hitsOf, pushesOf, MARKETS, ODDS } from '../src/game/dominoDuel.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `dom-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const round2 = (x) => Math.round(x * 100) / 100;

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: process.env.ALICE_PW, type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (body) => {
  const r = await fetch(`${BASE}/round/dominoduel/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbSeed = async (id) => (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [id])).rows[0];
const balOf = async () => Number((await query("SELECT balance FROM wallets WHERE player_id=(SELECT id FROM players WHERE username='alice')")).rows[0].balance);

// 1. 正常多注（主客 + 大小 + 波胆）+ 无明文
console.log('== 正常多注 ==');
const stake1 = { 'home-win': 10, 'g-big': 5, 'cs-1-0': 5 };
const r1 = await play({ bets: stake1, idempotencyKey: kkey('n') });
check('dominoduel 多注 200', r1.status === 200, `HTTP ${r1.status}`);
check('响应有 drawResult.tiles[4]/hs/as/gTotal/perKeyOutcome/serverSeedHash/nonce/balanceAfter',
  Array.isArray(r1.json.drawResult?.tiles) && r1.json.drawResult.tiles.length === 4 &&
  r1.json.drawResult.hs >= 0 && r1.json.drawResult.hs <= 9 && r1.json.drawResult.as >= 0 && r1.json.drawResult.as <= 9 &&
  r1.json.drawResult.gTotal === r1.json.drawResult.hs + r1.json.drawResult.as &&
  typeof r1.json.perKeyOutcome === 'object' && r1.json.serverSeedHash?.length === 64 && Number.isInteger(r1.json.nonce) && r1.json.balanceAfter != null,
  `hs=${r1.json.drawResult?.hs} as=${r1.json.drawResult?.as}`);
check('响应【无】serverSeed 明文', !('serverSeed' in r1.json));
{
  const r = deriveRound(r1.json.drawResult.tiles);
  const h = hitsOf(r), p = pushesOf(r);
  const exp = {};
  for (const [k, a] of Object.entries(stake1)) exp[k] = h.has(k) ? { outcome: 'hit', payout: round2(a * MARKETS[k].odds) } : (p.has(k) ? { outcome: 'push', payout: a } : { outcome: 'lose', payout: 0 });
  check('逐 key 三态(hit/push/lose) == 本地按 tiles 重算', JSON.stringify(r1.json.perKeyOutcome) === JSON.stringify(exp), `hs-as=${r.hs}-${r.as} outcome=${JSON.stringify(r1.json.perKeyOutcome)}`);
}

// 2. 可复算
console.log('\n== 可复算 ==');
const row = await dbSeed(r1.json.roundId);
const recalc = rollTiles(makeSeededRng(row.server_seed, r1.json.clientSeed, r1.json.nonce));
check('本地 seededRng+rollTiles == 响应 tiles', JSON.stringify(recalc) === JSON.stringify(r1.json.drawResult.tiles), `recalc=${JSON.stringify(recalc)} resp=${JSON.stringify(r1.json.drawResult.tiles)}`);

// 3. ⭐ 波胆命中：循环凑一局开出 hs-as=1-0（押 cs-1-0），验高赔派息 94.69×
console.log('\n== ⭐ 波胆命中（凑 hs-as=1-0，验高赔派息）==');
let csWin = null, csTries = 0;
for (; csTries < 3000 && !csWin; csTries++) {
  const r = await play({ bets: { 'cs-1-0': 5 }, idempotencyKey: kkey('cs') });
  if (r.json.drawResult.hs === 1 && r.json.drawResult.as === 0) csWin = r;
}
if (csWin) {
  const oc = csWin.json.perKeyOutcome['cs-1-0'];
  check(`波胆 cs-1-0 命中（hs-as=1-0）→ outcome=hit、payout=5×${ODDS ? 94.69 : ''}=${round2(5 * 94.69)}（高赔）`, oc.outcome === 'hit' && oc.payout === round2(5 * MARKETS['cs-1-0'].odds), `${JSON.stringify(oc)} odds=${MARKETS['cs-1-0'].odds}`);
  check('波胆命中 totalPayout = 5×94.69 = 473.45', Number(csWin.json.totalPayout) === round2(5 * 94.69), `totalPayout=${csWin.json.totalPayout}`);
  console.log(`  （${csTries} 次凑到 hs-as=1-0）`);
} else { check('波胆命中（3000 次未凑到 1-0，跳过）', false, '异常：P≈0.01 应命中'); }

// 4. ⭐ push 复用（吃 DerbyDay 已验路径）：凑一局平局 hs==as，押 home-win/away-win 都 push 退本金 + 混合三态 + 余额账
console.log('\n== ⭐ push 复用（凑平局，退注账 + 混合三态）==');
let running = await balOf();
let tieRound = null, tieTries = 0;
for (; tieTries < 500 && !tieRound; tieTries++) {
  const before = running;
  const r = await play({ bets: { 'home-win': 10, 'away-win': 10, 'g-big': 5 }, idempotencyKey: kkey('tie') });
  running = Number(r.json.balanceAfter);
  if (r.json.drawResult.hs === r.json.drawResult.as) tieRound = { r, before };
}
if (tieRound) {
  const { r, before } = tieRound;
  const d = r.json.drawResult, oc = r.json.perKeyOutcome;
  check(`平局(hs=${d.hs}==as=${d.as})：home-win/away-win 都 push、payout=10（退本金）`, oc['home-win'].outcome === 'push' && oc['home-win'].payout === 10 && oc['away-win'].outcome === 'push' && oc['away-win'].payout === 10);
  // g-big hit/lose（混合三态：push + hit/lose）
  const gBigHit = d.gTotal >= 9;
  check(`混合三态：g-big ${gBigHit ? 'hit' : 'lose'}（+ home/away push 退注）三态齐`, gBigHit ? (oc['g-big'].outcome === 'hit' && oc['g-big'].payout === round2(5 * ODDS.gBig)) : oc['g-big'].outcome === 'lose');
  const expTotal = round2(10 + 10 + (gBigHit ? 5 * ODDS.gBig : 0));   // 两 push 退 20 + g-big
  check(`push 局 totalPayout=${expTotal} 含退本金 20（>0 走 credit）`, Number(r.json.totalPayout) === expTotal, `totalPayout=${r.json.totalPayout}`);
  // ⭐ 余额账：balanceAfter = before − 总注25 + totalPayout；两 push 退 20 令 home/away 净 0
  check(`⭐ 余额账：balanceAfter=${r.json.balanceAfter} == before(${before}) − 25 + totalPayout(${expTotal}) = ${round2(before - 25 + expTotal)}`, Number(r.json.balanceAfter) === round2(before - 25 + expTotal));
  check('push=不赢不输：home-win/away-win 各扣 10 退 10 净 0', oc['home-win'].payout - 10 === 0 && oc['away-win'].payout - 10 === 0);
  console.log(`  （${tieTries} 次凑到平局 hs=as=${d.hs}；账：${before} − 25 + ${expTotal} = ${r.json.balanceAfter}）`);
} else { check('push 复用（500 次未凑到平局，跳过）', false, '异常：P≈0.102 应命中'); }

// 5. 风控 + 防负注 + 防假 key
console.log('\n== 风控 + 防负注 + 防假 key ==');
const over = await play({ bets: { 'home-win': 60, 'away-win': 60 }, idempotencyKey: kkey('over') });
check('Σ注额 120 > maxBet100 → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `${over.status}/${over.code}`);
const neg = await play({ bets: { 'home-win': -50, 'away-win': 10 }, idempotencyKey: kkey('neg') });
check('负注额 {home-win:-50} → 400', neg.status === 400, `${neg.status} ${neg.json?.error}`);
const badKey = await play({ bets: { 'cs-5-5': 10 }, idempotencyKey: kkey('bk') });
check('非法 key {cs-5-5}（波胆只 9 个热门比分）→ 400', badKey.status === 400, `${badKey.status} ${badKey.json?.error}`);
const badKey2 = await play({ bets: { 'tie': 10 }, idempotencyKey: kkey('bk2') });
check('非法 key {tie}（胜负只 home-win/draw/away-win）→ 400', badKey2.status === 400, `${badKey2.status}`);

// 6. 防作弊：塞假 tiles/hs/as/payout → 服务端覆盖
console.log('\n== 防作弊 ==');
const cheat = await play({ bets: { 'cs-0-0': 10 }, drawResult: { tiles: [[0, 0], [0, 0], [0, 0], [0, 0]], hs: 0, as: 0, gTotal: 0 }, perKeyOutcome: { 'cs-0-0': { outcome: 'hit', payout: 99999 } }, totalPayout: 99999, idempotencyKey: kkey('cheat') });
const trueRow = await dbSeed(cheat.json.roundId);
const trueTiles = rollTiles(makeSeededRng(trueRow.server_seed, cheat.json.clientSeed, cheat.json.nonce));
check('前端塞假 tiles/hs/as/payout 被忽略，服务端自算', JSON.stringify(cheat.json.drawResult.tiles) === JSON.stringify(trueTiles) && Number(cheat.json.totalPayout) !== 99999, `serverHs=${cheat.json.drawResult.hs} total=${cheat.json.totalPayout}`);

// 7. nonce 递增
console.log('\n== nonce ==');
const seq = [];
for (let i = 0; i < 3; i++) { const r = await play({ bets: { 'home-win': 1 }, idempotencyKey: kkey('seq') }); seq.push(r.json.nonce); }
check('连打 3 注 nonce 递增', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(',')}]`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
