// plinko/mines 风控 cap 语义修正 smoke（真机 + 引擎对拍 + 注入边缘结果）。
// 覆盖：a) plinko red/16 满赔落袋不抛错  b) plinko 普通结果引擎逐位一致
//       c) mines cashout >500× 恰拿 50000(钳制) + ledger/余额对账
//       d) mines 小倍数兑现金额不变(回归)  e) 额外：揭满自动结算@2172 同钳制
//       f) assertBetWithinLimits: bet101 拒 / bet100 过
// 玩家 alice(player_id=1)。不 commit。
import { pool, query } from '../src/db.js';
import { multsFor, derivePath } from '../src/game/plinko.js';
import { calcMultiplier, GRID } from '../src/game/mines.js';
import { maxPayoutFor } from '../src/lib/risk.js';

const BASE = 'http://localhost:4000';
let allPass = true;
let uid = 0;
const kkey = (p) => `pmcap-${p}-${Date.now()}-${uid++}`;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const round2 = (x) => Math.round(x * 100) / 100;

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const api = async (path, body) => {
  const r = await fetch(`${BASE}/round/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, code: j?.code ?? null, json: j };
};
const bal = async () => Number((await query('SELECT balance FROM wallets WHERE player_id=1')).rows[0].balance);
const ledgerFor = async (roundId, type) => (await query('SELECT amount FROM ledger WHERE round_id=$1 AND type=$2 ORDER BY id DESC LIMIT 1', [String(roundId), type])).rows[0];

console.log('cap:', maxPayoutFor('plinko'), '/', maxPayoutFor('mines'), '（plinko/mines maxPayout）\n');
// 充值保证测试有钱（delta 对账，与起点绝对值无关）
await query('UPDATE wallets SET balance=1000000 WHERE player_id=1');
// 清理 alice 遗留未结算局，防敞口闸误伤本测试
await query("UPDATE rounds SET status='cashed' WHERE player_id=1 AND game IN('mines','hilo','goal') AND status='playing'");

// ===== f. bet 限额闸（bet101 拒 / bet100 过）=====
console.log('== f. assertBetWithinLimits ==');
const pf101 = await api('plinko/play', { amount: '101', risk: 'green', rows: 8, idempotencyKey: kkey('pf') });
check('plinko bet101 → 400 bet_above_max', pf101.status === 400 && pf101.code === 'bet_above_max', `HTTP ${pf101.status} ${pf101.code}`);
const pf100 = await api('plinko/play', { amount: '100', risk: 'green', rows: 8, idempotencyKey: kkey('pf') });
check('plinko bet100 → 200', pf100.status === 200, `HTTP ${pf100.status} payout=${pf100.json?.payout}`);
const mf101 = await api('mines/start', { amount: '101', mines: 3, idempotencyKey: kkey('mf') });
check('mines bet101 → 400 bet_above_max', mf101.status === 400 && mf101.code === 'bet_above_max', `HTTP ${mf101.status} ${mf101.code}`);
const mf100 = await api('mines/start', { amount: '100', mines: 3, idempotencyKey: kkey('mf') });
check('mines bet100 → 200', mf100.status === 200, `HTTP ${mf100.status} roundId=${mf100.json?.roundId}`);
if (mf100.json?.roundId) await query("UPDATE rounds SET status='cashed' WHERE id=$1", [mf100.json.roundId]); // 清理

// ===== b. plinko 普通结果引擎逐位一致（多档多行回归）=====
console.log('\n== b. plinko 普通结果 vs 引擎逐位一致 ==');
let bAll = true, bN = 0;
for (const risk of ['green', 'yellow', 'red']) for (const rows of [8, 12, 16]) for (let k = 0; k < 3; k++) {
  const r = await api('plinko/play', { amount: '100', risk, rows, idempotencyKey: kkey('b') });
  if (r.status !== 200) { bAll = false; console.log(`  FAIL ${risk}/${rows} HTTP ${r.status}`); continue; }
  const { bucket, mult, payout } = r.json;
  const engMult = multsFor(rows, risk)[bucket];
  const expPayout = Math.min(Math.trunc(100 * engMult * 100) / 100, maxPayoutFor('plinko')); // LEAST(trunc(100*mult,2),cap)
  const ok = Number(mult) === engMult && Number(payout) === expPayout;
  if (!ok) { bAll = false; console.log(`  FAIL ${risk}/${rows} bucket=${bucket} mult=${mult}(eng ${engMult}) payout=${payout}(exp ${expPayout})`); }
  bN++;
}
check(`plinko ${bN} 注 mult/payout 全部逐位命中引擎（含 LEAST 口径）`, bAll);

// ===== a. plinko red/16 满赔（bucket 边缘 425×）→ payout 42500 落袋不抛错（注入 nonce）=====
console.log('\n== a. plinko red/16 满赔 42500 落袋不抛错 ==');
const seed = (await query("SELECT server_seed, client_seed, nonce FROM player_seeds WHERE player_id=1 AND status='active'")).rows[0];
let hitN = -1;
for (let N = Number(seed.nonce) + 2; N < Number(seed.nonce) + 2 + 2000000; N++) {
  const p = derivePath(seed.server_seed, seed.client_seed, N, 16);
  const b = p.reduce((a, c) => a + c, 0);
  if (b === 0 || b === 16) { hitN = N; break; } // 边缘 bucket → red/16 顶倍 425×
}
if (hitN < 0) { check('爆破到 red/16 边缘 nonce', false, '2M 内未命中（极罕见）'); }
else {
  await query("UPDATE player_seeds SET nonce=$1 WHERE player_id=1 AND status='active'", [hitN - 1]); // 下注 claimNonce 会 +1 → hitN
  const balBefore = await bal();
  const r = await api('plinko/play', { amount: '100', risk: 'red', rows: 16, idempotencyKey: kkey('a') });
  const engMax = Math.max(...multsFor(16, 'red')); // 425
  check('red/16 满赔注 → 200 不抛错', r.status === 200, `HTTP ${r.status} code=${r.code}`);
  check(`bucket 边缘 & mult=${engMax}×（引擎顶倍）`, r.json?.mult === engMax && (r.json?.bucket === 0 || r.json?.bucket === 16), `bucket=${r.json?.bucket} mult=${r.json?.mult}`);
  check('payout=42500 落袋（min(42500,50000)，钳制不触发）', Number(r.json?.payout) === 42500, `payout=${r.json?.payout}`);
  check('余额对账 = before -100 +42500', round2(await bal()) === round2(balBefore - 100 + 42500), `before=${balBefore} after=${await bal()}`);
  const lg = await ledgerFor(r.json?.roundId, 'plinko_payout');
  check('ledger plinko_payout = 42500', lg && Number(lg.amount) === 42500, `ledger=${lg?.amount}`);
}
// plinko 钳制表达式本体证明（真实路径 maxBet=100 顶到 42500<cap 不触发，直接跑同款 SQL 证钳制生效）
const clampProof = (await query('SELECT LEAST(trunc($1::numeric*$2::numeric,2),$3::numeric) AS p', ['1000', '425', String(maxPayoutFor('plinko'))])).rows[0].p;
check('plinko 钳制表达式证明：LEAST(trunc(1000*425),50000)=50000', Number(clampProof) === 50000, `=${clampProof}`);

// ===== c. mines cashout 累积 >500× → 恰拿 50000（钳制）+ ledger/余额对账 =====
console.log('\n== c. mines cashout >500× → 钳到 50000 ==');
{
  const mineCount = 5;
  const st = await api('mines/start', { amount: '100', mines: mineCount, idempotencyKey: kkey('c') });
  const roundId = st.json.roundId;
  const mines = (await query('SELECT result FROM rounds WHERE id=$1', [roundId])).rows[0].result.mines;
  const safeCells = Array.from({ length: GRID }, (_, i) => i).filter((i) => !mines.includes(i));
  // 找到使 mult>500 的最小 gems
  let g = 1; while (calcMultiplier(g, mineCount) <= 500) g++;
  const revealed = safeCells.slice(0, g);
  const injMult = calcMultiplier(g, mineCount);
  await query("UPDATE rounds SET result = jsonb_set(result,'{revealed}',$2::jsonb) WHERE id=$1", [roundId, JSON.stringify(revealed)]);
  const balBefore = await bal();
  const co = await api('mines/cashout', { roundId });
  check(`注入 gems=${g} → mult=${round2(injMult)}× (>500)`, injMult > 500);
  check('cashout → 200 不抛错', co.status === 200, `HTTP ${co.status} code=${co.code}`);
  check('payout 钳到 50000（min(100*mult,50000)）', Number(co.json?.payout) === 50000, `payout=${co.json?.payout} raw=${round2(100 * injMult)}`);
  check('余额对账 = before +50000', round2(await bal()) === round2(balBefore + 50000), `before=${balBefore} after=${await bal()}`);
  const lg = await ledgerFor(roundId, 'mines_payout');
  check('ledger mines_payout credit = 50000', lg && Number(lg.amount) === 50000, `ledger=${lg?.amount}`);
}

// ===== d. mines 小倍数兑现 → 金额不变（回归，不误伤）=====
console.log('\n== d. mines 小倍数兑现金额不变（回归）==');
{
  const mineCount = 3;
  const st = await api('mines/start', { amount: '100', mines: mineCount, idempotencyKey: kkey('d') });
  const roundId = st.json.roundId;
  const mines = (await query('SELECT result FROM rounds WHERE id=$1', [roundId])).rows[0].result.mines;
  const safeCells = Array.from({ length: GRID }, (_, i) => i).filter((i) => !mines.includes(i));
  const g = 2; // 小倍数
  const revealed = safeCells.slice(0, g);
  const engMult = calcMultiplier(g, mineCount);
  const expPayout = round2(100 * engMult); // 未触顶，钳制不改
  await query("UPDATE rounds SET result = jsonb_set(result,'{revealed}',$2::jsonb) WHERE id=$1", [roundId, JSON.stringify(revealed)]);
  const balBefore = await bal();
  const co = await api('mines/cashout', { roundId });
  check(`小倍数 gems=${g} mult=${round2(engMult)}× payout 不触顶`, expPayout < 50000);
  check('payout = 引擎 round(100*mult,2)（钳制无误伤）', Number(co.json?.payout) === expPayout, `payout=${co.json?.payout} exp=${expPayout}`);
  check('余额对账 = before +payout', round2(await bal()) === round2(balBefore + expPayout), `before=${balBefore} after=${await bal()}`);
}

// ===== e. 额外：mines 揭满自动结算@2172 同钳制（reveal 触发全清）=====
console.log('\n== e. mines 揭满自动结算@2172 同钳制 ==');
{
  const mineCount = 5; // 满清 28892× → 钳 50000
  const st = await api('mines/start', { amount: '100', mines: mineCount, idempotencyKey: kkey('e') });
  const roundId = st.json.roundId;
  const mines = (await query('SELECT result FROM rounds WHERE id=$1', [roundId])).rows[0].result.mines;
  const safeCells = Array.from({ length: GRID }, (_, i) => i).filter((i) => !mines.includes(i));
  // 预注入除最后一格外的所有安全格，再 reveal 最后一格触发揭满自动结算
  const preRevealed = safeCells.slice(0, safeCells.length - 1);
  const lastSafe = safeCells[safeCells.length - 1];
  await query("UPDATE rounds SET result = jsonb_set(result,'{revealed}',$2::jsonb) WHERE id=$1", [roundId, JSON.stringify(preRevealed)]);
  const balBefore = await bal();
  const rv = await api('mines/reveal', { roundId, cell: lastSafe });
  const fullMult = calcMultiplier(safeCells.length, mineCount);
  check(`满清 mult=${Math.round(fullMult)}× (>500)`, fullMult > 500);
  check('reveal 揭满 → 200 cleared 不抛错', rv.status === 200 && rv.json?.cleared === true, `HTTP ${rv.status} cleared=${rv.json?.cleared}`);
  check('揭满 payout 钳到 50000', Number(rv.json?.payout) === 50000, `payout=${rv.json?.payout}`);
  check('余额对账 = before +50000', round2(await bal()) === round2(balBefore + 50000), `before=${balBefore} after=${await bal()}`);
}

console.log(`\n${allPass ? '✅ ALL PASS' : '❌ SOME FAIL'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
