// limbo cap 钳制 + 前端 target 封顶 + HiLo 前端显示 对拍 smoke（真机 + 爆破中奖 nonce 注入）。
// a. limbo bet200 target=300 中奖 → payout 钳 50000 落袋，落库/ledger/余额平
// b. limbo 常规小 target 中奖 → payout 逐位=引擎 trunc(bet×target)（回归）
// c. 前端表达式对拍：Limbo maxTarget/applyTarget（bet200 → target 钳 250）
// d. HiLo 前端表达式对拍：cum>500 按钮显 50000 / WinToast=data.payout
// f. dice 拒绝型核数（真实引擎 payoutFor，报最大顶赔）
// 玩家 alice(player_id=1)。不 commit。
import { pool, query } from '../src/db.js';
import { deriveMult, judge as judgeLimbo } from '../src/game/limbo.js';
import { payoutFor as dicePayoutFor } from '../src/game/dice.js';
import { maxPayoutFor } from '../src/lib/risk.js';

const BASE = 'http://localhost:4000';
let allPass = true, uid = 0;
const kkey = (p) => `limbocap-${p}-${Date.now()}-${uid++}`;
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
const activeSeed = async () => (await query("SELECT server_seed, client_seed, nonce FROM player_seeds WHERE player_id=1 AND status='active'")).rows[0];
// 爆破：从 seed 固定，找一个使 deriveMult>=target 的 nonce（中奖），设 nonce=N-1 使下注 claimNonce→N
async function forceWinNonce(target) {
  const s = await activeSeed();
  for (let N = Number(s.nonce) + 2; N < Number(s.nonce) + 2 + 5000000; N++) {
    if (judgeLimbo(deriveMult(s.server_seed, s.client_seed, N), target)) {
      await query("UPDATE player_seeds SET nonce=$1 WHERE player_id=1 AND status='active'", [N - 1]);
      return { N, finalMult: deriveMult(s.server_seed, s.client_seed, N) };
    }
  }
  return null;
}

await query('UPDATE wallets SET balance=1000000 WHERE player_id=1');
await query("UPDATE rounds SET status='cashed' WHERE player_id=1 AND game IN('mines','hilo','goal') AND status='playing'");

// ===== a. limbo bet200 target=300 中奖 → payout 钳 50000 =====
console.log('== a. limbo 触顶钳制：bet200 target300 中奖 → 50000 ==');
{
  const bet = 200, target = 300;   // bet×target=60000 > cap 50000
  const w = await forceWinNonce(target);
  check('爆破到中奖 nonce（finalMult>=300）', !!w && w.finalMult >= target, w ? `finalMult=${w.finalMult}` : '未命中');
  const balBefore = await bal();
  const r = await api('limbo/play', { amount: String(bet), target, idempotencyKey: kkey('a') });
  check('中奖注 → 200 不抛错（原拒绝型会 payout_over_cap）', r.status === 200, `HTTP ${r.status} code=${r.code}`);
  check('win=true', r.json?.win === true, `win=${r.json?.win} finalMult=${r.json?.finalMult}`);
  check('payout 钳到 50000（min(200*300,50000)）', Number(r.json?.payout) === 50000, `payout=${r.json?.payout} raw=${bet * target}`);
  const stx = (await query('SELECT payout FROM rounds WHERE id=$1', [r.json?.roundId])).rows[0];
  check('落库 payout=50000（钳后值）', Number(stx.payout) === 50000, `db=${stx.payout}`);
  const lg = await ledgerFor(r.json?.roundId, 'limbo_payout');
  check('ledger limbo_payout=50000', lg && Number(lg.amount) === 50000, `ledger=${lg?.amount}`);
  check('余额平 = before -200 +50000', round2(await bal()) === round2(balBefore - bet + 50000), `before=${balBefore} after=${await bal()}`);
}

// ===== b. limbo 常规小 target 中奖 → 引擎逐位（回归）=====
console.log('\n== b. limbo 常规小 target 中奖 逐位=引擎 ==');
{
  const bet = 200, target = 2;   // bet×target=400 < cap，不钳
  const w = await forceWinNonce(target);
  const r = await api('limbo/play', { amount: String(bet), target, idempotencyKey: kkey('b') });
  const expPayout = round2(Math.trunc(bet * target * 100) / 100);   // trunc(bet×target,2)，未触顶
  check('win=true', r.json?.win === true, `finalMult=${r.json?.finalMult}`);
  check('payout = trunc(bet×target,2)（钳制无误伤）', Number(r.json?.payout) === expPayout, `payout=${r.json?.payout} exp=${expPayout}`);
}

