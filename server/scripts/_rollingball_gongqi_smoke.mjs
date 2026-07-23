// #公期化 单1a 验收 smoke（五断言）—— 滚球标准房六段相位机（roundHub segMode:'triple'）。
//
//  ① 闸1（WS 增量防先知）：逐段广播只带已开球；draw3 帧仍不给全量/serverSeed；
//     settle 帧才落全量 result + serverSeed 明文；中途进场 snapshot 也只给已开球。
//  ② 闸2（HTTP 最小暴露）：公期局非终局 GET /round/:id 不泄 result；库里非终局 result 只含
//     已开球（≤ 已开颗数）；老 per-player 局（无 v:2）终局全返 / 进行中走白名单，零回归。
//  ③ 残局：bet 段孤儿（result NULL）退 void；draw/settle 段孤儿满 3 球才补结，缺球一律退 void。
//  ④ 16 房回归：非滚球 16 房仍是 betting/locked/drawn/settled/idle 三跳链词汇，无 segIdx。
//  ⑤ 帧序录制：完整一局七帧 bet1→draw1→bet2→draw2→bet3→draw3→settle 无跳帧 + 段时长/locked 缓冲。
//
// 前置：服务端已起在 :4000（本脚本不起停进程），alice/alice123 可登录，DB 可直连。
// 写操作：仅 ③ 造 3 个自建孤儿轮（round_no 前缀 RBSM-）+ 对应注/流水，且 debit 与 refund 对称
//   （造注时真扣、恢复时真退），不破对账链。
import crypto from 'crypto';
import WebSocket from 'ws';
import { pool, query, withTransaction } from '../src/db.js';
import { debit } from '../src/lib/wallet.js';
import * as RB from '../src/game/rollingBall.js';
import { recoverOrphans } from '../src/ws/roundHub.js';

const BASE = 'http://localhost:4000';
const WSBASE = 'ws://localhost:4000';
const ALICE_ID = 1;
const LOCKED_MS = 2000;

let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const token = await (async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'alice123', type: 'player' }),
  });
  return (await r.json()).token;
})();
if (!token) { console.log('FAIL 登录 alice 失败'); await pool.end(); process.exit(1); }

function openClient(qs) {
  const ws = new WebSocket(`${WSBASE}/ws/rounds?token=${encodeURIComponent(token)}${qs}`);
  const msgs = [], waiters = [];
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    m._at = Date.now();
    msgs.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
  });
  const ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return {
    ws, msgs, ready,
    waitFor: (pred, timeout = 70000) => new Promise((resolve, reject) => {
      const hit = msgs.find(pred); if (hit) return resolve(hit);
      const t = setTimeout(() => reject(new Error('waitFor timeout')), timeout);
      waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    }),
    close: () => { try { ws.close(); } catch { /* 已断 */ } },
  };
}
const getRound = async (id) => {
  const r = await fetch(`${BASE}/round/${id}`, { headers: { authorization: `Bearer ${token}` } });
  let j = null; try { j = await r.json(); } catch { /* 空体 */ }
  return { status: r.status, json: j };
};

// ══════════════ ①⑤ 帧序录制 + 闸1（WS 增量）══════════════
console.log('\n========== [①⑤] 六段七帧帧序 + 闸1（WS 只给已开球）==========');
const A = openClient('&game=rollingball');
await A.ready;

// 从一个【新一期的 bet1】开始录，录到 settle 为止（中途不能接到上一局的尾巴）
const bet1 = await A.waitFor((m) => m.type === 'phase' && m.phase === 'bet1', 70000);
const roundNo = bet1.roundNo, roundId = bet1.roundId;
console.log(`  录制期号 ${roundNo}（roundId=${roundId}）…`);

const seq = [];
const frameOf = {};
for (const want of ['bet1', 'draw1', 'bet2', 'draw2', 'bet3', 'draw3', 'settle']) {
  // eslint-disable-next-line no-await-in-loop
  const f = await A.waitFor((m) => m.type === 'phase' && m.phase === want && m.roundNo === roundNo, 70000);
  frameOf[want] = f; seq.push(f.phase);
}
// 本期内 phase 帧的实际到达序（去掉别的 type），证明「无跳帧、无插帧」
const actualSeq = A.msgs.filter((m) => m.type === 'phase' && m.roundNo === roundNo).map((m) => m.phase);
const EXPECT_SEQ = ['bet1', 'draw1', 'bet2', 'draw2', 'bet3', 'draw3', 'settle'];
console.log('  实录帧序：' + actualSeq.join(' → '));
check('⑤ 帧序 = bet1→draw1→bet2→draw2→bet3→draw3→settle（七帧无跳帧无插帧）',
  JSON.stringify(actualSeq) === JSON.stringify(EXPECT_SEQ), `actual=[${actualSeq.join(',')}]`);
