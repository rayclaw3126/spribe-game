// DerbyDay /derbyday/play 端到端（首个 push 实战，脚手架 push 分支真跑）：正常/⭐push三态真跑(退本金余额账)/混合三态一局/可复算/风控/防负注/防假key/防作弊/nonce/无明文。
import { pool, query } from '../src/db.js';
import { drawMatch, deriveMatch, hitsOf, pushesOf, MARKETS, ODDS } from '../src/game/derbyDay.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `dd-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const round2 = (x) => Math.round(x * 100) / 100;

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: process.env.ALICE_PW, type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (body) => {
  const r = await fetch(`${BASE}/round/derbyday/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbSeed = async (id) => (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [id])).rows[0];
const balOf = async () => Number((await query("SELECT balance FROM wallets WHERE player_id=(SELECT id FROM players WHERE username='alice')")).rows[0].balance);

// 1. 正常多注（H/A + 大小 + 半全场）+ 无明文
console.log('== 正常多注 ==');
const stake1 = { 'ft-home': 10, 'ht-big': 5, 'ht-ft-hh': 5 };
const r1 = await play({ bets: stake1, idempotencyKey: kkey('n') });
check('derbyday 多注 200', r1.status === 200, `HTTP ${r1.status}`);
check('响应有 drawResult.home20/away20/htHome/htAway/ftHome/ftAway/perKeyOutcome/serverSeedHash/nonce/balanceAfter',
  Array.isArray(r1.json.drawResult?.home20) && r1.json.drawResult.home20.length === 20 && Array.isArray(r1.json.drawResult.away20) &&
  Number.isInteger(r1.json.drawResult.htHome) && Number.isInteger(r1.json.drawResult.ftHome) &&
  typeof r1.json.perKeyOutcome === 'object' && r1.json.serverSeedHash?.length === 64 && Number.isInteger(r1.json.nonce) && r1.json.balanceAfter != null,
  `htHome=${r1.json.drawResult?.htHome} htAway=${r1.json.drawResult?.htAway}`);
check('响应【无】serverSeed 明文', !('serverSeed' in r1.json));
// 逐 key 三态本地重算（hit/push/lose 三态）
{
  const r = deriveMatch({ home20: r1.json.drawResult.home20, away20: r1.json.drawResult.away20 });
  const h = hitsOf(r), p = pushesOf(r);
  const exp = {};
  for (const [k, a] of Object.entries(stake1)) exp[k] = h.has(k) ? { outcome: 'hit', payout: round2(a * MARKETS[k].odds) } : (p.has(k) ? { outcome: 'push', payout: a } : { outcome: 'lose', payout: 0 });
  check('逐 key 三态(hit/push/lose) == 本地按 balls 重算', JSON.stringify(r1.json.perKeyOutcome) === JSON.stringify(exp), `outcome=${JSON.stringify(r1.json.perKeyOutcome)}`);
}

// 2. 可复算：库内 server_seed 造 rng 重算 == 响应 home20/away20
console.log('\n== 可复算 ==');
const row = await dbSeed(r1.json.roundId);
const recalc = drawMatch(makeSeededRng(row.server_seed, r1.json.clientSeed, r1.json.nonce));
check('本地 seededRng+drawMatch == 响应 home20/away20', JSON.stringify(recalc.home20) === JSON.stringify(r1.json.drawResult.home20) && JSON.stringify(recalc.away20) === JSON.stringify(r1.json.drawResult.away20));

// 3. ⭐ push 三态真跑（重点）：凑一局 HT 平局，押 ht-home + ft-home + ft-away 三键，验 push 退本金 + 混合三态 + 余额账
console.log('\n== ⭐ push 三态真跑（凑 HT 平局，混合 hit/push/lose 一局 + 余额账）==');
let running = await balOf();
let tieRound = null, tieTries = 0;
for (; tieTries < 4000 && !tieRound; tieTries++) {
  const before = running;
  const r = await play({ bets: { 'ht-home': 10, 'ft-home': 5, 'ft-away': 5 }, idempotencyKey: kkey('tie') });
  running = Number(r.json.balanceAfter);
  const d = r.json.drawResult;
  // 要 HT 平（触发 ht-home push）且 FT 不平（ft-home/ft-away 一 hit 一 lose，凑齐三态）
  if (d.htHome === d.htAway && d.ftHome !== d.ftAway) tieRound = { r, before };
}
if (tieRound) {
  const { r, before } = tieRound;
  const d = r.json.drawResult, oc = r.json.perKeyOutcome;
  // ht-home push 退本金
  check(`HT 平局(htHome=${d.htHome}==htAway=${d.htAway})：ht-home outcome=push、payout=10（退本金=注额，非 ×odds）`, oc['ht-home'].outcome === 'push' && oc['ht-home'].payout === 10);
  // ft-home/ft-away 一 hit 一 lose（混合三态）
  const ftHomeWin = d.ftHome > d.ftAway;
  check(`混合三态一局：ft-home ${ftHomeWin ? 'hit' : 'lose'} / ft-away ${ftHomeWin ? 'lose' : 'hit'}（+ ht-home push）三态齐`,
    (ftHomeWin ? (oc['ft-home'].outcome === 'hit' && oc['ft-home'].payout === round2(5 * ODDS.main) && oc['ft-away'].outcome === 'lose') : (oc['ft-away'].outcome === 'hit' && oc['ft-away'].payout === round2(5 * ODDS.main) && oc['ft-home'].outcome === 'lose')),
    `ft-home=${JSON.stringify(oc['ft-home'])} ft-away=${JSON.stringify(oc['ft-away'])}`);
  // totalPayout 含 push 退本金（>0 走 credit，不误判全输）
  const expTotal = round2(10 + 5 * ODDS.main);   // ht-home 退 10 + 命中侧 5×1.95
  check(`push 局 totalPayout=${expTotal} 含退本金（>0 走 credit）`, Number(r.json.totalPayout) === expTotal, `totalPayout=${r.json.totalPayout}`);
  // ⭐ 余额账：balanceAfter = before − 总注20 + totalPayout（push 退本金令 ht-home 净 0，不赢不输）
  check(`⭐ 余额账：balanceAfter=${r.json.balanceAfter} == before(${before}) − 20 + totalPayout(${expTotal}) = ${round2(before - 20 + expTotal)}`, Number(r.json.balanceAfter) === round2(before - 20 + expTotal));
  // push=不赢不输：ht-home 单看，扣 10 退 10 净 0
  check('push=不赢不输：ht-home 那一注净额 = 0（扣 10 退 10）', oc['ht-home'].payout - 10 === 0);
  console.log(`  （${tieTries} 次凑到 HT 平局；账：${before} − 20 + ${expTotal} = ${r.json.balanceAfter}）`);
} else {
  check('push 三态真跑（4000 次未凑到 HT 平局，跳过）', false, '异常：P≈0.004 应命中');
}

// 4. 半全场 push：凑一局任一半平，押 ht-ft-hh 验退注
console.log('\n== 半全场 push（凑任一半平）==');
let htftRound = null, htftTries = 0;
for (; htftTries < 3000 && !htftRound; htftTries++) {
  const r = await play({ bets: { 'ht-ft-hh': 5 }, idempotencyKey: kkey('htft') });
  const d = r.json.drawResult;
  if (d.htHome === d.htAway || d.ftHome === d.ftAway) htftRound = r;
}
if (htftRound) {
  const oc = htftRound.json.perKeyOutcome['ht-ft-hh'];
  check('半全场任一半平 → ht-ft-hh outcome=push、payout=5（退本金）', oc.outcome === 'push' && oc.payout === 5, `${JSON.stringify(oc)}`);
  check('半全场 push 局 totalPayout=5（退本金 >0）', Number(htftRound.json.totalPayout) === 5);
  console.log(`  （${htftTries} 次凑到半全场 push）`);
} else { check('半全场 push（3000 次未凑到，跳过）', false, '异常：P≈0.0073 应命中'); }

// 5. 总额风控 + 防负注 + 防假 key
console.log('\n== 风控 + 防负注 + 防假 key ==');
const over = await play({ bets: { 'ft-home': 60, 'ft-away': 60 }, idempotencyKey: kkey('over') });
check('Σ注额 120 > maxBet100 → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `${over.status}/${over.code}`);
const neg = await play({ bets: { 'ft-home': -50, 'ft-away': 10 }, idempotencyKey: kkey('neg') });
check('负注额 {ft-home:-50} → 400', neg.status === 400, `${neg.status} ${neg.json?.error}`);
const badKey = await play({ bets: { 'ht-draw': 10 }, idempotencyKey: kkey('bk') });
check('非法 key {ht-draw}（无此键）→ 400', badKey.status === 400, `${badKey.status} ${badKey.json?.error}`);
const badKey2 = await play({ bets: { 'ht-ft-xx': 10 }, idempotencyKey: kkey('bk2') });
check('非法 key {ht-ft-xx} → 400', badKey2.status === 400, `${badKey2.status}`);

// 6. 防作弊：塞假 drawResult/payout → 服务端覆盖
console.log('\n== 防作弊 ==');
const cheat = await play({ bets: { 'ft-home': 10 }, drawResult: { home20: Array.from({ length: 20 }, (_, i) => 61 + i), away20: Array.from({ length: 20 }, (_, i) => i + 1), htHome: 755, htAway: 55 }, perKeyOutcome: { 'ft-home': { outcome: 'hit', payout: 99999 } }, totalPayout: 99999, idempotencyKey: kkey('cheat') });
const trueRow = await dbSeed(cheat.json.roundId);
const trueDraw = drawMatch(makeSeededRng(trueRow.server_seed, cheat.json.clientSeed, cheat.json.nonce));
check('前端塞假 drawResult/payout 被忽略，服务端自算', JSON.stringify(cheat.json.drawResult.home20) === JSON.stringify(trueDraw.home20) && Number(cheat.json.totalPayout) !== 99999, `serverFtHome=${cheat.json.drawResult.ftHome} total=${cheat.json.totalPayout}`);

// 7. nonce 递增
console.log('\n== nonce ==');
const seq = [];
for (let i = 0; i < 3; i++) { const r = await play({ bets: { 'ft-home': 1 }, idempotencyKey: kkey('seq') }); seq.push(r.json.nonce); }
check('连打 3 注 nonce 递增', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(',')}]`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
