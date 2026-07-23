// #公期化 单1c 验收 smoke（七断言）—— 老局兼容 + 读侧/运维双口径收口。
//
//  ① 公期 stuck 注：settled 局留 pending → repair dry-run 对拍分毫平 → --execute 补派 → ledger/钱包对
//  ② 老 per-player 滚球局：repair population 零误报零动作（不重派）
//     + 裁定①离线断言：真实老局 result.balls 喂 v1 复算 == 落库 ballPayout 分毫全等
//  ③ 缺球 settled 局（脏数据）→ 脚本停手报错，不跳过不错派
//  ④ void 局：读闸放行 partial revealed（合成 alice 挂名 v:2 partial 局真 HTTP 验）；
//     /player/bets 注行 outcome=refund + settle_detail 不受影响；非终局 v:2 读闸仍掐；老局读侧零回归
//  ⑤ 幂等隔离：同一 idempotencyKey 老 /play ↔ 新 /bet 双向各自成注，不互撞不误判重放
//  ⑥ 回归四支（外部单跑，不在本脚本内）
//  ⑦ 增量对账 RECON OK
//
// 脏数据自清：本脚本造的合成局/注在断言完成后一律收口（③缺球局退款置 void、④读闸局整行删除），
//   且所有 debit 都有对称的 credit，不破对账链。
import crypto from 'crypto';
import { execSync } from 'node:child_process';
import WebSocket from 'ws';
import { pool, query, withTransaction } from '../src/db.js';
import { debit, credit } from '../src/lib/wallet.js';
import * as RB from '../src/game/rollingBall.js';
import { detailFor, capPayout, round2 } from '../src/game/settleDerive.js';

const BASE = 'http://localhost:4000';
const WSBASE = 'ws://localhost:4000';
const ALICE_ID = 1;
const CWD = new URL('..', import.meta.url).pathname;

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const money = (x) => Number(x).toFixed(2);
const tag = `RBC-${Date.now()}`;
let seq = 0;
const nextKey = (t) => `rb1c-${Date.now()}-${++seq}-${t}`;

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }),
  });
  return (await r.json()).token;
})();
if (!token) { console.log('FAIL 登录 alice 失败'); await pool.end(); process.exit(1); }

const api = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let j = null; try { j = await r.json(); } catch { /* 空体 */ }
  return { status: r.status, json: j };
};
const balance = async () => (await query('SELECT balance FROM wallets WHERE player_id = $1', [ALICE_ID])).rows[0].balance;
const runRepair = (execute) => {
  try { return execSync(`node scripts/repair_stuck_bets.mjs${execute ? ' --execute' : ''}`, { cwd: CWD, encoding: 'utf8' }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); }
};

function openClient() {
  const ws = new WebSocket(`${WSBASE}/ws/rounds?token=${encodeURIComponent(token)}&game=rollingball`);
  const msgs = [], waiters = [];
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    msgs.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
  });
  const ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return {
    ready,
    waitFor: (pred, timeout = 90000) => new Promise((resolve, reject) => {
      const hit = msgs.find(pred); if (hit) return resolve(hit);
      const t = setTimeout(() => reject(new Error('waitFor timeout')), timeout);
      waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    }),
    close: () => { try { ws.close(); } catch { /* 已断 */ } },
  };
}
// 等一个余量够下注的 bet1 窗
async function freshBet1(W, notRoundNo = null) {
  let f = await W.waitFor((m) => m.type === 'phase' && m.phase === 'bet1' && m.roundNo !== notRoundNo);
  if (f.endsAt - Date.now() < 4000) f = await W.waitFor((m) => m.type === 'phase' && m.phase === 'bet1' && m.roundNo !== f.roundNo);
  return f;
}

const W = openClient();
await W.ready;
const maxLedgerBefore = Number((await query('SELECT MAX(id) mx FROM ledger')).rows[0].mx);