check('⑤ segIdx 逐段递增 0..5（settle 复用 draw3 段号 5 = draw3 尾窗）',
  EXPECT_SEQ.map((p) => frameOf[p].segIdx).join(',') === '0,1,2,3,4,5,5',
  `segIdx=[${EXPECT_SEQ.map((p) => frameOf[p].segIdx).join(',')}]`);

// 段时长 + locked 缓冲
const durs = EXPECT_SEQ.map((p) => frameOf[p].durationMs);
check('⑤ 段时长 = bet1 13s / draw1 5s / bet2 6s / draw2 5s / bet3 6s / draw3 5s / settle 4s（bet 段已扣 2s locked 尾）',
  JSON.stringify(durs) === JSON.stringify([13000, 5000, 6000, 5000, 6000, 5000, 4000]), `durationMs=[${durs.join(',')}]`);
for (const b of ['bet1', 'bet2', 'bet3']) {
  const f = frameOf[b];
  check(`② locked 缓冲：${b} 帧 lockedMs=2000 且 segEndsAt-endsAt=2000（窗关后静默锁 2s 再开球）`,
    f.lockedMs === LOCKED_MS && f.segEndsAt - f.endsAt === LOCKED_MS, `lockedMs=${f.lockedMs} gap=${f.segEndsAt - f.endsAt}`);
}
check('② locked 缓冲实测：draw1 帧到达时刻 ≥ bet1 下注截止 + 2000ms',
  frameOf.draw1._at - frameOf.bet1.endsAt >= LOCKED_MS - 150,
  `draw1到达-bet1截止=${frameOf.draw1._at - frameOf.bet1.endsAt}ms`);
const roundMs = frameOf.settle._at + frameOf.settle.durationMs - frameOf.bet1._at;
check('⑤ 一局总长 ≈50s（±2s）', Math.abs(roundMs - 50000) <= 2000, `实测 ${roundMs}ms`);

// —— 闸1：逐帧字段增量 ——
const b1 = frameOf.draw1.ball, b2 = frameOf.draw2.ball, b3 = frameOf.draw3.ball;
check('① bet1 帧：只给承诺（serverSeedHash 64 位）+ revealed 空，无 ball/result/serverSeed',
  frameOf.bet1.serverSeedHash?.length === 64 && Array.isArray(frameOf.bet1.revealed) && frameOf.bet1.revealed.length === 0
  && !('ball' in frameOf.bet1) && !('result' in frameOf.bet1) && !('serverSeed' in frameOf.bet1),
  `hash=${frameOf.bet1.serverSeedHash?.slice(0, 12)}… revealed=${JSON.stringify(frameOf.bet1.revealed)}`);
for (const [ph, n] of [['draw1', 1], ['bet2', 1], ['draw2', 2], ['bet3', 2], ['draw3', 3]]) {
  const f = frameOf[ph];
  check(`① ${ph} 帧只带已开 ${n} 球（无 result / 无 serverSeed / 无 balls 全量）`,
    Array.isArray(f.revealed) && f.revealed.length === n && !('result' in f) && !('serverSeed' in f) && !('balls' in f),
    `revealed=${JSON.stringify(f.revealed)} keys=[${Object.keys(f).filter((k) => k !== '_at').join(',')}]`);
}
check('① draw1 帧 ball=第1球，且帧内不含第2/3球号', frameOf.draw1.ball === b1
  && !JSON.stringify(frameOf.draw1.revealed).includes(String(b2)) && frameOf.draw1.revealed.length === 1,
  `ball=${b1} revealed=${JSON.stringify(frameOf.draw1.revealed)}`);
check('① draw3 帧给第3球但【仍不给】全量 result + serverSeed（settle 才给）',
  frameOf.draw3.ball === b3 && !('result' in frameOf.draw3) && !('serverSeed' in frameOf.draw3),
  `ball=${b3} keys=[${Object.keys(frameOf.draw3).filter((k) => k !== '_at').join(',')}]`);
check('① settle 帧才落全量 result（三球）+ serverSeed 明文',
  JSON.stringify(frameOf.settle.result?.revealed) === JSON.stringify([b1, b2, b3]) && typeof frameOf.settle.serverSeed === 'string',
  `result=${JSON.stringify(frameOf.settle.result)} seedLen=${frameOf.settle.serverSeed?.length}`);
