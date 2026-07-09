// 批 4b 止血实测：GET /:id 对 playing 局剥敏感字段、终局给全 result，mines/hilo 两验。
import { pool } from '../src/db.js';
const BASE = 'http://localhost:4000';
let uid = 0;
const kkey = (p) => `pf4b-${p}-${Date.now()}-${uid++}`;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }) });
  return (await r.json()).token;
})();
const api = async (path, body, method = 'POST') => {
  const r = await fetch(`${BASE}/${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: method === 'GET' ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
};
const getDetail = async (id) => (await api(`round/${id}`, null, 'GET')).json;

// ================= MINES =================
console.log('== MINES: playing 剥雷位 / 终局给全 ==');
const ms = await api('round/mines/start', { amount: '10', mines: 5, idempotencyKey: kkey('ms') });
const rid = ms.json.roundId;
const playing = await getDetail(rid);
check('mines playing: status=playing', playing.status === 'playing', `status=${playing.status}`);
check('mines playing: result【无】雷位 mines', !('mines' in (playing.result || {})), `result_keys=${Object.keys(playing.result || {}).join(',')}`);
check('mines playing: result 无 bustCell', !('bustCell' in (playing.result || {})));
check('mines playing: 保留 revealed/mineCount/nonce', ['revealed', 'mineCount', 'nonce'].every((k) => k in (playing.result || {})));
check('mines playing: server_seed 仍无(批4)', !('server_seed' in playing));
// 终局：cashout 后给全 result（含雷位，供验证）
await api('round/mines/cashout', { roundId: rid });
const done = await getDetail(rid);
check('mines 终局: status=cashed', done.status === 'cashed', `status=${done.status}`);
check('mines 终局: result 给全（含雷位 mines）', Array.isArray(done.result?.mines), `mines=${JSON.stringify(done.result?.mines)}`);
check('mines 终局: server_seed 仍无(明文只 rotate 给)', !('server_seed' in done));

// bust 终局也给全
let bustRid = null;
for (let i = 0; i < 10 && !bustRid; i++) {
  const s = await api('round/mines/start', { amount: '10', mines: 24, idempotencyKey: kkey('mb') });
  const rv = await api('round/mines/reveal', { roundId: s.json.roundId, cell: 0 });
  if (rv.json?.safe === false) bustRid = s.json.roundId;
  else await api('round/mines/cashout', { roundId: s.json.roundId });
}
if (bustRid) {
  const bd = await getDetail(bustRid);
  check('mines bust 终局: status=bust + result 给全(含雷位)', bd.status === 'bust' && Array.isArray(bd.result?.mines), `status=${bd.status} mines=${JSON.stringify(bd.result?.mines)}`);
} else check('mines bust 终局覆盖', false, '10次未炸');

// ================= HILO =================
console.log('\n== HILO: playing 无未来牌 / 终局给全 ==');
const hs = await api('round/hilo/start', { amount: '10', idempotencyKey: kkey('hs') });
const hrid = hs.json.roundId;
const hplaying = await getDetail(hrid);
check('hilo playing: status=playing', hplaying.status === 'playing');
// hilo 不落库未来牌；白名单只留 当前牌/历史/step/cum/skips/nonce/status
check('hilo playing: result 仅白名单字段', Object.keys(hplaying.result || {}).every((k) => ['step', 'card', 'cum', 'skips', 'history', 'nonce', 'status'].includes(k)), `result_keys=${Object.keys(hplaying.result || {}).join(',')}`);
check('hilo playing: 有当前牌 card + 历史 history', 'card' in (hplaying.result || {}) && 'history' in (hplaying.result || {}));
check('hilo playing: server_seed 仍无', !('server_seed' in hplaying));
await api('round/hilo/cashout', { roundId: hrid });
const hdone = await getDetail(hrid);
check('hilo 终局: status=cashed + result 给全', hdone.status === 'cashed' && 'cum' in (hdone.result || {}), `status=${hdone.status}`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
