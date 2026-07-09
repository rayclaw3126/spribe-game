// 风控 payout cap 实跑：把单局倍数滚到 bet×mult>cap 再 cashout，断言被拦 + ROLLBACK 生效。
// 依赖 risk.js TEMP: mines.maxPayout=1500, hilo.maxPayout=1200（验完改回 50000）。
const BASE = 'http://localhost:4000';
const BET = '1000';
const CAP_MINES = 1500, CAP_HILO = 1200;
let uid = 0;
const key = (p) => `risk-cap-${p}-${Date.now()}-${uid++}`;

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
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, code: json?.code ?? null, json };
}
const balance = async () => Number((await api('player/me', null, 'GET')).json.balance);
const roundStatus = async (id) => (await api(`round/${id}`, null, 'GET')).json.status;

// ---------------- MINES ----------------
async function mines() {
  console.log('\n=== MINES payout cap ===');
  for (let attempt = 1; attempt <= 40; attempt++) {
    const s = await api('round/mines/start', { amount: BET, mines: 12, idempotencyKey: key('m') });
    if (s.status !== 200) { console.log('start failed', s.status, s.code); return false; }
    const roundId = s.json.roundId;
    const revealed = new Set();
    let mult = 1, busted = false;
    // 揭格直到 bet*mult>cap（mines=12,safe=13,1格即约1.86倍 → 1860>1500）
    while (BET * mult <= CAP_MINES) {
      let cell; do { cell = Math.floor(((uid++ * 2654435761) % 25 + 25) % 25); } while (revealed.has(cell));
      revealed.add(cell);
      const rv = await api('round/mines/reveal', { roundId, cell });
      if (rv.json?.safe) { mult = rv.json.mult; }
      else { busted = true; break; } // 踩雷，换局重试
      if (revealed.size >= 12) break; // 别揭满触发自动结算
    }
    if (busted) continue;
    if (BET * mult <= CAP_MINES) continue; // 没滚够，换局
    // 到这里：payout 应 > cap，尝试 cashout
    const balBefore = await balance();
    const stBefore = await roundStatus(roundId);
    const co = await api('round/mines/cashout', { roundId });
    const balAfter = await balance();
    const stAfter = await roundStatus(roundId);
    const payout = (BET * mult).toFixed(2);
    console.log(`rolled: gems=${revealed.size} mult=${mult.toFixed(4)} → payout≈${payout} > cap ${CAP_MINES}`);
    console.log(`cashout: HTTP ${co.status}  code ${co.code}`);
    console.log(`balance: before=${balBefore}  after=${balAfter}  Δ=${(balAfter - balBefore).toFixed(2)}  (期望 0)`);
    console.log(`status : before=${stBefore}  after=${stAfter}  (期望仍 playing，未 cashed)`);
    const pass = co.status === 400 && co.code === 'payout_over_cap'
      && balAfter === balBefore && stAfter === 'playing';
    console.log(pass ? 'MINES PASS ✅' : 'MINES FAIL ❌');
    return pass;
  }
  console.log('MINES: 40 次都没滚到超封顶（运气）'); return false;
}

// ---------------- HILO ----------------
async function hilo() {
  console.log('\n=== HILO payout cap ===');
  for (let attempt = 1; attempt <= 60; attempt++) {
    const s = await api('round/hilo/start', { amount: BET, idempotencyKey: key('h') });
    if (s.status !== 200) { console.log('start failed', s.status, s.code); return false; }
    const roundId = s.json.roundId;
    let card = s.json.card, cum = 1, busted = false;
    while (BET * cum <= CAP_HILO) {
      const dir = card <= 7 ? 'high' : 'low'; // 选赢面更大的方向，最大化存活
      const g = await api('round/hilo/guess', { roundId, dir });
      if (g.json?.correct) { cum = g.json.cum; card = g.json.card; }
      else { busted = true; break; }
    }
    if (busted) continue;
    if (BET * cum <= CAP_HILO) continue;
    const balBefore = await balance();
    const stBefore = await roundStatus(roundId);
    const co = await api('round/hilo/cashout', { roundId });
    const balAfter = await balance();
    const stAfter = await roundStatus(roundId);
    console.log(`rolled: cum=${cum.toFixed(4)} → payout≈${(BET * cum).toFixed(2)} > cap ${CAP_HILO}`);
    console.log(`cashout: HTTP ${co.status}  code ${co.code}`);
    console.log(`balance: before=${balBefore}  after=${balAfter}  Δ=${(balAfter - balBefore).toFixed(2)}  (期望 0)`);
    console.log(`status : before=${stBefore}  after=${stAfter}  (期望仍 playing，未 cashed)`);
    const pass = co.status === 400 && co.code === 'payout_over_cap'
      && balAfter === balBefore && stAfter === 'playing';
    console.log(pass ? 'HILO PASS ✅' : 'HILO FAIL ❌');
    return pass;
  }
  console.log('HILO: 60 次都没滚到超封顶（运气）'); return false;
}

TOKEN = await login();
console.log('logged in OK');
const m = await mines();
const h = await hilo();
console.log(`\n${m && h ? 'ALL PASS' : 'SOME FAILED'}  (mines=${m}, hilo=${h})`);
process.exit(m && h ? 0 : 1);