check('① commit-reveal：sha256(settle.serverSeed) == bet1.serverSeedHash',
  crypto.createHash('sha256').update(frameOf.settle.serverSeed).digest('hex') === frameOf.bet1.serverSeedHash,
  `recomputed=${crypto.createHash('sha256').update(frameOf.settle.serverSeed).digest('hex').slice(0, 12)}…`);
check('① 三球合法：1–75 且同局不重复',
  [b1, b2, b3].every((n) => Number.isInteger(n) && n >= 1 && n <= 75) && new Set([b1, b2, b3]).size === 3,
  `balls=[${b1},${b2},${b3}]`);
// 复算：同 (serverSeed, clientSeed, nonce) 一把 rng 连抽三球必须逐位复现
{
  const { makeSeededRng } = await import('../src/lib/seededRng.js');
  const re = RB.drawThree(makeSeededRng(frameOf.settle.serverSeed, frameOf.bet1.clientSeed, frameOf.bet1.nonce));
  check('① 验公平：drawThree(同种子同 nonce) 逐位复现三球',
    JSON.stringify(re) === JSON.stringify([b1, b2, b3]), `复算=[${re.join(',')}] 实开=[${b1},${b2},${b3}]`);
}

// ══════════════ ①闸1（快照侧）+ ②闸2（HTTP/库）══════════════
console.log('\n========== [①②] 中途进场 snapshot + 闸2（HTTP/库最小暴露）==========');
// 等下一期，卡在 draw1 之后 / bet2 段中途开新连接
const nb1 = await A.waitFor((m) => m.type === 'phase' && m.phase === 'bet1' && m.roundNo !== roundNo, 70000);
const nRoundNo = nb1.roundNo, nRoundId = nb1.roundId;
const nDraw1 = await A.waitFor((m) => m.type === 'phase' && m.phase === 'draw1' && m.roundNo === nRoundNo, 40000);
await A.waitFor((m) => m.type === 'phase' && m.phase === 'bet2' && m.roundNo === nRoundNo, 20000);

const C = openClient('&game=rollingball');
await C.ready;
const snap = await C.waitFor((m) => m.type === 'snapshot', 10000);
check('① 中途（bet2 段）进场 snapshot 只给已开 1 球，且无 balls 全量/无 serverSeed',
  snap.phase === 'bet2' && Array.isArray(snap.revealed) && snap.revealed.length === 1 && snap.revealed[0] === nDraw1.ball
  && !('balls' in snap) && !('serverSeed' in snap) && !('result' in snap),
  `phase=${snap.phase} revealed=${JSON.stringify(snap.revealed)} keys=[${Object.keys(snap).filter((k) => k !== '_at').join(',')}]`);
check('① snapshot 仍给承诺 serverSeedHash（可验但不可算）', snap.serverSeedHash?.length === 64, `hash=${snap.serverSeedHash?.slice(0, 12)}…`);

// 闸2-a：公期局非终局 GET /round/:id
const live = await getRound(nRoundId);
check('② 闸2-a：非终局公期局 GET /round/:id 不泄 result（公期局 player_id 恒 NULL → 404）',
  live.status === 404 && !live.json?.result, `status=${live.status} body=${JSON.stringify(live.json)}`);
// 闸2-b：库里非终局 result 只含已开球
{
  const r = (await query('SELECT status, result FROM rounds WHERE id = $1', [nRoundId])).rows[0];
  const rev = r.result?.revealed || [];
  const terminal = ['settled', 'cashed', 'bust', 'void'].includes(r.status);
  check('② 闸2-b：非终局库内 result 只含已开球（此刻 1 球，绝不含未开球）',
    !terminal && rev.length === 1 && rev[0] === nDraw1.ball && r.result?.v === 2,
    `status=${r.status} result=${JSON.stringify(r.result)}`);
}
// 闸2-c：老 per-player 局零回归
{
  const oldSettled = (await query(
    "SELECT id FROM rounds WHERE game='rollingball' AND player_id=$1 AND status='settled' ORDER BY id DESC LIMIT 1", [ALICE_ID])).rows[0];
  const oldPlaying = (await query(
    "SELECT id FROM rounds WHERE game='rollingball' AND player_id=$1 AND status='playing' ORDER BY id DESC LIMIT 1", [ALICE_ID])).rows[0];
  if (oldSettled) {
    const g = await getRound(oldSettled.id);
    check('② 闸2-c：老 per-player 终局仍全返 result（验公平不回归）',
      g.status === 200 && Array.isArray(g.json?.result?.revealed) && g.json.result.revealed.length === 3 && Array.isArray(g.json?.result?.balls),
      `status=${g.status} revealed=${JSON.stringify(g.json?.result?.revealed)} hasBalls=${Array.isArray(g.json?.result?.balls)}`);
  } else check('② 闸2-c：老 per-player 终局仍全返 result', false, '库中无 alice 的 settled 老局，无法验');
  if (oldPlaying) {
    const g = await getRound(oldPlaying.id);
    check('② 闸2-c2：老 per-player 进行中局仍走白名单返已开球（未被 v:2 闸误伤）',
      g.status === 200 && g.json?.result && Array.isArray(g.json.result.revealed) && g.json.result.revealed.length < 3,
      `status=${g.status} result=${JSON.stringify(g.json?.result)}`);
  } else check('② 闸2-c2：老 per-player 进行中局仍走白名单', false, '库中无 alice 的 playing 老局，无法验');
}
C.close(); A.close();

