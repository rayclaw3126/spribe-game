// hilo 风控 cap 语义修正 smoke（真机 + 注入 cum + 确定性输牌）。
// 覆盖：a) 注入 cum>500 cashout → 恰拿 50000 钳制，status=cashed，ledger=50000，余额平
//       b) 触顶局兑现后不再占敞口（playing 查不到）  c) 小倍数 cashout 引擎逐位一致
//       d) bust 路径归 0（回归）  e) bet101 拒 / bet100 过
// 玩家 alice(player_id=1)。不 commit。
import { pool, query } from '../src/db.js';
import { deriveCard, stepMult } from '../src/game/hilo.js';

const BASE = 'http://localhost:4000';
let allPass = true, uid = 0;
const kkey = (p) => `hilocap-${p}-${Date.now()}-${uid++}`;
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
// 复刻 computeOpenExposure 的 playing 查询口径（验 b：兑现后不再计敞口）
const openHilo = async () => (await query("SELECT count(*)::int n FROM rounds WHERE player_id=1 AND game IN('mines','hilo','goal') AND status='playing'")).rows[0].n;

await query('UPDATE wallets SET balance=1000000 WHERE player_id=1');
await query("UPDATE rounds SET status='cashed' WHERE player_id=1 AND game IN('mines','hilo','goal') AND status='playing'");

// ===== e. bet 限额闸 =====
console.log('== e. assertBetWithinLimits ==');
const b101 = await api('hilo/start', { amount: '101', idempotencyKey: kkey('e') });
check('hilo bet101 → 400 bet_above_max', b101.status === 400 && b101.code === 'bet_above_max', `HTTP ${b101.status} ${b101.code}`);
const b100 = await api('hilo/start', { amount: '100', idempotencyKey: kkey('e') });
check('hilo bet100 → 200', b100.status === 200, `HTTP ${b100.status} roundId=${b100.json?.roundId}`);
if (b100.json?.roundId) await query("UPDATE rounds SET status='cashed' WHERE id=$1", [b100.json.roundId]);

// ===== a. 注入 cum>500（bet100）cashout → 钳到 50000 =====
console.log('\n== a. 触顶钳制：注入 cum=600.15 → 恰拿 50000 ==');
{
  const st = await api('hilo/start', { amount: '100', idempotencyKey: kkey('a') });
  const roundId = st.json.roundId;
  await query("UPDATE rounds SET result = jsonb_set(result,'{cum}','600.15'::jsonb) WHERE id=$1", [roundId]);
  const balBefore = await bal();
  const openBefore = await openHilo();
  const co = await api('hilo/cashout', { roundId });
  check('cashout → 200 不抛错', co.status === 200, `HTTP ${co.status} code=${co.code}`);
  check('payout 钳到 50000（min(100*600.15,50000)）', Number(co.json?.payout) === 50000, `payout=${co.json?.payout} raw=${round2(100 * 600.15)}`);
  const stx = (await query('SELECT status, payout FROM rounds WHERE id=$1', [roundId])).rows[0];
  check("落库 status='cashed' 且 payout=50000", stx.status === 'cashed' && Number(stx.payout) === 50000, `status=${stx.status} payout=${stx.payout}`);
  const lg = await ledgerFor(roundId, 'hilo_payout');
  check('ledger hilo_payout credit = 50000', lg && Number(lg.amount) === 50000, `ledger=${lg?.amount}`);
  check('余额平 = before + 50000', round2(await bal()) === round2(balBefore + 50000), `before=${balBefore} after=${await bal()}`);
  // b. 兑现后不再占敞口（playing 计数应回落，且此局不在 playing 集）
  const openAfter = await openHilo();
  const stillPlaying = (await query("SELECT count(*)::int n FROM rounds WHERE id=$1 AND status='playing'", [roundId])).rows[0].n;
  check('b) 触顶局兑现后不占敞口（不在 playing 集）', stillPlaying === 0 && openAfter === openBefore - 1, `openBefore=${openBefore} openAfter=${openAfter} thisPlaying=${stillPlaying}`);
}

// ===== c. 小倍数 cashout → 引擎逐位一致（回归）=====
console.log('\n== c. 小倍数 cashout 引擎逐位一致 ==');
{
  const st = await api('hilo/start', { amount: '100', idempotencyKey: kkey('c') });
  const roundId = st.json.roundId;
  const cum = 3.517934;   // 任意小倍数，全精度
  await query("UPDATE rounds SET result = jsonb_set(result,'{cum}',$2::jsonb) WHERE id=$1", [roundId, JSON.stringify(cum)]);
  const expPayout = round2(100 * cum);   // 引擎口径 round(bet*cum,2)，未触顶不钳
  const balBefore = await bal();
  const co = await api('hilo/cashout', { roundId });
  check('未触顶 payout = round(bet*cum,2)（钳制无误伤）', Number(co.json?.payout) === expPayout, `payout=${co.json?.payout} exp=${expPayout}`);
  check('余额平', round2(await bal()) === round2(balBefore + expPayout), `before=${balBefore} after=${await bal()}`);
}

// ===== d. bust 路径 → 归 0（回归，确定性输牌）=====
console.log('\n== d. bust 路径归 0 ==');
{
  const st = await api('hilo/start', { amount: '100', idempotencyKey: kkey('d') });
  const roundId = st.json.roundId;
  const rr = (await query('SELECT server_seed, client_seed, result FROM rounds WHERE id=$1', [roundId])).rows[0];
  const r = rr.result;
  const nextCard = deriveCard(rr.server_seed, rr.client_seed, r.nonce, r.step + 1);
  // 构造必输：把明牌 card 设成让所选方向确定性判负（high 赢需 next>=card）
  let card, dir;
  if (nextCard < 13) { card = nextCard + 1; dir = 'high'; }   // next < card → high 负
  else { card = nextCard - 1; dir = 'low'; }                  // next(13) > card → low 负
  await query("UPDATE rounds SET result = jsonb_set(result,'{card}',$2::jsonb) WHERE id=$1", [roundId, JSON.stringify(card)]);
  const balBefore = await bal();
  const g = await api('hilo/guess', { roundId, dir });
  check('猜错 → correct=false（bust）', g.status === 200 && g.json?.correct === false, `correct=${g.json?.correct} next=${g.json?.card}`);
  const stx = (await query('SELECT status, payout FROM rounds WHERE id=$1', [roundId])).rows[0];
  check("落库 status='bust' payout=0", stx.status === 'bust' && Number(stx.payout) === 0, `status=${stx.status} payout=${stx.payout}`);
  check('bust 不加钱（余额仅早前 -100 的注，兑现前已扣；此处不变）', round2(await bal()) === round2(balBefore), `before=${balBefore} after=${await bal()}`);
  const co = await api('hilo/cashout', { roundId });
  check('bust 后 cashout → 400 无法兑现', co.status === 400, `HTTP ${co.status}`);
}

// 还原
await query("UPDATE rounds SET status='cashed' WHERE player_id=1 AND game IN('mines','hilo','goal') AND status='playing'");
await query('UPDATE wallets SET balance=462.74 WHERE player_id=1');
console.log(`\n${allPass ? '✅ ALL PASS' : '❌ SOME FAIL'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
