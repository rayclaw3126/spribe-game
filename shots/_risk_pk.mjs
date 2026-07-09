// 风控冒烟：直接打 API，断言 HTTP 状态 + code。玩家 alice/alice123。
const BASE = 'http://localhost:4000';
let uid = 0;
const nextKey = (p) => `risk-smoke-${p}-${Date.now()}-${uid++}`;

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }),
  });
  if (!r.ok) throw new Error(`login failed ${r.status}`);
  return (await r.json()).token;
}

async function play(token, path, body) {
  const r = await fetch(`${BASE}/round/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* no body */ }
  return { status: r.status, code: json?.code ?? null, json };
}

const rows = [];
function record(label, res, expStatus, expCode) {
  const ok = res.status === expStatus && (expCode === null ? true : res.code === expCode);
  rows.push({ label, status: res.status, code: res.code, expStatus, expCode, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(28)} -> ${res.status} ${res.code ?? '(no code)'}  (expect ${expStatus} ${expCode ?? 'ok'})`);
}

const token = await login();
console.log('logged in OK\n');

// dice: { amount, target, direction, clientSeed, idempotencyKey }
record('dice 600 (>max500)', await play(token, 'dice/play', { amount: '600', target: 50, direction: 'under', idempotencyKey: nextKey('dice') }), 400, 'bet_above_max');
record('dice 0.5 (<min1)',   await play(token, 'dice/play', { amount: '0.5', target: 50, direction: 'under', idempotencyKey: nextKey('dice') }), 400, 'bet_below_min');
record('dice 100 (normal)',  await play(token, 'dice/play', { amount: '100', target: 50, direction: 'under', idempotencyKey: nextKey('dice') }), 200, null);

// limbo: { amount, target, clientSeed, idempotencyKey }
record('limbo 300 (>max200)', await play(token, 'limbo/play', { amount: '300', target: 2, idempotencyKey: nextKey('limbo') }), 400, 'bet_above_max');
record('limbo 50 (normal)',   await play(token, 'limbo/play', { amount: '50', target: 2, idempotencyKey: nextKey('limbo') }), 200, null);

// plinko: { amount, risk, rows, clientSeed, idempotencyKey }
record('plinko 1500 (>def1000)', await play(token, 'plinko/play', { amount: '1500', risk: 'green', rows: 16, idempotencyKey: nextKey('plinko') }), 400, 'bet_above_max');
record('plinko 100 (normal)',    await play(token, 'plinko/play', { amount: '100', risk: 'green', rows: 16, idempotencyKey: nextKey('plinko') }), 200, null);

const allOk = rows.every((r) => r.ok);
console.log(`\n${allOk ? 'ALL PASS' : 'SOME FAILED'} (${rows.filter((r) => r.ok).length}/${rows.length})`);
process.exit(allOk ? 0 : 1);
