// RollingBall /rollingball/play 端到端（bespoke 新范式核心，5 个⭐安全点实证）：
// 完整一局/⭐服务端锁odds/⭐ballIndex定序/⭐无放回拒已开/⭐敞口=0/⭐GET无未来泄露/可复算/幂等/风控/防作弊/nonce。
import { pool, query } from '../src/db.js';
import { drawBall, remainingPool, oddsFor, hitOf } from '../src/game/rollingBall.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `rb-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const round2 = (x) => Math.round(x * 100) / 100;

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: process.env.ALICE_PW, type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (body) => {
  const r = await fetch(`${BASE}/round/rollingball/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
};
const getRound = async (id) => {
  const r = await fetch(`${BASE}/round/${id}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, json: await r.json() };
};
const dbRound = async (id) => (await query('SELECT server_seed, client_seed, result, status, bet_amount, payout FROM rounds WHERE id=$1', [id])).rows[0];
const balOf = async () => Number((await query("SELECT balance FROM wallets WHERE player_id=(SELECT id FROM players WHERE username='alice')")).rows[0].balance);

// ============ 1. 完整一局：新局押球0 → 续球押球1 → 续球押球2 → settled ============
console.log('== 完整一局（3 球按步开，逐球即扣即结）==');
const bal0 = await balOf();
// 球 0
const r0 = await play({ bets: { big: 10, small: 10, odd: 5 }, idempotencyKey: kkey('b0') });
check('球0 新局 200 + status playing + ballIndex 0 + nextBall 1', r0.status === 200 && r0.json.status === 'playing' && r0.json.ballIndex === 0 && r0.json.nextBall === 1, `status=${r0.json.status} idx=${r0.json.ballIndex}`);
check('球0 响应有 roundId/ball(1-75)/perKeyOutcome/serverSeedHash/nonce/balanceAfter，无 serverSeed 明文',
  r0.json.roundId && r0.json.ball >= 1 && r0.json.ball <= 75 && typeof r0.json.perKeyOutcome === 'object' && r0.json.serverSeedHash?.length === 64 && Number.isInteger(r0.json.nonce) && r0.json.balanceAfter != null && !('serverSeed' in r0.json), `ball=${r0.json.ball}`);
const rid = r0.json.roundId;
const balAfter0 = await balOf();
// ⭐敞口=0：球0结算完余额已定（即扣即结），扣 25 + 派本球赢
{
  const num = r0.json.ball;
  const stake = { big: 10, small: 10, odd: 5 };
  let expWin = 0;
  for (const [k, a] of Object.entries(stake)) if (hitOf(k, num)) expWin = round2(expWin + a * oddsFor(k, 0, []));
  check('⭐ 敞口=0：球0 即扣即结，余额 = bal0 − 25 + 本球赢（无骑留 pending）', balAfter0 === round2(bal0 - 25 + Number(r0.json.ballPayout)) && Number(r0.json.ballPayout) === round2(expWin), `bal ${bal0}→${balAfter0} ballPayout=${r0.json.ballPayout} expWin=${round2(expWin)}`);
}
// 球 1（续球，线程 roundId）
const r1 = await play({ roundId: rid, bets: { red: 10, blue: 10 }, idempotencyKey: kkey('b1') });
check('球1 续球 200 + ballIndex 1 + nextBall 2 + revealed 2 球', r1.status === 200 && r1.json.ballIndex === 1 && r1.json.nextBall === 2 && r1.json.revealed.length === 2, `idx=${r1.json.ballIndex} revealed=${r1.json.revealed}`);
const balAfter1 = await balOf();
check('球1 独立扣（本球扣 20，与球0 独立）', balAfter1 === round2(balAfter0 - 20 + Number(r1.json.ballPayout)), `bal ${balAfter0}→${balAfter1} ballPayout=${r1.json.ballPayout}`);
// 球 2（末球）
const r2 = await play({ roundId: rid, bets: { even: 10 }, idempotencyKey: kkey('b2') });
check('球2 末球 200 + ballIndex 2 + status settled + nextBall null + revealed 3 球', r2.status === 200 && r2.json.ballIndex === 2 && r2.json.status === 'settled' && r2.json.nextBall === null && r2.json.revealed.length === 3, `status=${r2.json.status} revealed=${r2.json.revealed}`);
check('3 球互异（无放回）', new Set(r2.json.revealed).size === 3, `revealed=${r2.json.revealed}`);
check('nonce 每球递增（一局 N/N+1/N+2）', r1.json.nonce === r0.json.nonce + 1 && r2.json.nonce === r1.json.nonce + 1, `nonces=[${r0.json.nonce},${r1.json.nonce},${r2.json.nonce}]`);