// ══════════════ ③④ 残局退 void / 满球补结 ══════════════
console.log('\n========== [③④] 残局退 void + 满 3 球补结（recoverOrphans 滚球分支）==========');
const tag = `RBSM-${Date.now()}`;
// 三球固定选一组：b1=40（big 中、small 不中）保证补结局必有派彩
const FIX_BALLS = [40, 7, 12];
const SEL = { 'b1:big': 2, 'b1:small': 2 };   // 复合 key（球序命名空间），必中其一

async function makeOrphan(no, status, result) {
  return withTransaction(async (client) => {
    const ins = await client.query(
      `INSERT INTO rounds (game, player_id, round_no, client_seed, result_hash, status, room, result)
       VALUES ('rollingball', NULL, $1, 'smokeclient', $2, $3, NULL, $4::jsonb) RETURNING id`,
      [no, crypto.randomBytes(32).toString('hex'), status, result ? JSON.stringify(result) : null],
    );
    const rid = ins.rows[0].id;
    // 与正常下注对称：真扣钱 + 真挂 pending 注（这样恢复退款/派彩后对账链不破）
    await debit(client, { playerId: ALICE_ID, amount: '4.00', type: 'rollingball_bet', idempotencyKey: `${no}-bet`, roundId: rid });
    const b = await client.query(
      `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome, selections)
       VALUES ($1, $2, 4.00, $3, 'pending', $4::jsonb) RETURNING id`,
      [rid, ALICE_ID, `${no}-bet`, JSON.stringify(SEL)],
    );
    return { roundId: rid, betId: b.rows[0].id };
  });
}
const balBefore = (await query('SELECT balance FROM wallets WHERE player_id = $1', [ALICE_ID])).rows[0].balance;
const T1 = await makeOrphan(`${tag}-T1`, 'betting', null);                                            // bet 段孤儿：无 result
const T2 = await makeOrphan(`${tag}-T2`, 'drawn', { revealed: FIX_BALLS.slice(0, 2), nonce: 0, status: 'drawn', v: 2 });  // 缺球残局
const T3 = await makeOrphan(`${tag}-T3`, 'drawn', { revealed: FIX_BALLS, nonce: 0, status: 'drawn', v: 2 });              // 满 3 球
console.log(`  造孤儿：T1(betting,无result)=#${T1.roundId} / T2(drawn,2球残局)=#${T2.roundId} / T3(drawn,满3球)=#${T3.roundId}`);

console.log('  ── recoverOrphans 输出 ──');
await recoverOrphans({ onlyRoundIds: [T1.roundId, T2.roundId, T3.roundId] });

const rowOf = async (rid) => (await query('SELECT status FROM rounds WHERE id = $1', [rid])).rows[0].status;
const betOf = async (bid) => (await query('SELECT outcome, settle_detail FROM bets WHERE id = $1', [bid])).rows[0];
const ledOf = async (rid) => (await query('SELECT type, amount FROM ledger WHERE round_id = $1 ORDER BY id', [rid])).rows;

