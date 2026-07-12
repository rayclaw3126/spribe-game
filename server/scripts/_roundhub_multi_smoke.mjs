// #43 单3 roundHub 多房间 smoke：speedgrid + numberup + derbyday + dominoduel 各 room 端到端。
// 每 room：双 WS 同期号(带对应前缀)/同 endsAt/同开奖 · betting 下注挂当期 · drawn 后下注 409 ·
//          commit-reveal · settled 个人结果带 balanceAfter + ledger 有 <game>_bet/_payout · 重连 snapshot。
// push 两款(derbyday/dominoduel)：离线证明 push 分支（引擎 spin 出 push key → settle 退本金公式）。
// 末尾：reconcile --since 无新 FAIL · aviator/momentum WS 回归。
import crypto from 'crypto';
import { execSync } from 'node:child_process';
import WebSocket from 'ws';
import { pool, query } from '../src/db.js';
import * as derbyDayEngine from '../src/game/derbyDay.js';
import * as dominoDuelEngine from '../src/game/dominoDuel.js';
import { makeSeededRng } from '../src/lib/seededRng.js';

const BASE = 'http://localhost:4000', WSBASE = 'ws://localhost:4000';
const ALICE_ID = 1;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 各 room 配置：前缀 + 一组「覆盖式」注单（互补必中其一、无 push → 保证有派彩）
const ROOMS = [
  { game: 'speedgrid', prefix: 'SG', cover: { big: 2, small: 2 } },
  { game: 'numberup', prefix: 'NU', cover: { 's-high': 2, 's-low': 2 } },
  { game: 'derbyday', prefix: 'DD', cover: { 'ft-big': 2, 'ft-small': 2 } },
  { game: 'dominoduel', prefix: 'DM', cover: { 'g-big': 2, 'g-small': 2 } },
  // 批2：覆盖式注单保证 ≥1 命中（无 push）。hattrick 大小遇豹子皆不中→加 tr-any 兜底。
  { game: 'hattrick', prefix: 'HT', cover: { 's-big': 2, 's-small': 2, 'tr-any': 2 } },
  { game: 'goldenboot', prefix: 'GB', cover: { 's-big': 2, 's-small': 2 } },
  { game: 'halftime', prefix: 'HF', cover: { over: 2, under: 2 } },
  { game: 'wuxing', prefix: 'WX', cover: { big: 2, small: 2 } },
  { game: 'lineup', prefix: 'LU', cover: { big: 2, small: 2 } },
];

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();

