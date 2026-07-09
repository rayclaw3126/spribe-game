// 最后 4 点风控 smoke：/bet、/settle（HTTP）+ aviator 下注/派彩（WS）。
// 用法：node _risk_final_pk.mjs main    → /bet + /settle + aviator 下注
//       node _risk_final_pk.mjs payout  → aviator 派彩超封顶（需先临时调低 aviator.maxPayout）
import WsPkg from '/home/userray/spribe-game/server/node_modules/ws/index.js';
const { WebSocket } = WsPkg;
const BASE = 'http://localhost:4000';
const MODE = process.argv[2] || 'main';
let uid = 0;
const key = (p) => `risk-final-${p}-${Date.now()}-${uid++}`;

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  return (await r.json()).token;
}
let TOKEN;
async function api(path, body, method = 'POST') {
  const r = await fetch(`${BASE}/${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, code: json?.code ?? null, json };
}
const balance = async () => Number((await api('player/me', null, 'GET')).json.balance);

const rows = [];
function rec(label, ok, detail) { rows.push({ label, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} ${detail}`); }

// ---- WS helper ----
function connectWS() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:4000/ws/aviator?token=${TOKEN}`);
    const inbox = []; const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      inbox.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(msg)) { waiters[i].resolve(msg); waiters.splice(i, 1); }
    });
    ws.on('open', () => resolve({
      ws,
      send: (o) => ws.send(JSON.stringify(o)),
      waitFor: (pred, ms = 20000) => new Promise((res, rej) => {
        const w = { pred, resolve: res }; waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); rej(new Error('waitFor timeout')); }, ms);
      }),
      close: () => ws.close(),
    }));
    ws.on('error', reject);
  });
}

TOKEN = await login();
console.log(`logged in OK (mode=${MODE})\n`);

if (MODE === 'main') {
  // ---------- /bet ----------
  const b1 = await api('round/bet', { game: 'dice', amount: '600', idempotencyKey: key('bet') });
  rec('/bet dice 600 (>dice max500)', b1.status === 400 && b1.code === 'bet_above_max', `HTTP ${b1.status} code ${b1.code}`);
  const b2 = await api('round/bet', { game: 'dice', amount: '100', idempotencyKey: key('bet') });
  rec('/bet dice 100 (normal)', b2.status === 200 && b2.json?.roundId, `HTTP ${b2.status} roundId ${b2.json?.roundId}`);

  // ---------- /settle ----------
  // 超封顶：新建一局 pending，再 settle 塞 payout 60000 > dice cap 50000
  const r1 = await api('round/bet', { game: 'dice', amount: '100', idempotencyKey: key('bet') });
  const s1 = await api('round/settle', { roundId: r1.json.roundId, outcome: 'win', payout: '60000' });
  rec('/settle payout 60000 (>dice cap 50000)', s1.status === 400 && s1.code === 'payout_over_cap', `HTTP ${s1.status} code ${s1.code}`);
  const r2 = await api('round/bet', { game: 'dice', amount: '100', idempotencyKey: key('bet') });
  const s2 = await api('round/settle', { roundId: r2.json.roundId, outcome: 'win', payout: '200' });
  rec('/settle payout 200 (normal)', s2.status === 200 && s2.code === null, `HTTP ${s2.status} payout ${s2.json?.payout}`);

  // ---------- aviator 下注（WS） ----------
  const c = await connectWS();
  await c.waitFor((m) => m.type === 'betting'); // 等一个下注窗口
  c.send({ type: 'bet', amount: 600 }); // >aviator maxBet 500
  const rej = await c.waitFor((m) => m.type === 'bet_ack' || m.type === 'bet_rejected');
  rec('aviator bet 600 → WS rejected+code (非"请重试")',
    rej.type === 'bet_rejected' && rej.code === 'bet_above_max' && rej.reason !== '下注失败，请重试',
    `WS ${rej.type} code ${rej.code} reason "${rej.reason}"`);
  c.send({ type: 'bet', amount: 100 }); // 正常注
  const ack = await c.waitFor((m) => m.type === 'bet_ack' || m.type === 'bet_rejected');
  rec('aviator bet 100 (normal) → bet_ack', ack.type === 'bet_ack', `WS ${ack.type} amount ${ack.amount}`);
  c.close();
}

if (MODE === 'payout') {
  // aviator 派彩超封顶：依赖临时 aviator.maxPayout 调低。bet=500，飞行后尽早 cashout 使 payout>cap。
  const CAP = Number(process.argv[3] || '500');
  const BET = 500;
  const c = await connectWS();
  let done = false;
  for (let attempt = 1; attempt <= 12 && !done; attempt++) {
    await c.waitFor((m) => m.type === 'betting');
    c.send({ type: 'bet', amount: BET });
    const ack = await c.waitFor((m) => m.type === 'bet_ack' || m.type === 'bet_rejected');
    if (ack.type !== 'bet_ack') { console.log('bet not acked, retry', ack); continue; }
    const balBefore = await balance();
    // 等一个 tick 使 BET*mult > CAP（mult > CAP/BET），或崩盘则重试
    let cashed = false;
    try {
      const tick = await c.waitFor((m) => (m.type === 'tick' && BET * m.multiplier > CAP) || m.type === 'crashed', 15000);
      if (tick.type === 'crashed') { console.log(`attempt ${attempt}: 崩盘于 cashout 前，重试`); continue; }
      c.send({ type: 'cashout' });
      const co = await c.waitFor((m) => m.type === 'cashout_ok' || m.type === 'cashout_rejected', 8000);
      const balAfter = await balance();
      console.log(`\nattempt ${attempt}: tick mult=${tick.multiplier} → payout≈${(BET * tick.multiplier).toFixed(2)} > cap ${CAP}`);
      console.log(`cashout WS: type=${co.type}  code=${co.code ?? '(none)'}  reason="${co.reason ?? ''}"`);
      console.log(`balance: before=${balBefore} after=${balAfter} Δ=${(balAfter - balBefore).toFixed(2)} (期望 0)`);
      const pass = co.type === 'cashout_rejected' && co.code === 'payout_over_cap'
        && co.reason !== '兑现失败，请重试' && balAfter === balBefore;
      rec('aviator payout>cap → cashout_rejected+code (非"请重试") + Δ=0', pass,
        `type=${co.type} code=${co.code} Δ=${(balAfter - balBefore).toFixed(2)}`);
      done = true; cashed = true;
    } catch (e) { console.log(`attempt ${attempt}: ${e.message}, 重试`); }
    if (!cashed) continue;
  }
  c.close();
  if (!done) rec('aviator payout>cap', false, '12 次都没凑到（运气/时序）');
}

const allOk = rows.length > 0 && rows.every((r) => r.ok);
console.log(`\n${allOk ? 'ALL PASS' : 'SOME FAILED'} (${rows.filter((r) => r.ok).length}/${rows.length})`);
process.exit(allOk ? 0 : 1);
