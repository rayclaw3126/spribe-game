// WuXing /wuxing/play 端到端（脚手架红利，验 WuXing 特化）：多注/部分赢/可复算/龙虎命中/三向盘和局(dt-tie非push)/五行带/风控/防负注/防假key/防作弊/nonce/无明文。
import { pool, query } from '../src/db.js';
import { drawKeno, deriveRound, hitsOf, MARKETS, ODDS } from '../src/game/wuXing.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `wx-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: process.env.ALICE_PW, type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (body) => {
  const r = await fetch(`${BASE}/round/wuxing/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
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

// 1. 正常多注（大小 + 龙虎 + 五行带）+ 无明文
console.log('== 正常多注 ==');
const stake1 = { big: 10, dragon: 5, 'wx-water': 5 };
const r1 = await play({ bets: stake1, idempotencyKey: kkey('n') });
check('wuxing 多注 200', r1.status === 200, `HTTP ${r1.status}`);
check('响应有 drawResult.balls[20]/sum/dragon/tiger/perKeyOutcome/serverSeedHash/nonce/balanceAfter',
  Array.isArray(r1.json.drawResult?.balls) && r1.json.drawResult.balls.length === 20 && new Set(r1.json.drawResult.balls).size === 20 &&
  r1.json.drawResult.sum === r1.json.drawResult.balls.reduce((a, b) => a + b, 0) &&
  r1.json.drawResult.dragon === Math.floor(r1.json.drawResult.sum / 10) % 10 && r1.json.drawResult.tiger === r1.json.drawResult.sum % 10 &&
  typeof r1.json.perKeyOutcome === 'object' && r1.json.serverSeedHash?.length === 64 && Number.isInteger(r1.json.nonce) && r1.json.balanceAfter != null,
  `sum=${r1.json.drawResult?.sum} d=${r1.json.drawResult?.dragon} t=${r1.json.drawResult?.tiger}`);
check('响应【无】serverSeed 明文', !('serverSeed' in r1.json));
check('逐 key 三态(hit/lose) == 本地按 balls 重算', JSON.stringify(r1.json.perKeyOutcome) === JSON.stringify(localOutcome(r1.json.drawResult.balls, stake1)), `sum=${r1.json.drawResult.sum} outcome=${JSON.stringify(r1.json.perKeyOutcome)}`);

// 2. 可复算：库内 server_seed 造 rng 重算 == 响应 balls
console.log('\n== 可复算 ==');
const row = await dbSeed(r1.json.roundId);
const recalcBalls = drawKeno(makeSeededRng(row.server_seed, r1.json.clientSeed, r1.json.nonce));
check('本地 seededRng+drawKeno == 响应 balls', JSON.stringify(recalcBalls) === JSON.stringify(r1.json.drawResult.balls), `recalc[0..3]=${recalcBalls.slice(0, 4)} resp[0..3]=${r1.json.drawResult.balls.slice(0, 4)}`);

// 3. 部分赢：押互补 big + small（必中其一）
console.log('\n== 部分赢（大小互补必中其一）==');
const r3 = await play({ bets: { big: 10, small: 10 }, idempotencyKey: kkey('bs') });
const bigHit = r3.json.perKeyOutcome.big.outcome === 'hit', smallHit = r3.json.perKeyOutcome.small.outcome === 'hit';
check('大小必中且仅中其一（部分赢）', bigHit !== smallHit, `big=${r3.json.perKeyOutcome.big.outcome} small=${r3.json.perKeyOutcome.small.outcome} sum=${r3.json.drawResult.sum}`);
const sideOdds = bigHit ? ODDS.main : ODDS.small;
check('部分赢总派息 = 命中侧 10×赔率', Number(r3.json.totalPayout) === Math.round(10 * sideOdds * 100) / 100, `total=${r3.json.totalPayout} 期望=${10 * sideOdds}`);

// 4. 龙虎命中：循环凑一局 dragon 命中（龙>虎），验赔率
console.log('\n== 龙虎命中（循环凑 dragon 命中）==');
let dWin = null, dTries = 0;
for (; dTries < 60 && !dWin; dTries++) {
  const r = await play({ bets: { dragon: 5 }, idempotencyKey: kkey('d') });
  if (r.json.perKeyOutcome.dragon.outcome === 'hit') dWin = r;
}
if (dWin) {
  const d = dWin.json.drawResult;
  check(`dragon 命中（龙${d.dragon}>虎${d.tiger}）→ 派息 5×${ODDS.dt}`, d.dragon > d.tiger && dWin.json.perKeyOutcome.dragon.payout === Math.round(5 * ODDS.dt * 100) / 100, `d=${d.dragon} t=${d.tiger} payout=${dWin.json.perKeyOutcome.dragon.payout}`);
  console.log(`  （${dTries} 次凑到 龙>虎）`);
} else { check('dragon 命中（60 次未凑到，跳过）', false, '异常：P≈0.45 应命中'); }

// 5. 三向盘和局：凑一局龙虎和（dragon==tiger）→ dragon/tiger 都 lose、dt-tie 命中，判输不退非 push
console.log('\n== 三向盘和局（龙虎和 dt-tie 非 push）==');
let tieWin = null, tTries = 0;
for (; tTries < 200 && !tieWin; tTries++) {
  const r = await play({ bets: { dragon: 5, tiger: 5, 'dt-tie': 5 }, idempotencyKey: kkey('tie') });
  if (r.json.drawResult.dragon === r.json.drawResult.tiger) tieWin = r;
}
if (tieWin) {
  const oc = tieWin.json.perKeyOutcome;
  const d = tieWin.json.drawResult;
  check(`龙虎和局(龙${d.dragon}==虎${d.tiger})：dragon/tiger 两向皆 lose（判输不退）`, oc.dragon.outcome === 'lose' && oc.dragon.payout === 0 && oc.tiger.outcome === 'lose' && oc.tiger.payout === 0, `dragon=${JSON.stringify(oc.dragon)} tiger=${JSON.stringify(oc.tiger)}`);
  check(`dt-tie 命中 → 派息 5×${ODDS.dtTie}`, oc['dt-tie'].outcome === 'hit' && oc['dt-tie'].payout === Math.round(5 * ODDS.dtTie * 100) / 100, `dt-tie=${JSON.stringify(oc['dt-tie'])}`);
  check('龙虎和局响应无 push 字段（判 hit/lose 两态）', !JSON.stringify(oc).includes('push'));
  console.log(`  （${tTries} 次凑到 龙虎和 d=t=${d.dragon}）`);
} else { check('三向盘和局（200 次未凑到龙虎和，跳过）', false, '异常：P≈0.1 应命中'); }

// 6. 五行带命中：循环凑 wx-water 命中（和值 764-855）
console.log('\n== 五行带命中（循环凑 wx-water）==');
let wWin = null, wTries = 0;
for (; wTries < 100 && !wWin; wTries++) {
  const r = await play({ bets: { 'wx-water': 5 }, idempotencyKey: kkey('w') });
  if (r.json.perKeyOutcome['wx-water'].outcome === 'hit') wWin = r;
}
if (wWin) {
  const s = wWin.json.drawResult.sum;
  check(`五行带 wx-water 命中（和值=${s} ∈ 764-855）→ 派息 5×${ODDS.wxWater}`, s >= 764 && s <= 855 && wWin.json.perKeyOutcome['wx-water'].payout === Math.round(5 * ODDS.wxWater * 100) / 100, `sum=${s} payout=${wWin.json.perKeyOutcome['wx-water'].payout}`);
  console.log(`  （${wTries} 次凑到 wx-water，和值 ${s}）`);
} else { check('五行带 wx-water 命中（100 次未凑到，跳过）', false, '异常：P≈0.388 应命中'); }

// 7. 总额风控 + 防负注 + 防假 key
console.log('\n== 风控 + 防负注 + 防假 key ==');
const over = await play({ bets: { big: 60, small: 60 }, idempotencyKey: kkey('over') });
check('Σ注额 120 > maxBet100 → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `${over.status}/${over.code}`);
const neg = await play({ bets: { big: -50, small: 10 }, idempotencyKey: kkey('neg') });
check('负注额 {big:-50} → 400', neg.status === 400, `${neg.status} ${neg.json?.error}`);
const badKey = await play({ bets: { 'wx-metal': 10 }, idempotencyKey: kkey('bk') });
check('非法 key {wx-metal}（五行带只 gold/wood/water/fire/earth）→ 400', badKey.status === 400, `${badKey.status} ${badKey.json?.error}`);
const badKey2 = await play({ bets: { 'dt-win': 10 }, idempotencyKey: kkey('bk2') });
check('非法 key {dt-win} → 400', badKey2.status === 400, `${badKey2.status}`);

// 8. 防作弊：塞假 balls/dragon/payout → 服务端覆盖
console.log('\n== 防作弊 ==');
const cheat = await play({ bets: { big: 10 }, drawResult: { balls: Array.from({ length: 20 }, (_, i) => 61 + i), sum: 1410, dragon: 4, tiger: 1 }, perKeyOutcome: { big: { outcome: 'hit', payout: 99999 } }, totalPayout: 99999, idempotencyKey: kkey('cheat') });
const trueRow = await dbSeed(cheat.json.roundId);
const trueBalls = drawKeno(makeSeededRng(trueRow.server_seed, cheat.json.clientSeed, cheat.json.nonce));
check('前端塞假 balls/dragon/payout 被忽略，服务端自算', JSON.stringify(cheat.json.drawResult.balls) === JSON.stringify(trueBalls) && Number(cheat.json.totalPayout) !== 99999, `serverSum=${cheat.json.drawResult.sum} total=${cheat.json.totalPayout}`);

// 9. nonce 递增
console.log('\n== nonce ==');
const seq = [];
for (let i = 0; i < 3; i++) { const r = await play({ bets: { big: 1 }, idempotencyKey: kkey('seq') }); seq.push(r.json.nonce); }
check('连打 3 注 nonce 递增', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(',')}]`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
