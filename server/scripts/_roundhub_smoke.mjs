// #43 单1 roundHub 排期器 端到端 smoke（7 项）：
//  1. 两 WS 客户端收到同一期号/同倒计时(endsAt)/同开奖结果
//  2. betting 期 HTTP 下注挂当期；locked 后下注 409 round_locked
//  3. 有注客户端收 settled 个人结果带 balanceAfter；DB ledger 有 speedgrid_bet/payout 行
//  4. commit-reveal：drawn 的 serverSeed 的 sha256 == betting 期广播的 serverSeedHash
//  5. 断线重连：新连接收 snapshot（相位/期号/剩余秒）
//  6. 对账（增量 --since）：新结算不破链（alice 钱包↔链一致、新行无 FAIL）
//  7. aviator/momentum WS 回归：连接正常（RSV1 没撞）
import crypto from 'crypto';
import { execSync } from 'node:child_process';
import WebSocket from 'ws';
import { pool, query } from '../src/db.js';

const BASE = 'http://localhost:4000';
const WSBASE = 'ws://localhost:4000';
const ALICE_ID = 1;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(username, password) {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password, type: 'player' }) });
  return (await r.json()).token;
}
async function bet(token, bets, key) {
  const r = await fetch(`${BASE}/round/speedgrid/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ bets, idempotencyKey: key }) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}

// WS 客户端：收集所有消息，提供 waitFor(predicate, timeout)
function openClient(path, token) {
  const ws = new WebSocket(`${WSBASE}${path}?token=${encodeURIComponent(token)}`);
  const msgs = [];
  const waiters = [];
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    msgs.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
    }
  });
  const ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return {
    ws, msgs, ready,
    find: (pred) => msgs.find(pred),
    waitFor: (pred, timeout = 45000) => new Promise((resolve, reject) => {
      const hit = msgs.find(pred);
      if (hit) return resolve(hit);
      const t = setTimeout(() => reject(new Error('waitFor timeout')), timeout);
      waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    }),
    close: () => { try { ws.close(); } catch {} },
  };
}

const token = await login('alice', 'alice123');
if (!token) { console.log('FAIL 登录 alice 失败'); await pool.end(); process.exit(1); }

// ── 建立两个客户端 ──
const A = openClient('/ws/rounds', token);
const B = openClient('/ws/rounds', token);
await Promise.all([A.ready, B.ready]);
console.log('== 两客户端已连上 /ws/rounds ==');

// 1. 等一个「新一期 betting」广播（两端都应收到，roundNo/endsAt/hash 一致）
console.log('\n== [1] 双客户端同期号/同倒计时 ==');
const bettingA = await A.waitFor((m) => m.type === 'phase' && m.phase === 'betting', 45000);
const bettingB = await B.waitFor((m) => m.type === 'phase' && m.phase === 'betting' && m.roundNo === bettingA.roundNo, 5000);
check('两端收到同一期号 roundNo', bettingA.roundNo === bettingB.roundNo && typeof bettingA.roundNo === 'string' && /^SG-\d{8}-\d{3,}$/.test(bettingA.roundNo), `A=${bettingA.roundNo} B=${bettingB.roundNo}`);
check('两端同倒计时 endsAt', bettingA.endsAt === bettingB.endsAt && typeof bettingA.endsAt === 'number', `A=${bettingA.endsAt} B=${bettingB.endsAt}`);
check('betting 广播带 serverSeedHash(64) 且无 serverSeed 明文', bettingA.serverSeedHash?.length === 64 && !('serverSeed' in bettingA), `hash=${bettingA.serverSeedHash?.slice(0, 12)}…`);
const roundNo = bettingA.roundNo;
const roundId = bettingA.roundId;
const commitHash = bettingA.serverSeedHash;

// 2a. betting 期 HTTP 下注挂当期
console.log('\n== [2] 下注挂当期 + locked 后 409 ==');
const maxLedgerBefore = Number((await query('SELECT MAX(id) mx FROM ledger')).rows[0].mx);
const betKey = `rhsmoke-${maxLedgerBefore}-a`;
const placed = await bet(token, { big: 2, small: 2 }, betKey);
check('betting 期下注 200 accepted 且 roundNo 命中当期', placed.status === 200 && placed.json?.accepted === true && placed.json?.roundNo === roundNo && placed.json?.roundId === roundId, `status=${placed.status} json=${JSON.stringify(placed.json)}`);
check('下注返回 balanceAfter', placed.json?.balanceAfter != null, `balanceAfter=${placed.json?.balanceAfter}`);

// 2b. locked 后下注 409（等 locked 广播 → 立即打）
await A.waitFor((m) => m.type === 'phase' && m.phase === 'locked' && m.roundNo === roundNo, 40000);
const locked = await bet(token, { big: 2 }, `rhsmoke-${maxLedgerBefore}-locked`);
check('locked 相位下注 → 409 round_locked（debit 前拒）', locked.status === 409 && locked.json?.error === 'round_locked', `status=${locked.status} err=${locked.json?.error}`);

// 4. commit-reveal：drawn 的 serverSeed sha256 == betting 的 hash
console.log('\n== [4] commit-reveal ==');
const drawnA = await A.waitFor((m) => m.type === 'phase' && m.phase === 'drawn' && m.roundNo === roundNo, 15000);
const recomputed = crypto.createHash('sha256').update(drawnA.serverSeed).digest('hex');
check('sha256(drawn.serverSeed) == betting.serverSeedHash', recomputed === commitHash, `recomputed=${recomputed.slice(0, 12)}… commit=${commitHash.slice(0, 12)}…`);
check('drawn 广播带 result.n(1–24) + serverSeed 明文', Number.isInteger(drawnA.result?.n) && drawnA.result.n >= 1 && drawnA.result.n <= 24 && typeof drawnA.serverSeed === 'string', `n=${drawnA.result?.n}`);
const drawnB = await B.waitFor((m) => m.type === 'phase' && m.phase === 'drawn' && m.roundNo === roundNo, 5000);
check('两端同开奖结果 result.n', drawnA.result.n === drawnB.result.n, `A=${drawnA.result.n} B=${drawnB.result.n}`);

// 3. settled 个人结果带 balanceAfter + ledger 有 bet/payout
console.log('\n== [3] settled 个人结果 + ledger ==');
const result = await A.waitFor((m) => m.type === 'result' && m.roundId === roundId, 10000);
check('收到个人 result 带 balanceAfter + yourResult', result.balanceAfter != null && Array.isArray(result.yourResult) && result.yourResult.length === 2, `balanceAfter=${result.balanceAfter} yourResult=${JSON.stringify(result.yourResult)}`);
{
  const bigO = result.yourResult.find((x) => x.key === 'big')?.outcome;
  const smallO = result.yourResult.find((x) => x.key === 'small')?.outcome;
  check('big/small 必中且仅中其一（部分赢，保证有派彩）', (bigO === 'hit') !== (smallO === 'hit') && (bigO === 'hit' || smallO === 'hit'), `big=${bigO} small=${smallO}`);
}
await A.waitFor((m) => m.type === 'phase' && m.phase === 'settled' && m.roundNo === roundNo, 5000);
await sleep(300); // 让结算事务落库
const led = (await query(`SELECT type FROM ledger WHERE round_id=$1 AND player_id=$2 ORDER BY id`, [roundId, ALICE_ID])).rows.map((r) => r.type);
check('ledger 本期有 speedgrid_bet 行', led.includes('speedgrid_bet'), `types=[${led.join(',')}]`);
check('ledger 本期有 speedgrid_payout 行', led.includes('speedgrid_payout'), `types=[${led.join(',')}]`);

// 5. 断线重连 snapshot
console.log('\n== [5] 断线重连 snapshot ==');
const C = openClient('/ws/rounds', token);
await C.ready;
const snap = await C.waitFor((m) => m.type === 'snapshot', 8000);
const timedPhase = ['betting', 'locked', 'idle'].includes(snap.phase);
check('重连收 snapshot 带 phase + roundNo', typeof snap.phase === 'string' && typeof snap.roundNo === 'string', `phase=${snap.phase} roundNo=${snap.roundNo}`);
check('snapshot 带剩余秒（timed 相位 remainingMs≥0）', !timedPhase || (typeof snap.remainingMs === 'number' && snap.remainingMs >= 0 && typeof snap.endsAt === 'number'), `phase=${snap.phase} remainingMs=${snap.remainingMs}`);
check('snapshot 承诺态不泄 serverSeed（betting/locked 无明文）', !((snap.phase === 'betting' || snap.phase === 'locked') && 'serverSeed' in snap), `phase=${snap.phase} hasSeed=${'serverSeed' in snap}`);

// 6. 对账（增量）：新结算不破链
console.log('\n== [6] 对账（增量 --since，新结算不破链）==');
let reconOut = '';
try { reconOut = execSync(`node scripts/reconcile_balances.mjs --since ${maxLedgerBefore}`, { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }); }
catch (e) { reconOut = (e.stdout || '') + (e.stderr || ''); } // 全库其它历史脏钱包会让退出码非 0，取 stdout 分析
const aliceWalletPass = /PASS\s+wallet player_id=1\b/.test(reconOut);
const aliceRowFail = /FAIL\s+row .*player_id=1\b/.test(reconOut);
const windowFailRows = (reconOut.match(/FAIL\s+row /g) || []).length;
check('alice 钱包 ① balance==最新链尾（新派彩未破）', aliceWalletPass, aliceWalletPass ? '' : '未见 alice 钱包 PASS 行');
check('本次新增行（含 speedgrid_bet/payout）无 δ/链 FAIL（alice）', !aliceRowFail, aliceRowFail ? 'alice 新行有 FAIL' : `窗口内 FAIL row 总数=${windowFailRows}（非 alice/历史脏，见下）`);
console.log('  ── reconcile --since 输出摘要 ──');
reconOut.split('\n').filter((l) => /player_id=1\b|RECON/.test(l)).forEach((l) => console.log('   ' + l));

// 7. aviator / momentum 回归（连接正常，RSV1 没撞）
console.log('\n== [7] aviator/momentum WS 回归 ==');
for (const p of ['/ws/aviator', '/ws/momentum']) {
  const R = openClient(p, token);
  try {
    await R.ready;
    const hello = await R.waitFor((m) => m.type === 'hello' || m.type === 'snapshot' || m.type === 'betting', 4000);
    check(`${p} 连接正常并收到首帧（${hello.type}）`, R.ws.readyState === 1, `readyState=${R.ws.readyState}`);
  } catch (e) {
    check(`${p} 连接正常并收到首帧`, false, e.message);
  } finally { R.close(); }
}

A.close(); B.close(); C.close();
console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
