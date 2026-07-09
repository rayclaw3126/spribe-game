// HalfTime /halftime/play 端到端（脚手架红利，验 HalfTime 特化）：多注/部分赢/可复算/五行带/draw市场/风控/防负注/防假key/防作弊/nonce/无明文。
import { pool, query } from '../src/db.js';
import { drawRound, deriveRound, hitsOf, MARKETS, ODDS } from '../src/game/halfTime.js';
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
  const r = await fetch(`${BASE}/round/halftime/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbSeed = async (id) => (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [id])).rows[0];
const localOutcome = (balls, stake) => {
  const r = deriveRound(balls);
  const h = hitsOf(r);
  const exp = {};
  for (const [k, a] of Object.entries(stake)) exp[k] = h.has(k) ? { outcome: 'hit', payout: Math.round(a * MARKETS[k].odds * 100) / 100 } : { outcome: 'lose', payout: 0 };
  return exp;
};

// 1. 正常多注（大小 + 五行带 + 半场）+ 无明文
console.log('== 正常多注 ==');
const stake1 = { over: 10, mf: 5, h1: 5 };
const r1 = await play({ bets: stake1, idempotencyKey: kkey('n') });
check('halftime 多注 200', r1.status === 200, `HTTP ${r1.status}`);
check('响应有 drawResult.balls[20]/sum/lowCount/perKeyOutcome/serverSeedHash/nonce/balanceAfter',
  Array.isArray(r1.json.drawResult?.balls) && r1.json.drawResult.balls.length === 20 &&
  new Set(r1.json.drawResult.balls).size === 20 &&
  r1.json.drawResult.sum === r1.json.drawResult.balls.reduce((a, b) => a + b, 0) &&
  r1.json.drawResult.lowCount === r1.json.drawResult.balls.filter((n) => n <= 40).length &&
  typeof r1.json.perKeyOutcome === 'object' && r1.json.serverSeedHash?.length === 64 && Number.isInteger(r1.json.nonce) && r1.json.balanceAfter != null,
  `sum=${r1.json.drawResult?.sum} lowCount=${r1.json.drawResult?.lowCount}`);
check('响应【无】serverSeed 明文', !('serverSeed' in r1.json));
check('逐 key 三态(hit/lose) == 本地按 balls 重算', JSON.stringify(r1.json.perKeyOutcome) === JSON.stringify(localOutcome(r1.json.drawResult.balls, stake1)), `sum=${r1.json.drawResult.sum} outcome=${JSON.stringify(r1.json.perKeyOutcome)}`);

// 2. 可复算：库内 server_seed 造 rng 重算洗80取20 == 响应 balls
console.log('\n== 可复算 ==');
const row = await dbSeed(r1.json.roundId);
const recalcBalls = drawRound(makeSeededRng(row.server_seed, r1.json.clientSeed, r1.json.nonce));
check('本地 seededRng+drawRound == 响应 balls', JSON.stringify(recalcBalls) === JSON.stringify(r1.json.drawResult.balls), `recalc[0..3]=${recalcBalls.slice(0, 4)} resp[0..3]=${r1.json.drawResult.balls.slice(0, 4)}`);

// 3. 部分赢：押互补 over + under（必中其一）
console.log('\n== 部分赢（大小互补必中其一）==');
const r3 = await play({ bets: { over: 10, under: 10 }, idempotencyKey: kkey('side') });
const overHit = r3.json.perKeyOutcome.over.outcome === 'hit', underHit = r3.json.perKeyOutcome.under.outcome === 'hit';
check('大小必中且仅中其一（部分赢）', overHit !== underHit, `over=${r3.json.perKeyOutcome.over.outcome} under=${r3.json.perKeyOutcome.under.outcome} sum=${r3.json.drawResult.sum}`);
const sideOdds = overHit ? ODDS.over : ODDS.under;
check('部分赢总派息 = 命中侧 10×赔率', Number(r3.json.totalPayout) === Math.round(10 * sideOdds * 100) / 100, `total=${r3.json.totalPayout} 期望=${10 * sideOdds}`);

// 4. 五行带命中：循环凑一局 mf 命中（和值 764-855），验该段赔率
console.log('\n== 五行带命中（循环凑 mf 命中）==');
let mfWin = null, mfTries = 0;
for (; mfTries < 100 && !mfWin; mfTries++) {
  const r = await play({ bets: { mf: 5 }, idempotencyKey: kkey('mf') });
  if (r.json.perKeyOutcome.mf.outcome === 'hit') mfWin = r;
}
if (mfWin) {
  const s = mfWin.json.drawResult.sum;
  check(`五行带 mf 命中（和值=${s} ∈ 764-855）→ 派息 5×${ODDS.mf}`, s >= 764 && s <= 855 && mfWin.json.perKeyOutcome.mf.payout === Math.round(5 * ODDS.mf * 100) / 100, `sum=${s} payout=${mfWin.json.perKeyOutcome.mf.payout}`);
  console.log(`  （${mfTries} 次凑到 mf 命中，和值 ${s}）`);
} else { check('五行带 mf 命中（100 次未凑到，跳过）', false, '异常：P≈0.388 应命中'); }

// 5. draw 市场（半场恰 10/10）：循环凑一局 lowCount=10，确认 draw 判 hit（非 push）
console.log('\n== draw 市场（lowCount=10 判 hit 非 push）==');
let drawWin = null, drawTries = 0;
for (; drawTries < 150 && !drawWin; drawTries++) {
  const r = await play({ bets: { draw: 5 }, idempotencyKey: kkey('draw') });
  if (r.json.drawResult.lowCount === 10) drawWin = r;
}
if (drawWin) {
  const oc = drawWin.json.perKeyOutcome.draw;
  check(`draw 命中（lowCount=10）→ outcome=hit（非 push）派息 5×${ODDS.draw}`, oc.outcome === 'hit' && oc.payout === Math.round(5 * ODDS.draw * 100) / 100, `lowCount=${drawWin.json.drawResult.lowCount} outcome=${JSON.stringify(oc)}`);
  check('draw 命中响应无 push 字段（判 hit/lose 两态）', !JSON.stringify(drawWin.json.perKeyOutcome).includes('push'));
  console.log(`  （${drawTries} 次凑到 lowCount=10）`);
} else { check('draw 命中（150 次未凑到 lowCount=10，跳过）', false, '异常：P≈0.203 应命中'); }

// 6. 总额风控 Σ>100
console.log('\n== 总额风控 ==');
const over = await play({ bets: { over: 60, under: 60 }, idempotencyKey: kkey('over') });
check('Σ注额 120 > maxBet100 → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `${over.status}/${over.code}`);

// 7. 防负注 + 防假 key
console.log('\n== 防负注 + 防假 key ==');
const neg = await play({ bets: { over: -50, under: 10 }, idempotencyKey: kkey('neg') });
check('负注额 {over:-50} → 400', neg.status === 400, `${neg.status} ${neg.json?.error}`);
const badKey = await play({ bets: { xx: 10 }, idempotencyKey: kkey('bk') });
check('非法 key {xx} → 400', badKey.status === 400, `${badKey.status} ${badKey.json?.error}`);
const badKey2 = await play({ bets: { 'h-draw': 10 }, idempotencyKey: kkey('bk2') });
check('非法 key {h-draw}（半场只 h1/draw/h2）→ 400', badKey2.status === 400, `${badKey2.status}`);

// 8. 防作弊：塞假 balls/payout → 服务端覆盖
console.log('\n== 防作弊 ==');
const cheat = await play({ bets: { over: 10 }, drawResult: { balls: Array.from({ length: 20 }, (_, i) => 61 + i), sum: 1410, lowCount: 0 }, perKeyOutcome: { over: { outcome: 'hit', payout: 99999 } }, totalPayout: 99999, idempotencyKey: kkey('cheat') });
const trueRow = await dbSeed(cheat.json.roundId);
const trueBalls = drawRound(makeSeededRng(trueRow.server_seed, cheat.json.clientSeed, cheat.json.nonce));
check('前端塞假 balls/payout 被忽略，服务端自算', JSON.stringify(cheat.json.drawResult.balls) === JSON.stringify(trueBalls) && Number(cheat.json.totalPayout) !== 99999, `serverSum=${cheat.json.drawResult.sum} total=${cheat.json.totalPayout}`);

// 9. nonce 递增
console.log('\n== nonce ==');
const seq = [];
for (let i = 0; i < 3; i++) { const r = await play({ bets: { over: 1 }, idempotencyKey: kkey('seq') }); seq.push(r.json.nonce); }
check('连打 3 注 nonce 递增', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(',')}]`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
