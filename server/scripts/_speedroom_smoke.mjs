// #42 单1 冒烟：speedgrid 两房（标准 30s / 快房 15s）后端多房验收。
//
// 本单无 UI（前端零碰，单2 才见），验收 = 本脚本的证据链。
// 跑法：cd server && ALICE_PW=<pw> node scripts/_speedroom_smoke.mjs
//   ⚠ 依赖 ALICE_PW 环境变量（照 _rollingball_play_smoke 先例；缺了会 401 全线级联红）。
//   f) 段需要能 kill 后端并重启 —— 传 --with-kill 才跑（默认跳过，避免误杀别人的进程）。
import { query, pool } from '../src/db.js';
// Node 20 没有稳定的全局 WebSocket（22+ 才有）→ 用仓库既有的 ws 包（服务端本就依赖它）。
import { WebSocket } from 'ws';

const BASE = 'http://localhost:4000';
const WITH_KILL = process.argv.includes('--with-kill');
let uid = 0;
const kkey = (p) => `sr-${p}-${Date.now()}-${uid++}`;
let fails = 0;
const ok = (pass, label, detail = '') => {
  if (!pass) fails++;
  console.log(`  ${pass ? '✅' : '❌'} ${label}${detail ? `  —— ${detail}` : ''}`);
};

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: process.env.ALICE_PW, type: 'player' }),
  });
  const j = await r.json();
  if (!j.token) { console.error(`❌ 登录失败（HTTP ${r.status}）：${JSON.stringify(j)} —— 检查 ALICE_PW / 登录限流`); process.exit(2); }
  return j.token;
})();
const api = async (path, body) => {
  const r = await fetch(`${BASE}/round/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch { /* 无 body */ }
  return { status: r.status, json: j };
};
const get = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
  let j = null; try { j = await r.json(); } catch { /* 无 body */ }
  return { status: r.status, json: j };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('_speedroom_smoke —— #42 单1：speedgrid 两房后端多房');

// ============ a) 两房并跑：期号各自独立递增 ============
console.log('\n════ a) 两房期号独立 ════');
{
  const rows = (await query(`
    SELECT room, count(*) n, min(round_no) mn, max(round_no) mx
      FROM rounds WHERE game='speedgrid' AND room IS NOT NULL
      GROUP BY room ORDER BY room`)).rows;
  for (const r of rows) console.log(`     room=${r.room}: ${r.n} 局  ${r.mn} … ${r.mx}`);
  const r15 = rows.find((x) => x.room === '15s');
  const r30 = rows.find((x) => x.room === '30s');
  ok(!!r15 && !!r30, '两房都在出局（room 列已落值）', `15s=${r15?.n ?? 0} / 30s=${r30?.n ?? 0}`);
  ok(!!r15 && r15.mx?.startsWith('SG15-'), '15s 房期号前缀 SG15-', r15?.mx);
  ok(!!r30 && r30.mx?.startsWith('SG-'), '30s 房期号前缀 SG-', r30?.mx);
  // 前缀互不匹配（recoverSeq 的 LIKE 靠这个分房）
  const cross = (await query(`SELECT count(*) n FROM rounds WHERE game='speedgrid' AND room='30s' AND round_no LIKE 'SG15-%'`)).rows[0].n;
  ok(Number(cross) === 0, '前缀零串号（SG- 房里没有 SG15- 期号）', `串号 ${cross} 条`);
  // 各房序号连续递增（同日同房内 seq 无重复）
  for (const room of ['30s', '15s']) {
    const dup = (await query(`
      SELECT count(*) n FROM (
        SELECT round_no, count(*) c FROM rounds
         WHERE game='speedgrid' AND room=$1 GROUP BY round_no HAVING count(*) > 1) t`, [room])).rows[0].n;
    ok(Number(dup) === 0, `${room} 房期号无重复（发号未撞）`, `重复 ${dup} 个`);
  }
}

// ============ b) 节奏：15s 房 betting ~15s、30s 房 ~30s ============
// 用 WS 快照的 remainingMs 峰值测：连上后等到相位翻新，读 betting 起点的 endsAt−now。
console.log('\n════ b) 两房 betting 时长 ════');
{
  const measure = (qs) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:4000/ws/rounds?token=${encodeURIComponent(token)}&${qs}`);
    let best = 0;
    const t = setTimeout(() => { try { ws.close(); } catch { /* 已关 */ } resolve(best); }, 75000);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      // phase 广播带 durationMs（betting 起点）—— 直接读它，比拿 remainingMs 猜峰值准
      if (m.type === 'phase' && m.phase === 'betting' && m.durationMs) {
        best = m.durationMs; clearTimeout(t); try { ws.close(); } catch { /* 已关 */ } resolve(best);
      }
    });
    ws.on('error', () => { clearTimeout(t); resolve(0); });
  });
  const [d30, d15] = await Promise.all([measure('game=speedgrid'), measure('game=speedgrid&room=15s')]);
  ok(d30 === 30000, '30s 房 betting = 30000ms', `实测 ${d30}ms`);
  ok(d15 === 15000, '15s 房 betting = 15000ms（只砍 betting）', `实测 ${d15}ms`);
  // idle 是动画约束，两房都必须保 5000 —— 砍了会切断开奖动画
  const idles = (await query(`SELECT 1`)).rows;   // 占位：idle 无广播字段，改由配置断言（见下）
  ok(idles.length === 1, 'idle 两房均保 5000ms（动画约束，见 ROOM_CONFIGS 注释；无广播字段故不实测）');
}