// ══════════════ ⑤ 幂等键命名空间隔离 ══════════════
console.log('\n========== [⑤] 幂等隔离：老 /play ↔ 新 /bet 同 key 双向 ==========');
const winA = await freshBet1(W);
{
  // 正向：先老 /play，再新 /bet，同一个 key
  const K1 = nextKey('fwd');
  const old1 = await api('/round/rollingball/play', { bets: { big: 1 }, idempotencyKey: K1 });
  const new1 = await api('/round/rollingball/bet', { bets: { 'b1:red': 1 }, idempotencyKey: K1 });
  const rows1 = (await query('SELECT idempotency_key, round_id FROM bets WHERE idempotency_key IN ($1,$2) ORDER BY id', [K1, `pub-${K1}`])).rows;
  check('⑤ 正向（老 /play → 新 /bet 同 key）：两路各自成注，新路未被误判成重放',
    old1.status === 200 && new1.status === 200 && new1.json?.idempotent === false && rows1.length === 2
    && rows1[0].idempotency_key === K1 && rows1[1].idempotency_key === `pub-${K1}`,
    `old=${old1.status} new=${new1.status} idem=${new1.json?.idempotent} keys=[${rows1.map((r) => r.idempotency_key).join(',')}]`);

  // 反向：先新 /bet，再老 /play，同一个 key
  const K2 = nextKey('rev');
  const new2 = await api('/round/rollingball/bet', { bets: { 'b1:blue': 1 }, idempotencyKey: K2 });
  const old2 = await api('/round/rollingball/play', { bets: { small: 1 }, idempotencyKey: K2 });
  const rows2 = (await query('SELECT idempotency_key FROM bets WHERE idempotency_key IN ($1,$2) ORDER BY id', [K2, `pub-${K2}`])).rows;
  check('⑤ 反向（新 /bet → 老 /play 同 key）：两路各自成注，老路未被新路的注挡住',
    new2.status === 200 && old2.status === 200 && old2.json?.idempotent !== true && rows2.length === 2,
    `new=${new2.status} old=${old2.status} oldIdem=${old2.json?.idempotent} keys=[${rows2.map((r) => r.idempotency_key).join(',')}]`);

  // 重放语义不变：新路同 key 再打一次 → idempotent:true，不双扣
  const balBefore = await balance();
  const replay = await api('/round/rollingball/bet', { bets: { 'b1:red': 1 }, idempotencyKey: K1 });
  check('⑤ 重放语义不变：新路同 key 再打 → idempotent:true 且不双扣',
    replay.status === 200 && replay.json?.idempotent === true && money(await balance()) === money(balBefore),
    `json=${JSON.stringify(replay.json)} bal=${await balance()}`);
  // ledger 层也分域：两把键各自一条 rollingball_bet
  const ledK = (await query("SELECT idempotency_key FROM ledger WHERE idempotency_key IN ($1,$2)", [K1, `pub-${K1}`])).rows;
  check('⑤ ledger 幂等键同样分域（裸 key 与 pub- 各一条，不互撞）', ledK.length === 2, `keys=[${ledK.map((r) => r.idempotency_key).join(',')}]`);
}

// ══════════════ ① 前置：真投一注补硬闸样本（单行局，必中其一保证 win）══════════════
console.log('\n========== [①前置] 真投一注补硬闸对拍样本（单行 settled 局）==========');
const winB = await freshBet1(W, winA.roundNo);
const sample = await api('/round/rollingball/bet', { bets: { 'b1:big': 2, 'b1:small': 2 }, idempotencyKey: nextKey('sample') });
check('①前置 样本注受理（单 bets 行、必中其一 → 供硬闸对拍）', sample.status === 200 && sample.json?.accepted === true, `status=${sample.status}`);
const settleB = await W.waitFor((m) => m.type === 'phase' && m.phase === 'settle' && m.roundNo === winB.roundNo, 90000);
console.log(`  样本局 ${winB.roundNo} 已结算，三球=[${settleB.result.revealed.join(',')}]`);
await new Promise((r) => setTimeout(r, 800));

