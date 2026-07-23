// #公期化 单1b 验收 smoke（六断言）—— 滚球公期局下注端点 POST /round/rollingball/bet。
//
//  ① 三窗按球限盘：bet_k 窗只收 b{k}: 键，跨窗键 4xx 明确错误码（三窗各验）
//  ② 死键拒：已开号 bN:num-X 拒；c_k=0 组合键判据（引擎侧离线证，3 球局物理不可达，见断言注释）
//  ③ betsLocked 缓冲期 / draw 段投注 → 409 round_locked
//  ④ 钱层：即扣 balanceAfter 对 / 同 idempotencyKey 重放 idempotent:true 不双扣 /
//         amount≤0·假键·键数超限·Σ超 maxBet 全拒且拒在 debit 前（余额零变）
//  ⑤ 结算闭环：三窗各真投 → settle 后逐键派彩 == hitsForBalls+oddsByKey 离线复算，
//         ledger rollingball_bet/_payout 齐，增量对账 RECON OK
//  ⑥ 老 per-player /rollingball/play 真跑一局（三球）不回归
//
// 前置：服务端已起在 :4000，alice/alice123 可登录，DB 可直连。本脚本只调 HTTP/WS，不直接写库。
import { execSync } from 'node:child_process';
import WebSocket from 'ws';
import { pool, query } from '../src/db.js';
import * as RB from '../src/game/rollingBall.js';

const BASE = 'http://localhost:4000';
const WSBASE = 'ws://localhost:4000';
const ALICE_ID = 1;

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (x) => Number(x).toFixed(2);

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }),
  });
  return (await r.json()).token;
})();
if (!token) { console.log('FAIL 登录 alice 失败'); await pool.end(); process.exit(1); }