// ============ 2. ⭐ 服务端锁 odds：前端塞假 odds → 被服务端 oddsFor 覆盖 ============
console.log('\n== ⭐ 服务端锁 odds ==');
// 前端塞假 odds/perKeyOutcome/payout（bets 只认 amount），验结算用服务端 oddsFor
const cheatOdds2 = await play({ bets: { big: 10 }, odds: { big: 999 }, perKeyOutcome: { big: { outcome: 'hit', payout: 99999 } }, idempotencyKey: kkey('lockodds2') });
{
  const num = cheatOdds2.json.ball;
  const serverOdds = oddsFor('big', 0, []);
  const expPayout = hitOf('big', num) ? round2(10 * serverOdds) : 0;
  check('⭐ 前端塞 odds:999/payout:99999 被忽略，结算用服务端 oddsFor', Number(cheatOdds2.json.ballPayout) === expPayout && (cheatOdds2.json.perKeyOutcome.big.payout === expPayout), `ball=${num} serverOdds=${serverOdds} ballPayout=${cheatOdds2.json.ballPayout} 期望=${expPayout}`);
}

// ============ 3. ⭐ ballIndex 定序：客户端传错 ballIndex → 拒（不能跳球）============
console.log('\n== ⭐ ballIndex 定序（防跳球）==');
const seq0 = await play({ bets: { big: 5 }, idempotencyKey: kkey('seq0') });
const jump = await play({ roundId: seq0.json.roundId, ballIndex: 2, bets: { big: 5 }, idempotencyKey: kkey('jump') });
check('⭐ 续球传 ballIndex:2（应为 1）→ 400 定序错误（防跳球）', jump.status === 400 && /定序|防跳球/.test(jump.json.error || ''), `${jump.status} ${jump.json?.error}`);
const correct = await play({ roundId: seq0.json.roundId, ballIndex: 1, bets: { big: 5 }, idempotencyKey: kkey('correct') });
check('续球传正确 ballIndex:1 → 200（服务端定序放行）', correct.status === 200 && correct.json.ballIndex === 1);

// ============ 4. ⭐ 无放回拒已开号：球0开出 N，球1 押 num-N（已开）→ 400 ============
console.log('\n== ⭐ 无放回拒已开号 ==');
const nr0 = await play({ bets: { big: 5 }, idempotencyKey: kkey('nr0') });
const openedNum = nr0.json.ball;
const rejOpened = await play({ roundId: nr0.json.roundId, bets: { [`num-${openedNum}`]: 5 }, idempotencyKey: kkey('nropen') });
check(`⭐ 球1 押已开单号 num-${openedNum} → 400（无放回不可押）`, rejOpened.status === 400 && /已开号|号池|不可押/.test(rejOpened.json.error || ''), `${rejOpened.status} ${rejOpened.json?.error}`);
// 押未开单号 → 放行
const freshNum = openedNum === 1 ? 2 : 1;
const okFresh = await play({ roundId: nr0.json.roundId, bets: { [`num-${freshNum}`]: 5 }, idempotencyKey: kkey('nrfresh') });
check(`球1 押未开单号 num-${freshNum} → 200`, okFresh.status === 200);

// ============ 5. ⭐ GET /:id 无未来泄露（按步现派：result 只有已开球）============
console.log('\n== ⭐ GET /:id 无未来泄露 ==');
const g0 = await play({ bets: { big: 5 }, idempotencyKey: kkey('get0') });
const gr = await getRound(g0.json.roundId);
check('⭐ playing 中 GET/:id：result.revealed 只 1 球（球0），无球1/球2（按步现派根本没抽）', gr.json.result?.revealed?.length === 1 && gr.json.result.balls?.length === 1, `revealed=${JSON.stringify(gr.json.result?.revealed)} balls=${gr.json.result?.balls?.length}`);
check('GET/:id 无 server_seed 明文', !('server_seed' in gr.json) && !('serverSeed' in gr.json));
// 库里也确认 result 不含未开球（按步现派）
const dbG = await dbRound(g0.json.roundId);
check('库内 result.revealed 只 1 球（未开球根本不存 DB）', dbG.result.revealed.length === 1 && dbG.result.balls.length === 1);

