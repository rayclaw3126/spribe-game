// LineUp /lineup/play 端到端（脚手架红利，验 LineUp 特化）：多注/部分赢/可复算/段位带/行式/风控/防负注/防假key/防作弊/nonce/无明文。
import { pool, query } from '../src/db.js';
import { drawGrid, deriveRound, hitsOf, MARKETS, ODDS } from '../src/game/lineUp.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `lu-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: process.env.ALICE_PW, type: 'player' }) });
  return (await r.json()).token;
})();
const play = async (body) => {
  const r = await fetch(`${BASE}/round/lineup/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const dbSeed = async (id) => (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [id])).rows[0];
const localOutcome = (grid, stake) => {
  const r = deriveRound(grid);
  const h = hitsOf(r);
  const exp = {};
  for (const [k, a] of Object.entries(stake)) exp[k] = h.has(k) ? { outcome: 'hit', payout: Math.round(a * MARKETS[k].odds * 100) / 100 } : { outcome: 'lose', payout: 0 };
  return exp;
};

// 1. 正常多注（总和大小 + 段位带 + 行式）+ 无明文
console.log('== 正常多注 ==');
const stake1 = { big: 10, 'zone-euro': 5, 'L1-big': 5 };
const r1 = await play({ bets: stake1, idempotencyKey: kkey('n') });
check('lineup 多注 200', r1.status === 200, `HTTP ${r1.status}`);
check('响应有 drawResult.grid[25]/rowSums[5]/total/perKeyOutcome/serverSeedHash/nonce/balanceAfter',
  Array.isArray(r1.json.drawResult?.grid) && r1.json.drawResult.grid.length === 25 && r1.json.drawResult.grid.every((n) => n >= 0 && n <= 9) &&
  Array.isArray(r1.json.drawResult.rowSums) && r1.json.drawResult.rowSums.length === 5 &&
  r1.json.drawResult.total === r1.json.drawResult.grid.reduce((a, b) => a + b, 0) &&
  r1.json.drawResult.rowSums.reduce((a, b) => a + b, 0) === r1.json.drawResult.total &&
  typeof r1.json.perKeyOutcome === 'object' && r1.json.serverSeedHash?.length === 64 && Number.isInteger(r1.json.nonce) && r1.json.balanceAfter != null,
  `total=${r1.json.drawResult?.total} rowSums=${r1.json.drawResult?.rowSums}`);
check('响应【无】serverSeed 明文', !('serverSeed' in r1.json));
check('逐 key 三态(hit/lose) == 本地按 grid 重算', JSON.stringify(r1.json.perKeyOutcome) === JSON.stringify(localOutcome(r1.json.drawResult.grid, stake1)), `total=${r1.json.drawResult.total} outcome=${JSON.stringify(r1.json.perKeyOutcome)}`);

// 2. 可复算：库内 server_seed 造 rng 重算 25 位 == 响应 grid
console.log('\n== 可复算 ==');
const row = await dbSeed(r1.json.roundId);
const recalcGrid = drawGrid(makeSeededRng(row.server_seed, r1.json.clientSeed, r1.json.nonce));
check('本地 seededRng+drawGrid == 响应 grid', JSON.stringify(recalcGrid) === JSON.stringify(r1.json.drawResult.grid), `recalc[0..4]=${recalcGrid.slice(0, 5)} resp[0..4]=${r1.json.drawResult.grid.slice(0, 5)}`);

// 3. 部分赢：押互补 big + small（必中其一）
console.log('\n== 部分赢（总和大小互补必中其一）==');
const r3 = await play({ bets: { big: 10, small: 10 }, idempotencyKey: kkey('bs') });
const bigHit = r3.json.perKeyOutcome.big.outcome === 'hit', smallHit = r3.json.perKeyOutcome.small.outcome === 'hit';
check('大小必中且仅中其一（部分赢）', bigHit !== smallHit, `big=${r3.json.perKeyOutcome.big.outcome} small=${r3.json.perKeyOutcome.small.outcome} total=${r3.json.drawResult.total}`);
check('部分赢总派息 = 命中侧 10×1.95 = 19.50', Number(r3.json.totalPayout) === 19.5, `total=${r3.json.totalPayout}`);

// 4. 段位带命中：循环凑一局 zone-euro 命中（总和 113-129），验该段赔率
console.log('\n== 段位带命中（循环凑 zone-euro）==');
let zWin = null, zTries = 0;
for (; zTries < 100 && !zWin; zTries++) {
  const r = await play({ bets: { 'zone-euro': 5 }, idempotencyKey: kkey('z') });
  if (r.json.perKeyOutcome['zone-euro'].outcome === 'hit') zWin = r;
}
if (zWin) {
  const t = zWin.json.drawResult.total;
  check(`段位带 zone-euro 命中（总和=${t} ∈ 113-129）→ 派息 5×${ODDS.mid}`, t >= 113 && t <= 129 && zWin.json.perKeyOutcome['zone-euro'].payout === Math.round(5 * ODDS.mid * 100) / 100, `total=${t} payout=${zWin.json.perKeyOutcome['zone-euro'].payout}`);
  console.log(`  （${zTries} 次凑到 zone-euro，总和 ${t}）`);
} else { check('段位带 zone-euro 命中（100 次未凑到，跳过）', false, '异常：P≈0.381 应命中'); }

// 5. 行式命中：押 L2-big + L2-small（互补必中其一），验按第 2 行和判定
console.log('\n== 行式命中（L2 大小互补，按第 2 行和判定）==');
const r5 = await play({ bets: { 'L2-big': 5, 'L2-small': 5 }, idempotencyKey: kkey('row') });
const rs2 = r5.json.drawResult.rowSums[1];
const l2big = r5.json.perKeyOutcome['L2-big'].outcome === 'hit', l2small = r5.json.perKeyOutcome['L2-small'].outcome === 'hit';
check(`L2 大小互补必中其一（第 2 行和=${rs2}，≥23 大 / ≤22 小）`, l2big !== l2small && (rs2 >= 23 ? l2big : l2small), `rowSum2=${rs2} L2-big=${r5.json.perKeyOutcome['L2-big'].outcome} L2-small=${r5.json.perKeyOutcome['L2-small'].outcome}`);

// 6. 总额风控 + 防负注 + 防假 key
console.log('\n== 风控 + 防负注 + 防假 key ==');
const over = await play({ bets: { big: 60, small: 60 }, idempotencyKey: kkey('over') });
check('Σ注额 120 > maxBet100 → 400 bet_above_max', over.status === 400 && over.code === 'bet_above_max', `${over.status}/${over.code}`);
const neg = await play({ bets: { big: -50, small: 10 }, idempotencyKey: kkey('neg') });
check('负注额 {big:-50} → 400', neg.status === 400, `${neg.status} ${neg.json?.error}`);
const badKey = await play({ bets: { 'zone-relegation': 10 }, idempotencyKey: kkey('bk') });
check('非法 key {zone-relegation}（段位只 releg/mid/euro/champ）→ 400', badKey.status === 400, `${badKey.status} ${badKey.json?.error}`);
const badKey2 = await play({ bets: { 'L6-big': 10 }, idempotencyKey: kkey('bk2') });
check('非法 key {L6-big}（行式只 L1-5）→ 400', badKey2.status === 400, `${badKey2.status}`);

// 7. 防作弊：塞假 grid/payout → 服务端覆盖
console.log('\n== 防作弊 ==');
const cheat = await play({ bets: { big: 10 }, drawResult: { grid: Array.from({ length: 25 }, () => 9), rowSums: [45, 45, 45, 45, 45], total: 225 }, perKeyOutcome: { big: { outcome: 'hit', payout: 99999 } }, totalPayout: 99999, idempotencyKey: kkey('cheat') });
const trueRow = await dbSeed(cheat.json.roundId);
const trueGrid = drawGrid(makeSeededRng(trueRow.server_seed, cheat.json.clientSeed, cheat.json.nonce));
check('前端塞假 grid/payout 被忽略，服务端自算', JSON.stringify(cheat.json.drawResult.grid) === JSON.stringify(trueGrid) && Number(cheat.json.totalPayout) !== 99999, `serverTotal=${cheat.json.drawResult.total} total=${cheat.json.totalPayout}`);

// 8. nonce 递增
console.log('\n== nonce ==');
const seq = [];
for (let i = 0; i < 3; i++) { const r = await play({ bets: { big: 1 }, idempotencyKey: kkey('seq') }); seq.push(r.json.nonce); }
check('连打 3 注 nonce 递增', seq[1] === seq[0] + 1 && seq[2] === seq[1] + 1, `nonces=[${seq.join(',')}]`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
