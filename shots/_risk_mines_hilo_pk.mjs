// 风控冒烟 mines/hilo start：直接打 API，断言 HTTP 状态 + code。玩家 alice/alice123。
const BASE = 'http://localhost:4000';
let uid = 0;
const nextKey = (p) => `risk-mh-${p}-${Date.now()}-${uid++}`;

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
  rows.push({ label, ...res, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(26)} -> ${res.status} ${res.code ?? '(no code)'}  (expect ${expStatus} ${expCode ?? 'ok'})`);
}

const token = await login();
console.log('logged in OK\n');

// mines: { amount, mines, clientSeed, idempotencyKey }
record('mines 5000 (>def1000)', await play(token, 'mines/start', { amount: '5000', mines: 3, idempotencyKey: nextKey('mines') }), 400, 'bet_above_max');
record('mines 100 (normal)',    await play(token, 'mines/start', { amount: '100', mines: 3, idempotencyKey: nextKey('mines') }), 200, null);

// hilo: { amount, clientSeed, idempotencyKey }
record('hilo 5000 (>def1000)', await play(token, 'hilo/start', { amount: '5000', idempotencyKey: nextKey('hilo') }), 400, 'bet_above_max');
record('hilo 100 (normal)',    await play(token, 'hilo/start', { amount: '100', idempotencyKey: nextKey('hilo') }), 200, null);

const allOk = rows.every((r) => r.ok);
console.log(`\n${allOk ? 'ALL PASS' : 'SOME FAILED'} (${rows.filter((r) => r.ok).length}/${rows.length})`);
// 打印正常局的 roundId，方便之后凑滚倍测 payout cap
for (const r of rows) if (r.status === 200 && r.json?.roundId) console.log(`  ${r.label} roundId=${r.json.roundId}`);
process.exit(allOk ? 0 : 1);