for (const [name, T] of [['T1（bet 段孤儿·result NULL）', T1], ['T2（draw 段孤儿·只 2 球残局）', T2]]) {
  const st = await rowOf(T.roundId), bt = await betOf(T.betId), ld = await ledOf(T.roundId);
  check(`③ ${name} → 轮置 void`, st === 'void', `status=${st}`);
  check(`③ ${name} → 注 outcome=refund`, bt.outcome === 'refund', `outcome=${bt.outcome}`);
  check(`③ ${name} → 有 rollingball_refund 全额退款流水 $4`,
    ld.some((l) => l.type === 'rollingball_refund' && Number(l.amount) === 4), `ledger=${JSON.stringify(ld)}`);
}
{
  // ④ 满 3 球：独立复算分支补结，派彩必须 == 引擎离线复算（hitsForBalls + oddsFor 单一出处）
  const { hits, oddsByKey } = RB.hitsForBalls(FIX_BALLS);
  let expect = 0;
  for (const [k, a] of Object.entries(SEL)) if (hits.has(k)) expect += Math.round(a * oddsByKey[k] * 100) / 100;
  const st = await rowOf(T3.roundId), bt = await betOf(T3.betId), ld = await ledOf(T3.roundId);
  const paid = ld.filter((l) => l.type === 'rollingball_payout').reduce((s, l) => s + Number(l.amount), 0);
  check('④ T3（满 3 球）→ 轮置 settled（补结非退款）', st === 'settled', `status=${st}`);
  check('④ T3 → 注 outcome=win 且无 refund 流水',
    bt.outcome === 'win' && !ld.some((l) => l.type === 'rollingball_refund'), `outcome=${bt.outcome} ledger=${JSON.stringify(ld)}`);
  check('④ T3 → 派彩 == 引擎离线复算（hitsForBalls+oddsFor）',
    Math.abs(paid - expect) < 0.005, `实派=${paid} 复算=${expect} hits=[${[...hits].join(',')}] odds=${JSON.stringify(oddsByKey['b1:big'])}`);
  check('④ T3 → settle_detail 逐 key 三态（b1:big hit / b1:small lose）',
    JSON.stringify(bt.settle_detail?.map((d) => `${d.key}:${d.outcome}`).sort()) === JSON.stringify(['b1:big:hit', 'b1:small:lose']),
    JSON.stringify(bt.settle_detail));
}
{
  const balAfter = (await query('SELECT balance FROM wallets WHERE player_id = $1', [ALICE_ID])).rows[0].balance;
  const { hits, oddsByKey } = RB.hitsForBalls(FIX_BALLS);
  let win3 = 0;
  for (const [k, a] of Object.entries(SEL)) if (hits.has(k)) win3 += Math.round(a * oddsByKey[k] * 100) / 100;
  // T1/T2 净零（扣4退4），T3 扣 4 派 win3
  const expectDelta = Math.round((win3 - 4) * 100) / 100;
  check('③④ 钱包净变化 == T1/T2 退平 + T3 补结派彩（钱层无漏无重）',
    Math.abs(Number(balAfter) - Number(balBefore) - expectDelta) < 0.005,
    `before=${balBefore} after=${balAfter} 预期Δ=${expectDelta}`);
}

// ══════════════ ④ 16 房回归（非滚球房仍是三跳链）══════════════
console.log('\n========== [④] 非滚球 16 房回归（原三跳链词汇，无 segIdx）==========');
const OTHER_ROOMS = [
  ['speedgrid', null], ['speedgrid', '15s'], ['numberup', null], ['numberup', '15s'],
  ['derbyday', null], ['dominoduel', null], ['hattrick', null], ['hattrick', '15s'],
  ['goldenboot', null], ['goldenboot', '15s'], ['halftime', null], ['halftime', '15s'],
  ['wuxing', null], ['wuxing', '15s'], ['lineup', null], ['lineup', '15s'],
];
check('④ 非滚球房共 16 间（代码为准）', OTHER_ROOMS.length === 16, `count=${OTHER_ROOMS.length}`);
const LEGACY_PHASES = new Set(['betting', 'locked', 'drawn', 'settled', 'idle']);
const SEG_PHASES = new Set(['bet1', 'draw1', 'bet2', 'draw2', 'bet3', 'draw3', 'settle']);
const results = await Promise.all(OTHER_ROOMS.map(async ([g, r]) => {
  const R = openClient(`&game=${g}${r ? `&room=${r}` : ''}`);
  try {
    await R.ready;
    const s = await R.waitFor((m) => m.type === 'snapshot', 10000);
    await sleep(1200);
    const phases = R.msgs.filter((m) => m.type === 'phase').map((m) => m.phase);
    const all = [s.phase, ...phases];
    return { label: `${g}${r ? ':' + r : ''}`, ok: all.every((p) => LEGACY_PHASES.has(p)) && !all.some((p) => SEG_PHASES.has(p)) && !('segIdx' in s), phases: all };
  } catch (e) {
    return { label: `${g}${r ? ':' + r : ''}`, ok: false, phases: [e.message] };
  } finally { R.close(); }
}));
for (const x of results) check(`④ ${x.label} 仍走三跳链（phase ∈ betting/locked/drawn/settled/idle，无 segIdx）`, x.ok, `phases=[${x.phases.join(',')}]`);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