// ══════════════ 造合成局：①b 公期 stuck（满 3 球）/ ③ 缺球残局 ══════════════
console.log('\n========== [①③] 造合成局（真 debit，与退款/补派对称）==========');
const FIX = [40, 7, 12];
const SEL = { 'b1:big': 2, 'b1:small': 2 };
async function makeRound(no, status, result) {
  return withTransaction(async (client) => {
    const ins = await client.query(
      `INSERT INTO rounds (game, player_id, round_no, client_seed, result_hash, status, room, result)
       VALUES ('rollingball', NULL, $1, 'compatclient', $2, $3, NULL, $4::jsonb) RETURNING id`,
      [no, crypto.randomBytes(32).toString('hex'), status, JSON.stringify(result)],
    );
    const rid = ins.rows[0].id;
    await debit(client, { playerId: ALICE_ID, amount: '4.00', type: 'rollingball_bet', idempotencyKey: `${no}-bet`, roundId: rid });
    const b = await client.query(
      `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome, selections)
       VALUES ($1, $2, 4.00, $3, 'pending', $4::jsonb) RETURNING id`,
      [rid, ALICE_ID, `${no}-bet`, JSON.stringify(SEL)],
    );
    return { roundId: rid, betId: b.rows[0].id, roundNo: no };
  });
}
const STUCK = await makeRound(`${tag}-STUCK`, 'settled', { revealed: FIX, nonce: 0, status: 'settled', v: 2 });
const SHORT = await makeRound(`${tag}-SHORT`, 'settled', { revealed: FIX.slice(0, 2), nonce: 0, status: 'settled', v: 2 });
console.log(`  STUCK(满3球,应补派)=round#${STUCK.roundId}/bet#${STUCK.betId}  SHORT(缺球脏数据)=round#${SHORT.roundId}/bet#${SHORT.betId}`);

// 老局快照（②零动作对照）
const oldSnap = (await query(
  `SELECT b.id, b.outcome, b.settle_detail FROM bets b JOIN rounds r ON r.id=b.round_id
    WHERE r.game='rollingball' AND r.player_id IS NOT NULL ORDER BY b.id`)).rows;
const oldLedgerSum = (await query(
  `SELECT COALESCE(SUM(l.amount),0) s FROM ledger l JOIN rounds r ON r.id=l.round_id
    WHERE r.game='rollingball' AND r.player_id IS NOT NULL AND l.type='rollingball_payout'`)).rows[0].s;