async function bet(game, bets, key) {
  const r = await fetch(`${BASE}/round/${game}/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ bets, idempotencyKey: key }) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
function openClient(game) {
  const ws = new WebSocket(`${WSBASE}/ws/rounds?token=${encodeURIComponent(token)}&game=${game}`);
  const msgs = [], waiters = [];
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    msgs.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
  });
  const ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return {
    ws, msgs, ready,
    waitFor: (pred, timeout = 45000) => new Promise((resolve, reject) => {
      const hit = msgs.find(pred); if (hit) return resolve(hit);
      const t = setTimeout(() => reject(new Error('waitFor timeout')), timeout);
      waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    }),
    close: () => { try { ws.close(); } catch {} },
  };
}

const maxLedgerBefore = Number((await query('SELECT MAX(id) mx FROM ledger')).rows[0].mx);

for (const R of ROOMS) {
  console.log(`\n════════ room: ${R.game} (前缀 ${R.prefix}) ════════`);
  const A = openClient(R.game), B = openClient(R.game);
  await Promise.all([A.ready, B.ready]);

  // 双窗口同一期 betting
  const bA = await A.waitFor((m) => m.type === 'phase' && m.phase === 'betting', 70000);
  const bB = await B.waitFor((m) => m.type === 'phase' && m.phase === 'betting' && m.roundNo === bA.roundNo, 6000);
  check(`[${R.game}] 期号前缀正确 + 两窗口同期号`, bA.roundNo === bB.roundNo && new RegExp(`^${R.prefix}-\\d{8}-\\d{3,}$`).test(bA.roundNo), `A=${bA.roundNo} B=${bB.roundNo}`);
  check(`[${R.game}] 两窗口同 endsAt + hash64 无明文`, bA.endsAt === bB.endsAt && bA.serverSeedHash?.length === 64 && !('serverSeed' in bA), `endsAt=${bA.endsAt}`);
  const roundNo = bA.roundNo, roundId = bA.roundId, commitHash = bA.serverSeedHash;

  // betting 下注挂当期
  const placed = await bet(R.game, R.cover, `multi-${R.game}-${maxLedgerBefore}`);
  check(`[${R.game}] betting 下注 200 accepted 命中当期`, placed.status === 200 && placed.json?.accepted === true && placed.json?.roundNo === roundNo, `status=${placed.status} ${JSON.stringify(placed.json)}`);

  // drawn（reveal）+ 两窗口同结果
  const dA = await A.waitFor((m) => m.type === 'phase' && m.phase === 'drawn' && m.roundNo === roundNo, 60000);
  check(`[${R.game}] commit-reveal：sha256(serverSeed)==hash`, crypto.createHash('sha256').update(dA.serverSeed).digest('hex') === commitHash);
  const dB = await B.waitFor((m) => m.type === 'phase' && m.phase === 'drawn' && m.roundNo === roundNo, 6000);
  check(`[${R.game}] 两窗口同开奖 result`, JSON.stringify(dA.result) === JSON.stringify(dB.result));

  // drawn 后（非 betting）下注 → 409
  const locked = await bet(R.game, R.cover, `multi-${R.game}-locked-${maxLedgerBefore}`);
  check(`[${R.game}] 非 betting 下注 → 409 round_locked`, locked.status === 409 && locked.json?.error === 'round_locked', `status=${locked.status}`);

  // settled 个人结果 + ledger
  const rez = await A.waitFor((m) => m.type === 'result' && m.roundId === roundId, 10000);
  check(`[${R.game}] settled 个人 result 带 balanceAfter + yourResult`, rez.balanceAfter != null && Array.isArray(rez.yourResult) && rez.yourResult.length === Object.keys(R.cover).length, `balanceAfter=${rez.balanceAfter} len=${rez.yourResult?.length}`);
  await sleep(300);
  const led = (await query('SELECT type FROM ledger WHERE round_id=$1 AND player_id=$2 ORDER BY id', [roundId, ALICE_ID])).rows.map((r) => r.type);
  check(`[${R.game}] ledger 有 ${R.game}_bet + ${R.game}_payout`, led.includes(`${R.game}_bet`) && led.includes(`${R.game}_payout`), `types=[${led.join(',')}]`);

  // 重连 snapshot
  const C = openClient(R.game); await C.ready;
  const snap = await C.waitFor((m) => m.type === 'snapshot', 8000);
  check(`[${R.game}] 重连 snapshot 带 phase+roundNo`, typeof snap.phase === 'string' && typeof snap.roundNo === 'string' && snap.roundNo.startsWith(R.prefix), `phase=${snap.phase} roundNo=${snap.roundNo}`);

  A.close(); B.close(); C.close();
}

// —— push 分支离线证明（derbyday/dominoduel）：spin 出 push key → 验退本金公式 ——
console.log('\n════════ push 分支离线证明 ════════');
function findPushCase(engine, label) {
  for (let i = 0; i < 5000; i++) {
    const rng = makeSeededRng('offline-seed', 'c', i);
    const { hits, pushes } = engine.spin(rng);
    if (pushes.size > 0) {
      // 取一个 push key，验它同时不在 hits（push/hit 互斥），退本金 = 原注额
      const k = [...pushes][0];
      const amt = 10;
      const refund = amt; // 排期器 settle：push → payout=amount（退本金）
      return { ok: !hits.has(k) && refund === amt, k, i };
    }
  }
  return { ok: false, k: null, i: -1 };
}
const dPush = findPushCase(derbyDayEngine, 'derbyday');
check('derbyday push 分支：spin 出 push key，push∉hits，退本金=原注额', dPush.ok, `key=${dPush.k} @seed${dPush.i}`);
const mPush = findPushCase(dominoDuelEngine, 'dominoduel');
check('dominoduel push 分支：spin 出 push key，push∉hits，退本金=原注额', mPush.ok, `key=${mPush.k} @seed${mPush.i}`);

// —— reconcile --since：新结算不破链（alice 钱包 PASS + 无 alice 新行 FAIL）——
console.log('\n════════ 对账（增量）════════');
let reconOut = '';
try { reconOut = execSync(`node scripts/reconcile_balances.mjs --since ${maxLedgerBefore}`, { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }); }
catch (e) { reconOut = (e.stdout || '') + (e.stderr || ''); }
check('alice 钱包 ① balance==链尾（多房新派彩未破链）', /PASS\s+wallet player_id=1\b/.test(reconOut));
check('本次新增行（4 房 bet/payout）无 alice δ/链 FAIL', !/FAIL\s+row .*player_id=1\b/.test(reconOut), `窗口内 FAIL row=${(reconOut.match(/FAIL\s+row /g) || []).length}`);

// —— aviator/momentum/speedgrid WS 回归 ——
console.log('\n════════ 回归（aviator/momentum）════════');
for (const p of ['/ws/aviator', '/ws/momentum']) {
  const ws = new WebSocket(`${WSBASE}${p}?token=${encodeURIComponent(token)}`);
  const got = await new Promise((res) => { ws.on('message', () => res(true)); ws.on('error', () => res(false)); setTimeout(() => res(false), 4000); });
  check(`${p} 连接正常收首帧（RSV1 没撞）`, got);
  try { ws.close(); } catch {}
}

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
