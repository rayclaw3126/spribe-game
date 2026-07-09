// mines 揭满自动结算 payout cap 实跑：mines=1 全清板(1/25/局) → auto-settle credit 被 cap 拦。
// 依赖 risk.js TEMP: mines.maxPayout=1000（验完改回 50000）。bet=200, mines=1 全清 mult≈12 → payout≈2406>1000。
const BASE = 'http://localhost:4000';
const BET = '200';
const CAP = 1000;
let uid = 0;
const key = (p) => `risk-as-${p}-${Date.now()}-${uid++}`;

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

TOKEN = await login();
console.log('logged in OK');
const SAFE_TOTAL = 25 - 1; // mines=1 → 24 安全格

for (let attempt = 1; attempt <= 200; attempt++) {
  const s = await api('round/mines/start', { amount: BET, mines: 1, idempotencyKey: key('m') });
  if (s.status !== 200) { console.log('start failed', s.status, s.code, s.json); process.exit(1); }
  const roundId = s.json.roundId;
  let gems = 0, busted = false, hit = null;
  // 按序揭 0,1,2,... 只有雷恰在最后一格(第25格,index24)时,揭到第24格安全 → gems=24 触发自动结算
  for (let cell = 0; cell < SAFE_TOTAL; cell++) {
    const aboutToClear = gems === SAFE_TOTAL - 1; // 这一揭将使 gems 达到 24
    let balBefore, stBefore;
    if (aboutToClear) { balBefore = await balance(); stBefore = await roundStatus(roundId); }
    const rv = await api('round/mines/reveal', { roundId, cell });
    if (rv.status === 400 && rv.code === 'payout_over_cap') {
      // 命中：自动结算的 credit 被 cap 拦
      const balAfter = await balance();
      const stAfter = await roundStatus(roundId);
      hit = { attempt, balBefore, balAfter, stBefore, stAfter, roundId };
      break;
    }
    if (rv.json?.safe) { gems = rv.json.gems; if (rv.json.cleared) { console.log('意外: 清板但未被拦?', rv.json); process.exit(1); } }
    else { busted = true; break; }
  }
  if (hit) {
    const mult = 0.97 ** 24 * 25;
    console.log(`\n命中于第 ${hit.attempt} 局 roundId=${hit.roundId}`);
    console.log(`全清 gems=24 mult≈${mult.toFixed(4)} → payout≈${(Number(BET) * mult).toFixed(2)} > cap ${CAP}`);
    console.log(`reveal(自动结算) HTTP 400  code payout_over_cap`);
    console.log(`balance: before=${hit.balBefore}  after=${hit.balAfter}  Δ=${(hit.balAfter - hit.balBefore).toFixed(2)}  (期望 0)`);
    console.log(`status : before=${hit.stBefore}  after=${hit.stAfter}  (期望仍 playing，未 cashed)`);
    const pass = hit.balAfter === hit.balBefore && hit.stAfter === 'playing';
    console.log(pass ? 'AUTO-SETTLE CAP PASS ✅' : 'AUTO-SETTLE CAP FAIL ❌');
    process.exit(pass ? 0 : 1);
  }
  if (attempt % 25 === 0) console.log(`...${attempt} 局，尚未清板（1/25/局，正常）`);
}
console.log('200 局都没清板（运气极差）'); process.exit(1);