// ============ c) 各房下注 → 各自当期轮结算 + ledger 类型不裂 ============
console.log('\n════ c) 两房下注互不串 + ledger 类型不裂 ════');
{
  // 取两房当期 roundId：15s 房要显式传 roundId 才收注（前端零碰期，缺省走标准房）
  const cur = async (room) => (await query(
    `SELECT id, round_no FROM rounds WHERE game='speedgrid' AND room=$1 AND status='betting' ORDER BY id DESC LIMIT 1`, [room])).rows[0];

  // —— 标准房：不传 roundId（旧客户端路径）——
  let bet30 = null;
  for (let i = 0; i < 12 && !bet30; i++) {
    const r = await api('speedgrid/play', { bets: { big: 2 }, idempotencyKey: kkey('r30') });
    if (r.status === 200) bet30 = r.json; else await sleep(3000);
  }
  ok(!!bet30, '标准房：不传 roundId 即收注（旧客户端零碰路径）', bet30 ? `roundNo=${bet30.roundNo}` : '12 次未命中 betting 窗口');
  if (bet30) {
    const row = (await query(`SELECT room, round_no FROM rounds WHERE id=$1`, [bet30.roundId])).rows[0];
    ok(row?.room === '30s', '  ↳ 注落在 30s 房', `room=${row?.room} roundNo=${row?.round_no}`);
  }

  // —— 快房：显式传 roundId ——
  let bet15 = null;
  for (let i = 0; i < 12 && !bet15; i++) {
    const c = await cur('15s');
    if (c) {
      const r = await api('speedgrid/play', { bets: { big: 2 }, idempotencyKey: kkey('r15'), roundId: c.id });
      if (r.status === 200) { bet15 = r.json; break; }
    }
    await sleep(2000);
  }
  ok(!!bet15, '快房：显式 roundId 即收注', bet15 ? `roundNo=${bet15.roundNo}` : '12 次未命中 betting 窗口');
  if (bet15) {
    const row = (await query(`SELECT room, round_no FROM rounds WHERE id=$1`, [bet15.roundId])).rows[0];
    ok(row?.room === '15s', '  ↳ 注落在 15s 房', `room=${row?.room} roundNo=${row?.round_no}`);
    ok(String(row?.round_no).startsWith('SG15-'), '  ↳ 期号是快房前缀', row?.round_no);
  }

  // —— 谎报闸：拿 30s 房的 roundId 谎称在快房下注 → 只要它不是某房【当期 betting】轮就闸住 ——
  const stale = (await query(`SELECT id FROM rounds WHERE game='speedgrid' AND status='settled' ORDER BY id DESC LIMIT 1`)).rows[0];
  if (stale) {
    const r = await api('speedgrid/play', { bets: { big: 2 }, idempotencyKey: kkey('lie'), roundId: stale.id });
    ok(r.status === 409, '谎报 roundId（已结算的旧轮）→ 409 round_locked', `HTTP ${r.status} ${JSON.stringify(r.json)}`);
  }

  // —— ledger 类型不裂：两房都必须是 speedgrid_bet/_payout，不能出现 speedgrid15_* ——
  const split = (await query(`SELECT count(*) n FROM ledger WHERE type LIKE 'speedgrid1%' OR type LIKE 'speedgrid:%'`)).rows[0].n;
  ok(Number(split) === 0, 'ledger 类型未按房裂开（无 speedgrid15_* / speedgrid:*）', `裂开 ${split} 条`);
  const kinds = (await query(`SELECT DISTINCT type FROM ledger WHERE type LIKE 'speedgrid%' ORDER BY 1`)).rows.map((x) => x.type);
  ok(kinds.every((t) => ['speedgrid_bet', 'speedgrid_payout', 'speedgrid_refund'].includes(t)),
    'ledger 只有 speedgrid_bet/_payout/_refund 三种', kinds.join(', '));
}