// ===== c. 前端 Limbo target 封顶表达式对拍 =====
console.log('\n== c. 前端 Limbo maxTarget/applyTarget 对拍 ==');
{
  const MAX_PAYOUT = 50000;   // 与 Limbo.jsx 常量一致
  const maxTarget = (bet) => Math.max(1.01, Math.floor((MAX_PAYOUT / Math.max(bet, 1)) * 100) / 100);
  const applyTarget = (bet, v) => Math.min(Math.max(1.01, Number(v) || 1.01), maxTarget(bet));
  check('bet200 → maxTarget=250.00', maxTarget(200) === 250, `${maxTarget(200)}`);
  check('bet200 输入 300 → 钳到 250', applyTarget(200, 300) === 250, `${applyTarget(200, 300)}`);
  check('bet200 输入 100 → 保持 100（未超上限）', applyTarget(200, 100) === 100, `${applyTarget(200, 100)}`);
  check('bet10 → maxTarget=5000.00', maxTarget(10) === 5000, `${maxTarget(10)}`);
  // 与后端一致性：钳后 target × bet ≤ cap
  check('钳后 bet×maxTarget ≤ 50000', 200 * maxTarget(200) <= MAX_PAYOUT && 10 * maxTarget(10) <= MAX_PAYOUT);
}

// ===== d. 前端 HiLo 显示对拍（真机注入 cum，前端表达式原样）=====
console.log('\n== d. 前端 HiLo 按钮/WinToast 对拍 ==');
{
  const MAX_PAYOUT = 50000;
  const buttonLabel = (bet, cum) => `${round2(Math.min(bet * cum, MAX_PAYOUT)).toFixed(2)} USD`;   // HiLo.jsx 按钮
  const winToast = (payout) => `WIN +${round2(Number(payout)).toFixed(2)} USD`;                     // HiLo.jsx pushWin
  // 高 cum：注入 cum=600.15，bet100 → 后端钳 50000
  const st = await api('hilo/start', { amount: '100', idempotencyKey: kkey('d') });
  const roundId = st.json.roundId;
  await query("UPDATE rounds SET result = jsonb_set(result,'{cum}','600.15'::jsonb) WHERE id=$1", [roundId]);
  const co = await api('hilo/cashout', { roundId });
  check('后端 data.payout=50000（钳后）', Number(co.json?.payout) === 50000, `payout=${co.json?.payout}`);
  check('前端按钮显 50000.00 USD（Math.min 钳）', buttonLabel(100, 600.15) === '50000.00 USD', buttonLabel(100, 600.15));
  check('前端 WinToast=WIN +50000.00 USD（认 data.payout）', winToast(co.json?.payout) === 'WIN +50000.00 USD', winToast(co.json?.payout));
  check('对照：旧本地 bet×cum 会显 60015（错），已弃用', round2(100 * 600.15) !== 50000, `旧值=${round2(100 * 600.15)}`);
}

// ===== f. dice 拒绝型核数（真实引擎）=====
console.log('\n== f. dice 拒绝型核数 ==');
{
  const maxMult = dicePayoutFor(4);   // min chance=4（target4 under / target96 over）→ 最大 mult
  const diceMaxBet = 500;
  const maxPayout = maxMult * diceMaxBet;
  console.log(`  dice 最大单注 mult = payoutFor(4) = ${maxMult}×；maxBet ${diceMaxBet} → 顶赔 ${maxPayout}`);
  check(`dice 顶赔 ${maxPayout} < cap 50000 → 拒绝型安全，保留不改`, maxPayout < 50000, `顶赔=${maxPayout}`);
}

await query("UPDATE rounds SET status='cashed' WHERE player_id=1 AND game IN('mines','hilo','goal') AND status='playing'");
await query('UPDATE wallets SET balance=462.74 WHERE player_id=1');
console.log(`\n${allPass ? '✅ ALL PASS' : '❌ SOME FAIL'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