// ============ 6. 可复算：查库 server_seed + 每球 nonce 重算 drawBall == 各球 ============
console.log('\n== 可复算（每球 nonce 重算）==');
const full = await dbRound(rid);
let recalcOk = true; let revAcc = [];
for (const b of full.result.balls) {
  const pool = remainingPool(revAcc);
  const recalc = drawBall(pool, makeSeededRng(full.server_seed, full.client_seed, b.nonce));
  if (recalc !== b.ball) recalcOk = false;
  revAcc.push(b.ball);
}
check('本地 seededRng+drawBall（每球 nonce，按剩余池）== 库内各球', recalcOk, `balls=${full.result.balls.map((b) => b.ball)}`);

// ============ 7. 每球幂等：同 idempotencyKey 重放不重抽不重扣 ============
console.log('\n== 每球幂等 ==');
const idemKey = kkey('idem');
const im1 = await play({ bets: { big: 10 }, idempotencyKey: idemKey });
const balA = await balOf();
const im2 = await play({ bets: { big: 10 }, idempotencyKey: idemKey });
const balB = await balOf();
check('同 idempotencyKey 重放：同 ball + 余额不变（不重抽不重扣）', im2.json.ball === im1.json.ball && im2.json.idempotent === true && balA === balB, `ball ${im1.json.ball}==${im2.json.ball} bal ${balA}==${balB}`);

// ============ 8. 风控 + 防负注 + 防假 key + 空注 ============
console.log('\n== 风控 + 防负注 + 防假 key + 空注 ==');
const over = await play({ bets: { big: 60, small: 60 }, idempotencyKey: kkey('over') });
check('Σ注额 120 > maxBet100 → 400', over.status === 400 && /超|max|限/.test(over.json.error || '') || over.status === 400, `${over.status} ${over.json?.error}`);
const neg = await play({ bets: { big: -50, small: 10 }, idempotencyKey: kkey('neg') });
check('负注额 {big:-50} → 400', neg.status === 400);
const badKey = await play({ bets: { 'num-76': 10 }, idempotencyKey: kkey('bk') });
check('非法 key {num-76}（单号仅 1-75）→ 400', badKey.status === 400, `${badKey.status} ${badKey.json?.error}`);
const badKey2 = await play({ bets: { foo: 10 }, idempotencyKey: kkey('bk2') });
check('非法 key {foo} → 400', badKey2.status === 400);
const empty = await play({ bets: {}, idempotencyKey: kkey('empty') });
check('空注 {} → 400（每球≥1注）', empty.status === 400 && /至少|≥1/.test(empty.json.error || ''), `${empty.status} ${empty.json?.error}`);

// ============ 9. 防作弊：塞假 ball → 服务端覆盖 ============
console.log('\n== 防作弊 ==');
const cheatBall = await play({ bets: { 'num-7': 10 }, ball: 7, idempotencyKey: kkey('cheatball') });
const trueRound = await dbRound(cheatBall.json.roundId);
const trueBall = drawBall(remainingPool([]), makeSeededRng(trueRound.server_seed, trueRound.client_seed, cheatBall.json.nonce));
check('前端塞假 ball:7 被忽略，服务端自算', cheatBall.json.ball === trueBall, `serverBall=${cheatBall.json.ball} recalc=${trueBall}`);

// ============ 10. abandoned 局无害：只押球0 不续 → 零敞口（不占 exposure）============
console.log('\n== abandoned 局零敞口 ==');
const ab = await play({ bets: { big: 5 }, idempotencyKey: kkey('ab') });
const abRound = await dbRound(ab.json.roundId);
check('只押球0 不续：round playing 但已即扣即结（bet_amount=5, payout 已定），无 pending 骑留', abRound.status === 'playing' && Number(abRound.bet_amount) === 5 && abRound.payout != null, `status=${abRound.status} bet=${abRound.bet_amount} payout=${abRound.payout}`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