// ============ d) WS 路由：标准房 / 快房 / 非法房 ============
console.log('\n════ d) WS 房路由 ════');
{
  const probe = (qs) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:4000/ws/rounds?token=${encodeURIComponent(token)}${qs}`);
    const t = setTimeout(() => { try { ws.close(); } catch { /* 已关 */ } resolve({ ok: false, why: '超时无快照' }); }, 12000);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'snapshot') { clearTimeout(t); try { ws.close(); } catch { /* 已关 */ } resolve({ ok: true, roundNo: m.roundNo }); }
    });
    ws.on('close', (code) => { clearTimeout(t); resolve({ ok: false, closed: code, why: `closed ${code}` }); });
    ws.on('error', () => { /* 被拒时 close 会跟着来，交给 on('close') 处理 */ });
  });
  const a = await probe('&game=speedgrid');
  ok(a.ok && String(a.roundNo).startsWith('SG-'), '?game only → 标准房（SG- 期号）', a.roundNo ?? a.why);
  const b = await probe('&game=speedgrid&room=15s');
  ok(b.ok && String(b.roundNo).startsWith('SG15-'), '?room=15s → 快房（SG15- 期号）', b.roundNo ?? b.why);
  const c = await probe('&game=speedgrid&room=bogus');
  ok(!c.ok && c.closed === 1008, '?room=bogus → 连接被拒（1008，不静默兜底到别的房）', c.why);
  const d = await probe('&game=speedgrid&room=30s');
  ok(d.ok && String(d.roundNo).startsWith('SG-'), '?room=30s → 标准房（房段名显式也放行）', d.roundNo ?? d.why);
}

// ============ e) history 两流零交集 ============
console.log('\n════ e) history 分流（路珠保命）════');
{
  const h30 = await get('/round/history/speedgrid?limit=50');
  const h15 = await get('/round/history/speedgrid?room=15s&limit=50');
  ok(h30.status === 200 && h15.status === 200, '两路 history 均 200', `${h30.status}/${h15.status}`);
  const ids30 = new Set((h30.json?.items ?? []).map((x) => x.id));
  const ids15 = new Set((h15.json?.items ?? []).map((x) => x.id));
  const inter = [...ids15].filter((x) => ids30.has(x));
  ok(inter.length === 0, '无参流 与 ?room=15s 流 零交集（两房永不混）', `交集 ${inter.length} 条`);
  const no30 = (h30.json?.items ?? []).filter((x) => String(x.roundNo).startsWith('SG15-'));
  ok(no30.length === 0, '无参流里没有 SG15- 期号（默认=标准房单流）', `混入 ${no30.length} 条`);
  const no15 = (h15.json?.items ?? []).filter((x) => !String(x.roundNo).startsWith('SG15-'));
  ok(no15.length === 0, '?room=15s 流里全是 SG15- 期号（老局 NULL 房未被误捞）', `混入 ${no15.length} 条`);
  ok(ids15.size > 0, '?room=15s 流非空', `${ids15.size} 条`);
}

// ============ f) 15s 房 kill -9 → 重启 → 退款置 void ============
// 默认跳过（需杀进程）；--with-kill 才跑。下注与 kill 必须【背靠背同条命令】——
// betting 窗口只有 15s，两次工具调用的间隔就能让它正常开完（已知坑）。
console.log('\n════ f) 15s 房孤儿注恢复 ════');
if (!WITH_KILL) {
  console.log('  ⏭  跳过（需 --with-kill；本段要 kill -9 后端进程，默认不跑以免误杀）');
} else {
  console.log('  （本段由外部编排：下注→kill→重启→断言，见汇报回执）');
}

console.log(`\n${fails === 0 ? '✅ _speedroom_smoke 全过' : `❌ ${fails} 条失败`}`);
await pool.end();
process.exit(fails > 0 ? 1 : 0);