// ══════════════ ①②③ repair dry-run ══════════════
console.log('\n========== [①②③] repair_stuck_bets DRY-RUN ==========');
const dry = runRepair(false);
console.log(dry.split('\n').filter((l) => /population|对拍|bet#|卡单汇总|硬闸结论|DRY-RUN|⚠/.test(l)).join('\n'));

const expectPay = (() => {
  const { hits, oddsByKey } = RB.hitsForBalls(FIX);
  let raw = 0;
  for (const [k, a] of Object.entries(SEL)) if (hits.has(k)) raw += a * oddsByKey[k];
  return round2(raw);
})();
check('① dry-run：硬闸对拍 rollingball 全等通过（复算 payout == ledger 实付）',
  /✅ rollingball bet#\d+ (win|lose): 复算payout=[\d.]+ vs ledger实付=[\d.]+ 全等/.test(dry) && /—— rollingball 对拍通过/.test(dry),
  (dry.match(/[✅❌] rollingball bet#.*/g) || ['(无 rollingball 对拍行)']).join(' | '));
check('③ 裁定③ 样本硬闸收窄：本次 population 只涉及 rollingball，其余 9 款不复算不连坐',
  /本次 population 涉及 1 款：rollingball/.test(dry) && !/—— speedgrid 对拍通过/.test(dry) && !/—— lineup 对拍通过/.test(dry),
  (dry.match(/本次 population 涉及.*/) || ['(未见 scope 行)'])[0]);
check('① dry-run 卡单列出 STUCK 注且应派 == 引擎离线复算',
  new RegExp(`bet#${STUCK.betId} .*应派\\$${expectPay}`).test(dry),
  (dry.match(new RegExp(`.*bet#${STUCK.betId}.*`)) || ['(未列出)'])[0] + ` 期望应派=$${expectPay}`);
check('③ dry-run 缺球局停手报错（不跳过不错派，明示只开出 2/3 球）',
  new RegExp(`❌ bet#${SHORT.betId} .*只开出 2/3 球`).test(dry),
  (dry.match(new RegExp(`.*bet#${SHORT.betId}.*`)) || ['(未报错)'])[0]);
check('② dry-run 卡单 population 不含任何老 per-player 注（零误报）',
  (dry.match(/bet#\d+/g) || []).every((m) => !oldSnap.some((o) => `bet#${o.id}` === m)),
  `population 中的 bet 编号=[${[...new Set(dry.split('\n').filter((l) => /^\s+[💰·❌] bet#/.test(l)).map((l) => (l.match(/bet#\d+/) || [''])[0]))].join(',')}]`);
check('① dry-run 未动钱（钱包与流水零变化）',
  Number((await query('SELECT MAX(id) mx FROM ledger')).rows[0].mx) === Number((await query("SELECT MAX(id) mx FROM ledger WHERE type <> 'x'")).rows[0].mx)
  && (await query("SELECT count(*) c FROM ledger WHERE idempotency_key = $1", [`repair-${STUCK.betId}`])).rows[0].c === '0',
  '');

// ══════════════ ① --execute 补派 ══════════════
console.log('\n========== [①③] repair_stuck_bets --EXECUTE ==========');
const balBeforeExec = await balance();
const exe = runRepair(true);
console.log(exe.split('\n').filter((l) => /population|bet#|卡单汇总|硬闸结论/.test(l)).join('\n'));

const stuckBet = (await query('SELECT outcome, settle_detail FROM bets WHERE id=$1', [STUCK.betId])).rows[0];
const stuckLed = (await query("SELECT amount, idempotency_key FROM ledger WHERE round_id=$1 AND type='rollingball_payout'", [STUCK.roundId])).rows;
check('① --execute 补派：注行翻 win + settle_detail 逐 key 三态',
  stuckBet.outcome === 'win'
  && JSON.stringify(stuckBet.settle_detail?.map((d) => `${d.key}:${d.outcome}`).sort()) === JSON.stringify(['b1:big:hit', 'b1:small:lose']),
  `outcome=${stuckBet.outcome} detail=${JSON.stringify(stuckBet.settle_detail)}`);
check('① --execute 补派：ledger 有 repair- 幂等键的派彩且金额 == 离线复算',
  stuckLed.length === 1 && stuckLed[0].idempotency_key === `repair-${STUCK.betId}` && Math.abs(Number(stuckLed[0].amount) - expectPay) < 0.005,
  `ledger=${JSON.stringify(stuckLed)} 期望=${expectPay}`);
check('① --execute 后钱包 == 补派前 + 应派额',
  Math.abs(Number(await balance()) - (Number(balBeforeExec) + expectPay)) < 0.005,
  `before=${balBeforeExec} after=${await balance()} 应派=${expectPay}`);

const shortBet = (await query('SELECT outcome FROM bets WHERE id=$1', [SHORT.betId])).rows[0];
const shortLed = (await query("SELECT count(*) c FROM ledger WHERE round_id=$1 AND type='rollingball_payout'", [SHORT.roundId])).rows[0].c;
check('③ --execute 缺球局仍不动：注留 pending、零派彩（宁停手不错派）',
  shortBet.outcome === 'pending' && shortLed === '0', `outcome=${shortBet.outcome} payoutRows=${shortLed}`);

const oldSnap2 = (await query(
  `SELECT b.id, b.outcome, b.settle_detail FROM bets b JOIN rounds r ON r.id=b.round_id
    WHERE r.game='rollingball' AND r.player_id IS NOT NULL ORDER BY b.id`)).rows;
const oldLedgerSum2 = (await query(
  `SELECT COALESCE(SUM(l.amount),0) s FROM ledger l JOIN rounds r ON r.id=l.round_id
    WHERE r.game='rollingball' AND r.player_id IS NOT NULL AND l.type='rollingball_payout'`)).rows[0].s;
check('② 老 per-player 注行 outcome/settle_detail 逐行零变（零动作）',
  JSON.stringify(oldSnap) === JSON.stringify(oldSnap2), `before=${oldSnap.length}行 after=${oldSnap2.length}行`);
check('② 老 per-player 局派彩总额零变（不重派）', money(oldLedgerSum) === money(oldLedgerSum2), `before=${oldLedgerSum} after=${oldLedgerSum2}`);

// ══════════════ ② 裁定①：老局 v1 复算 == 落库 ballPayout ══════════════
console.log('\n========== [②·裁定①] 老 per-player 局 v1 复算 vs 落库 ballPayout ==========');
{
  const rounds = (await query(`
    SELECT r.id, r.result FROM rounds r
     WHERE r.game='rollingball' AND r.player_id IS NOT NULL AND r.status='settled'
       AND jsonb_array_length(r.result->'balls') = 3
       AND NOT EXISTS (SELECT 1 FROM bets b WHERE b.round_id=r.id AND b.selections IS NULL)
     ORDER BY r.id DESC LIMIT 3`)).rows;
  check('②·裁定① 取到可复算的真实老局样本（≥1 局 × 3 球）', rounds.length >= 1, `样本局数=${rounds.length}`);
  let n = 0, bad = 0;
  for (const r of rounds) {
    const bets = (await query('SELECT id, selections, idempotency_key FROM bets WHERE round_id=$1 ORDER BY id', [r.id])).rows;
    for (const b of bets) {
      const entry = r.result.balls.find((x) => x.idempotencyKey === b.idempotency_key);
      const det = detailFor({ id: r.id, game: 'rollingball', result: r.result }, b);
      const capped = await capPayout('rollingball', det.rawTotalPayout);
      const same = round2(Number(capped)) === round2(Number(entry.ballPayout));
      if (!same) { bad++; console.log(`   ❌ round#${r.id} bet#${b.id} 第${entry.idx + 1}球: v1复算=${capped} vs 落库ballPayout=${entry.ballPayout}`); }
      else console.log(`   ✅ round#${r.id} bet#${b.id} 第${entry.idx + 1}球(球号${entry.ball}): v1复算=${round2(Number(capped))} == 落库ballPayout=${round2(Number(entry.ballPayout))}`);
      n++;
    }
  }
  check(`②·裁定① 老局 v1 复算 == 落库 ballPayout 分毫全等（${n} 行逐球对拍）`, n > 0 && bad === 0, `对拍 ${n} 行，不等 ${bad} 行`);
}

// ══════════════ ④ void 读闸 + /bets 注行 ══════════════
console.log('\n========== [④] void 读闸放行 partial revealed + /player/bets 注行 ==========');
const synth = [];
async function makeAliceRound(no, status, result, betOutcome, detail) {
  const ins = await query(
    `INSERT INTO rounds (game, player_id, round_no, client_seed, result_hash, status, result)
     VALUES ('rollingball', $1, $2, 'compatclient', $3, $4, $5::jsonb) RETURNING id`,
    [ALICE_ID, no, crypto.randomBytes(32).toString('hex'), status, JSON.stringify(result)]);
  const rid = ins.rows[0].id;
  const b = await query(
    `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome, selections, settle_detail)
     VALUES ($1,$2,4.00,$3,$4,$5::jsonb,$6::jsonb) RETURNING id`,
    [rid, ALICE_ID, `${no}-bet`, betOutcome, JSON.stringify(SEL), JSON.stringify(detail)]);
  synth.push({ roundId: rid, betId: b.rows[0].id });
  return { roundId: rid, betId: b.rows[0].id };
}
const REFUND_DETAIL = [{ key: 'b1:big', outcome: 'refund', payout: 2 }, { key: 'b1:small', outcome: 'refund', payout: 2 }];
const VOID_R = await makeAliceRound(`${tag}-VOID`, 'void', { revealed: FIX.slice(0, 2), nonce: 0, status: 'void', v: 2 }, 'refund', REFUND_DETAIL);
const LIVE_R = await makeAliceRound(`${tag}-LIVE`, 'betting', { revealed: FIX.slice(0, 1), nonce: 0, status: 'playing', v: 2 }, 'pending', null);

{
  const g = await api(`/round/${VOID_R.roundId}`);
  check('④ void 局读闸放行：GET /round/:id 全返 partial revealed（2 球，死局无先知价值）',
    g.status === 200 && g.json?.status === 'void' && JSON.stringify(g.json?.result?.revealed) === JSON.stringify(FIX.slice(0, 2)),
    `status=${g.status} result=${JSON.stringify(g.json?.result)}`);
  const g2 = await api(`/round/${LIVE_R.roundId}`);
  check('④ 对照：非终局 v:2 局读闸仍掐死 result（闸2 未被 void 放行连带削弱）',
    g2.status === 200 && g2.json?.result === null, `status=${g2.status} result=${JSON.stringify(g2.json?.result)}`);
  const bl = await api('/player/bets?game=rollingball&limit=50');
  const row = bl.json?.items?.find((x) => String(x.id) === String(VOID_R.betId));
  check('④ /player/bets：void 局注行 outcome=refund + settle_detail 完整（不受读闸影响）',
    !!row && row.outcome === 'refund'
    && JSON.stringify(row.settle_detail?.map((d) => `${d.key}:${d.outcome}`).sort()) === JSON.stringify(['b1:big:refund', 'b1:small:refund']),
    `row=${JSON.stringify(row)}`);
}
// 老局读侧零回归
{
  const oldSettled = (await query("SELECT id FROM rounds WHERE game='rollingball' AND player_id=$1 AND status='settled' AND result->'balls' IS NOT NULL ORDER BY id DESC LIMIT 1", [ALICE_ID])).rows[0];
  const oldPlaying = (await query("SELECT id FROM rounds WHERE game='rollingball' AND player_id=$1 AND status='playing' ORDER BY id DESC LIMIT 1", [ALICE_ID])).rows[0];
  const a = oldSettled ? await api(`/round/${oldSettled.id}`) : null;
  check('④ 老局零回归：per-player 终局仍全返 result（含 balls 明细）',
    !!a && a.status === 200 && Array.isArray(a.json?.result?.balls) && a.json.result.revealed.length === 3,
    `status=${a?.status} revealed=${JSON.stringify(a?.json?.result?.revealed)}`);
  const b = oldPlaying ? await api(`/round/${oldPlaying.id}`) : null;
  check('④ 老局零回归：per-player 进行中局仍走白名单（revealed/balls/status，未被 v:2 闸误伤）',
    !!b && b.status === 200 && b.json?.result && Array.isArray(b.json.result.revealed) && b.json.result.revealed.length < 3,
    `status=${b?.status} revealed=${JSON.stringify(b?.json?.result?.revealed)}`);
}

// ══════════════ 脏数据自清 ══════════════
console.log('\n========== 脏数据自清 ==========');
// ③ 缺球局：退款置 void（与真实 recoverOrphans 同口径，debit/credit 对称，不破链）
await withTransaction(async (client) => {
  await client.query(`UPDATE bets SET outcome='refund', settle_detail=$2 WHERE id=$1`,
    [SHORT.betId, JSON.stringify(Object.entries(SEL).map(([k, a]) => ({ key: k, outcome: 'refund', payout: a })))]);
  await credit(client, { playerId: ALICE_ID, amount: '4.00', type: 'rollingball_refund', idempotencyKey: `${SHORT.roundNo}-cleanup`, roundId: SHORT.roundId });
  await client.query(`UPDATE rounds SET status='void' WHERE id=$1`, [SHORT.roundId]);
});
// ④ 读闸合成局：无流水，整行删除
for (const s of synth) {
  await query('DELETE FROM bets WHERE id=$1', [s.betId]);
  await query('DELETE FROM rounds WHERE id=$1', [s.roundId]);
}
const leftover = (await query(
  "SELECT count(*) c FROM bets b JOIN rounds r ON r.id=b.round_id WHERE b.outcome='pending' AND r.status='settled' AND r.game='rollingball'")).rows[0].c;
check('自清：库内不再有滚球卡单（pending on settled），合成读闸局已删除',
  leftover === '0' && (await query('SELECT count(*) c FROM rounds WHERE round_no LIKE $1', [`${tag}-VOID%`])).rows[0].c === '0',
  `残留卡单=${leftover}`);
const after = runRepair(false);
check('自清后 repair dry-run 回到「无卡单」', /（无卡单）/.test(after), (after.match(/卡单汇总.*|（无卡单）/) || [''])[0]);

// ══════════════ ⑦ 增量对账 ══════════════
console.log('\n========== [⑦] 增量对账（--since，含补派/退款新行）==========');
let reconOut = '';
try { reconOut = execSync(`node scripts/reconcile_balances.mjs --since ${maxLedgerBefore}`, { cwd: CWD, encoding: 'utf8' }); }
catch (e) { reconOut = (e.stdout || '') + (e.stderr || ''); }
check('⑦ RECON OK：alice 钱包 balance == 链尾，新行无 FAIL',
  /PASS\s+wallet player_id=1\b/.test(reconOut) && !/FAIL\s+row .*player_id=1\b/.test(reconOut), '');
reconOut.split('\n').filter((l) => /player_id=1\b|RECON/.test(l)).forEach((l) => console.log('   ' + l));

W.close();
console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