let seq = 0;
const nextKey = (tag) => `rb1b-${Date.now()}-${++seq}-${tag}`;
async function betRB(bets, idempotencyKey = nextKey('x')) {
  const r = await fetch(`${BASE}/round/rollingball/bet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ bets, idempotencyKey }),
  });
  let j = null; try { j = await r.json(); } catch { /* 空体 */ }
  return { status: r.status, json: j, idempotencyKey };
}
const balance = async () => (await query('SELECT balance FROM wallets WHERE player_id = $1', [ALICE_ID])).rows[0].balance;

function openClient(qs) {
  const ws = new WebSocket(`${WSBASE}/ws/rounds?token=${encodeURIComponent(token)}${qs}`);
  const msgs = [], waiters = [];
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    m._at = Date.now(); msgs.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
  });
  const ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return {
    ws, msgs, ready,
    waitFor: (pred, timeout = 80000) => new Promise((resolve, reject) => {
      const hit = msgs.find(pred); if (hit) return resolve(hit);
      const t = setTimeout(() => reject(new Error('waitFor timeout')), timeout);
      waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    }),
    close: () => { try { ws.close(); } catch { /* 已断 */ } },
  };
}

const W = openClient('&game=rollingball');
await W.ready;
const maxLedgerBefore = Number((await query('SELECT MAX(id) mx FROM ledger')).rows[0].mx);

// —— 找一个【剩余时间够跑完整轮测试】的 bet1 窗（>7s）——
let bet1 = await W.waitFor((m) => m.type === 'phase' && m.phase === 'bet1', 80000);
if (bet1.endsAt - Date.now() < 7000) {
  bet1 = await W.waitFor((m) => m.type === 'phase' && m.phase === 'bet1' && m.roundNo !== bet1.roundNo, 80000);
}
const roundNo = bet1.roundNo, roundId = bet1.roundId;
console.log(`\n投注期号 ${roundNo}（roundId=${roundId}），bet1 窗余 ${bet1.endsAt - Date.now()}ms`);

// ══════════════ ①④ bet1 窗：真投 + 跨窗拒 + 攻击面 ══════════════
console.log('\n========== [①④] bet1 窗：白名单 + 钱层 + 多注 map 攻击面 ==========');
const bal0 = await balance();
const REAL1 = nextKey('real1');
const r1 = await betRB({ 'b1:big': 2 }, REAL1);
check('① bet1 窗投 b1:big → 200 accepted 且 ballIndex=0 / 挂当期 roundId',
  r1.status === 200 && r1.json?.accepted === true && r1.json.ballIndex === 0 && String(r1.json.roundId) === String(roundId),
  `status=${r1.status} json=${JSON.stringify(r1.json)}`);
check('⑤ 响应带该窗 odds 快照（display 用）',
  typeof r1.json?.odds?.['b1:big'] === 'number' && r1.json.odds['b1:big'] > 1, `odds=${JSON.stringify(r1.json?.odds)}`);
const bal1 = await balance();
check('④ 即扣：balanceAfter == 库内余额 == 扣前 - 2.00',
  money(r1.json?.balanceAfter) === money(bal1) && money(bal1) === money(Number(bal0) - 2),
  `before=${bal0} after=${bal1} resp=${r1.json?.balanceAfter}`);

// 跨窗拒（bet1 窗投 b2:/b3:）
for (const k of ['b2:red', 'b3:red']) {
  const rr = await betRB({ [k]: 2 });
  check(`① bet1 窗投 ${k} → 400 明确错误（本窗只收第 1 球盘口）`,
    rr.status === 400 && /本窗只收第 1 球盘口/.test(rr.json?.error || ''), `status=${rr.status} err=${rr.json?.error}`);
}
// 幂等重放
const replay = await betRB({ 'b1:big': 2 }, REAL1);
check('④ 同 idempotencyKey 重放 → idempotent:true 且不双扣',
  replay.status === 200 && replay.json?.idempotent === true && money(await balance()) === money(bal1),
  `json=${JSON.stringify(replay.json)} bal=${await balance()}`);

// 攻击面（全部必须拒在 debit 之前 → 余额零变）
const ATTACKS = [
  ['amount = 0', { 'b1:small': 0 }, /下注金额必须 > 0/],
  ['amount 负数', { 'b1:small': -5 }, /下注金额必须 > 0/],
  ['amount 非数字', { 'b1:small': 'abc' }, /下注金额必须 > 0/],
  ['假键（裸 key 无球序前缀）', { big: 2 }, /非法盘口 key/],
  ['假键（越界球序 b4:）', { 'b4:big': 2 }, /非法盘口 key/],
  ['假键（裸键非法 num-99）', { 'b1:num-99': 2 }, /非法盘口 key/],
  ['bets 为数组', [{ 'b1:big': 2 }], /bets 必须是/],
  ['bets 为空对象', {}, /bets 不能为空/],
  ['键数超限（94 > 93）', Object.fromEntries(Array.from({ length: 94 }, (_, i) => [`b1:num-${i + 1}`, 1])), /下注项过多/],
  ['Σ 超 maxBet(100)', { 'b1:big': 60, 'b1:small': 60 }, /Max bet|bet_above_max/],
];
for (const [name, body, re] of ATTACKS) {
  const rr = await betRB(body);
  const balNow = await balance();
  check(`④ ${name} → 4xx 拒 且拒在 debit 前（余额零变）`,
    rr.status >= 400 && rr.status < 500 && re.test(JSON.stringify(rr.json)) && money(balNow) === money(bal1),
    `status=${rr.status} body=${JSON.stringify(rr.json)} bal=${balNow}`);
}

// ══════════════ ③ betsLocked 缓冲期 + draw 段 ══════════════
console.log('\n========== [③] locked 缓冲期 / draw 段 → 409 round_locked ==========');
await sleep(Math.max(0, bet1.endsAt - Date.now()) + 400);   // 落进 bet1 关窗后的 2s 锁帧缓冲
const inLocked = await betRB({ 'b1:big': 2 });
check('③ bet1 窗关后的 lockedMs 缓冲期投注 → 409 round_locked',
  inLocked.status === 409 && inLocked.json?.error === 'round_locked', `status=${inLocked.status} err=${inLocked.json?.error}`);
const draw1 = await W.waitFor((m) => m.type === 'phase' && m.phase === 'draw1' && m.roundNo === roundNo, 20000);
const inDraw = await betRB({ 'b2:red': 2 });
check('③ draw1 段（非 bet 段）投注 → 409 round_locked',
  inDraw.status === 409 && inDraw.json?.error === 'round_locked', `status=${inDraw.status} err=${inDraw.json?.error}`);
check('④ 上述两次 409 余额零变（拒在 debit 前）', money(await balance()) === money(bal1), `bal=${await balance()}`);

// ══════════════ ①② bet2 窗：跨窗拒 + 死键拒 + 真投 ══════════════
console.log('\n========== [①②] bet2 窗：跨窗 + 死键（已开号）+ 真投 ==========');
const bet2 = await W.waitFor((m) => m.type === 'phase' && m.phase === 'bet2' && m.roundNo === roundNo, 20000);
const b1 = draw1.ball;
check('① bet2 窗 revealed 已含第 1 球（窗号派生源）', JSON.stringify(bet2.revealed) === JSON.stringify([b1]), `revealed=${JSON.stringify(bet2.revealed)}`);
const dead = await betRB({ [`b2:num-${b1}`]: 2 });
check(`② 死键拒：第 1 球已开出 ${b1} → b2:num-${b1} 无放回不可押 → 400`,
  dead.status === 400 && /盘口不可押/.test(dead.json?.error || ''), `status=${dead.status} err=${dead.json?.error}`);
for (const k of ['b1:red', 'b3:red']) {
  const rr = await betRB({ [k]: 2 });
  check(`① bet2 窗投 ${k} → 400 明确错误（本窗只收第 2 球盘口）`,
    rr.status === 400 && /本窗只收第 2 球盘口/.test(rr.json?.error || ''), `status=${rr.status} err=${rr.json?.error}`);
}
const REAL2 = nextKey('real2');
const r2 = await betRB({ 'b2:small': 2 }, REAL2);
check('① bet2 窗投 b2:small → 200 accepted 且 ballIndex=1',
  r2.status === 200 && r2.json?.accepted === true && r2.json.ballIndex === 1, `status=${r2.status} json=${JSON.stringify(r2.json)}`);

// ══════════════ ① bet3 窗：跨窗拒 + 真投 ══════════════
console.log('\n========== [①] bet3 窗：跨窗 + 真投 ==========');
const draw2 = await W.waitFor((m) => m.type === 'phase' && m.phase === 'draw2' && m.roundNo === roundNo, 25000);
const bet3 = await W.waitFor((m) => m.type === 'phase' && m.phase === 'bet3' && m.roundNo === roundNo, 20000);
check('① bet3 窗 revealed 已含前 2 球', JSON.stringify(bet3.revealed) === JSON.stringify([b1, draw2.ball]), `revealed=${JSON.stringify(bet3.revealed)}`);
for (const k of ['b1:red', 'b2:red']) {
  const rr = await betRB({ [k]: 2 });
  check(`① bet3 窗投 ${k} → 400 明确错误（本窗只收第 3 球盘口）`,
    rr.status === 400 && /本窗只收第 3 球盘口/.test(rr.json?.error || ''), `status=${rr.status} err=${rr.json?.error}`);
}
const deadB3 = await betRB({ [`b3:num-${draw2.ball}`]: 2 });
check(`② 死键拒：第 2 球已开出 ${draw2.ball} → b3:num-${draw2.ball} → 400`,
  deadB3.status === 400 && /盘口不可押/.test(deadB3.json?.error || ''), `status=${deadB3.status} err=${deadB3.json?.error}`);
const REAL3 = nextKey('real3');
const r3 = await betRB({ 'b3:odd': 2 }, REAL3);
check('① bet3 窗投 b3:odd → 200 accepted 且 ballIndex=2',
  r3.status === 200 && r3.json?.accepted === true && r3.json.ballIndex === 2, `status=${r3.status} json=${JSON.stringify(r3.json)}`);

// ② c_k=0 组合键：引擎侧离线证（3 球局物理不可达，故只能离线验判据）
{
  const bigOddNums = Array.from({ length: 75 }, (_, i) => i + 1).filter((n) => n >= 38 && n % 2 === 1);
  const nullWhenExhausted = RB.oddsFor('big-odd', 0, bigOddNums) === null;
  const nullWhenDrawn = RB.oddsFor('num-7', 1, [7]) === null;
  check('② c_k=0 判据（离线）：组合键剩余计数耗尽 → oddsFor 返 null → 端点必拒（同一函数同一判据）',
    nullWhenExhausted && nullWhenDrawn,
    `big-odd(c=0)=${RB.oddsFor('big-odd', 0, bigOddNums)} num-7(已开)=${RB.oddsFor('num-7', 1, [7])}`
    + '；⚠ 3 球局里组合键 c 最低只到 18-2=16，c=0 物理不可达，故无法造 live 用例');
}

// ══════════════ ⑤ 结算闭环 ══════════════
console.log('\n========== [⑤] settle 结算闭环：派彩 == 引擎离线复算 ==========');
const settle = await W.waitFor((m) => m.type === 'phase' && m.phase === 'settle' && m.roundNo === roundNo, 30000);
const balls = settle.result.revealed;
const wsResult = await W.waitFor((m) => m.type === 'result' && String(m.roundId) === String(roundId), 15000).catch(() => null);
await sleep(600);   // 让结算事务全部落库

const { hits, oddsByKey } = RB.hitsForBalls(balls);
const PLACED = [['b1:big', 2, REAL1], ['b2:small', 2, REAL2], ['b3:odd', 2, REAL3]];
let expectTotal = 0;
for (const [k, a] of PLACED) if (hits.has(k)) expectTotal = Math.round((expectTotal + a * oddsByKey[k]) * 100) / 100;
console.log(`  三球=[${balls.join(',')}]  投注=${PLACED.map(([k, a]) => `${k}$${a}`).join(' / ')}`);
console.log(`  离线复算：${PLACED.map(([k, a]) => `${k}→${hits.has(k) ? `hit×${oddsByKey[k]}=${Math.round(a * oddsByKey[k] * 100) / 100}` : 'lose'}`).join(' / ')}  合计应派 $${expectTotal}`);

const betRows = (await query(
  `SELECT id, idempotency_key, outcome, settle_detail FROM bets WHERE round_id = $1 AND player_id = $2 ORDER BY id`,
  [roundId, ALICE_ID])).rows;
check('⑤ 三窗三注全部落在同一公期 roundId 下', betRows.length === 3, `rows=${betRows.length}`);
for (const [k, a, key] of PLACED) {
  const row = betRows.find((b) => b.idempotency_key === key);
  const want = hits.has(k) ? 'win' : 'lose';
  const wantPay = hits.has(k) ? Math.round(a * oddsByKey[k] * 100) / 100 : 0;
  check(`⑤ ${k} 注行 outcome=${want} 且 settle_detail 派彩==离线复算 $${wantPay}`,
    !!row && row.outcome === want && Math.abs(Number(row.settle_detail?.[0]?.payout) - wantPay) < 0.005,
    `outcome=${row?.outcome} detail=${JSON.stringify(row?.settle_detail)}`);
}
const led = (await query('SELECT type, amount FROM ledger WHERE round_id = $1 AND player_id = $2 ORDER BY id', [roundId, ALICE_ID])).rows;
const betSum = led.filter((l) => l.type === 'rollingball_bet').reduce((s, l) => s + Number(l.amount), 0);
const paySum = led.filter((l) => l.type === 'rollingball_payout').reduce((s, l) => s + Number(l.amount), 0);
check('⑤ ledger 有 3 条 rollingball_bet（合计 $6）', led.filter((l) => l.type === 'rollingball_bet').length === 3 && Math.abs(betSum - 6) < 0.005, `types=${JSON.stringify(led)}`);
check('⑤ ledger rollingball_payout 合计 == 离线复算总派彩', Math.abs(paySum - expectTotal) < 0.005, `实派=${paySum} 复算=${expectTotal}`);
check('⑤ WS 个人 result 帧 yourResult 含三注三键（多注行合并广播）',
  !!wsResult && wsResult.yourResult?.length === 3 && Math.abs(Number(wsResult.totalPayout) - expectTotal) < 0.005,
  `yourResult=${JSON.stringify(wsResult?.yourResult)} totalPayout=${wsResult?.totalPayout}`);
check('⑤ 钱包净变化 == -6 + 派彩', Math.abs(Number(await balance()) - (Number(bal0) - 6 + expectTotal)) < 0.005,
  `bal0=${bal0} now=${await balance()} 预期=${Math.round((Number(bal0) - 6 + expectTotal) * 100) / 100}`);

// 增量对账
let reconOut = '';
try { reconOut = execSync(`node scripts/reconcile_balances.mjs --since ${maxLedgerBefore}`, { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }); }
catch (e) { reconOut = (e.stdout || '') + (e.stderr || ''); }
check('⑤ 增量对账：alice 钱包 balance==链尾，新行无 FAIL',
  /PASS\s+wallet player_id=1\b/.test(reconOut) && !/FAIL\s+row .*player_id=1\b/.test(reconOut), '');
reconOut.split('\n').filter((l) => /player_id=1\b|RECON/.test(l)).forEach((l) => console.log('   ' + l));

// ══════════════ ⑥ 老 per-player /rollingball/play 回归 ══════════════
console.log('\n========== [⑥] 老 per-player /rollingball/play 真跑一局（三球）==========');
{
  let rid = null, ok = true, detail = [];
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${BASE}/round/rollingball/play`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ roundId: rid, bets: { big: 1 }, idempotencyKey: nextKey(`old${i}`) }),
    });
    const j = await r.json();
    if (r.status !== 200) { ok = false; detail.push(`第${i + 1}球 status=${r.status} ${JSON.stringify(j)}`); break; }
    rid = j.roundId;
    detail.push(`第${i + 1}球=${j.ball}(${j.perKeyOutcome?.big?.outcome})`);
  }
  const st = rid ? (await query('SELECT status, result FROM rounds WHERE id = $1', [rid])).rows[0] : null;
  check('⑥ 老 per-player 一局三球全 200 且局 settled（裸 key、逐球即结，零回归）',
    ok && st?.status === 'settled' && st.result.revealed.length === 3 && st.result.v === undefined,
    `${detail.join(' / ')} status=${st?.status} revealed=${JSON.stringify(st?.result?.revealed)}`);
}

W.close();
console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
