// Aviator 下注/兑现/结算端到端冒烟测试（2 玩家，全绿）
// 覆盖：
//   1. alice / charlie 分别登录 -> 各自带 token 连 /ws/aviator -> 下注 100
//   2. 幂等：alice 对同一局重复发 bet -> 命中幂等，余额不再变化（psql 佐证）
//   3. 起飞后 alice 抢第一个 tick 立刻兑现（低倍兑现，几乎必成）；charlie 不兑现，等崩盘判输
//   4. 兑现竞态兜底：若本局在第一个 tick 之前就崩了，或 alice 的 cashout 被判「已过崩盘点」，
//      判定本局失败，等这局收尾（crashed+settled）后自动重试下一局（不重连 socket，
//      同一个连接会持续收到之后每一局的广播），最多重试 MAX_ROUND_RETRIES 局
//   5. 用真实 SQL 查询（等价于 psql）核对：wallets 余额、bets.outcome、
//      commissions（60/30/10 三级链之和 = 输掉的 100）、ledger 双流水
//
// 用法：先 `node src/index.js` 起服务，再 `node test/aviator_bet_smoke.js`。
import 'dotenv/config';
import WebSocket from 'ws';
import pg from 'pg';

const { Client } = pg;

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4000';
const WS_URL = process.env.AVIATOR_WS_URL || 'ws://127.0.0.1:4000/ws/aviator';
const BET_AMOUNT = 100; // number，发到 ws 里；服务端会格式化成两位小数字符串
const MAX_ROUND_RETRIES = 6; // 瞬崩/竞态兑现被拒时的最大重试局数
const TOTAL_TIMEOUT_MS = 90000; // 总超时（多局重试 + betting/flying/crashed 完整周期都要留出余量）

function fail(msg) {
  console.error(`❌ 断言失败：${msg}`);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

function closeEnough(a, b, eps = 0.01) {
  return Math.abs(a - b) < eps;
}

async function login(username, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, type: 'player' }),
  });
  const body = await res.json();
  if (!res.ok || !body.token) {
    fail(`登录失败 username=${username}：${JSON.stringify(body)}`);
  }
  return body; // { token, type, id, username }
}

async function getBalance(db, playerId) {
  const result = await db.query('SELECT balance FROM wallets WHERE player_id = $1', [playerId]);
  return parseFloat(result.rows[0].balance);
}

/**
 * 给一个 ws 连接挂一个「等下一条满足 predicate 的消息」的小工具。
 * 只关心「从现在起收到的新消息」，不缓存历史消息 —— 这正好符合我们的用法：
 * 每次都是等待「接下来将要发生」的事件（下一局 betting / 下一次 tick / cashout 回执等）。
 */
function makeInbox(ws, label) {
  const waiters = [];

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      fail(`[${label}] 收到的消息不是合法 JSON：${raw.toString()}`);
      return;
    }
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].predicate(msg)) {
        const { resolve } = waiters[i];
        waiters.splice(i, 1);
        resolve(msg);
      }
    }
  });

  ws.on('error', (err) => {
    fail(`[${label}] WebSocket 连接错误：${err.message}`);
  });

  return {
    waitFor(predicate, timeoutMs, waitLabel) {
      return new Promise((resolve, reject) => {
        const entry = { predicate, resolve: null };
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(entry);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`[${label}] 等待「${waitLabel}」超时（${timeoutMs}ms）`));
        }, timeoutMs);
        entry.resolve = (msg) => {
          clearTimeout(timer);
          resolve(msg);
        };
        waiters.push(entry);
      });
    },
  };
}

function connectPlayer(token, label) {
  const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
  const inbox = makeInbox(ws, label);
  return { ws, inbox };
}

/**
 * 跑一整局：等 betting -> 双方下注（含幂等验证）-> 起飞后 alice 抢第一个 tick 兑现，
 * charlie 不兑现 -> 等 crashed + settled。
 * 返回 { success:false } 表示本局判定失败（瞬崩/竞态兑现被拒），调用方应重试下一局；
 * 返回 { success:true, ... } 表示本局 alice 兑现成功，可以据此做最终 DB 校验。
 */
async function playOneRound(ctx) {
  const { aliceWs, aliceInbox, charlieWs, charlieInbox, db, aliceId, charlieId } = ctx;

  const betting = await aliceInbox.waitFor((m) => m.type === 'betting', 20000, 'betting 广播');
  await charlieInbox.waitFor((m) => m.type === 'betting' && m.roundId === betting.roundId, 20000, 'betting 广播(charlie)');
  const roundId = betting.roundId;
  console.log(`\n[round ${roundId}] === betting 阶段开始，窗口 ${betting.waitMs}ms ===`);

  const roundBaseAlice = await getBalance(db, aliceId);
  const roundBaseCharlie = await getBalance(db, charlieId);
  console.log(`[round ${roundId}] 本局起始余额（psql）alice=${roundBaseAlice.toFixed(2)} charlie=${roundBaseCharlie.toFixed(2)}`);

  // ---- 下注 ----
  aliceWs.send(JSON.stringify({ type: 'bet', amount: BET_AMOUNT }));
  const aliceAck = await aliceInbox.waitFor((m) => m.type === 'bet_ack' || m.type === 'bet_rejected', 5000, 'alice bet_ack');
  assert(aliceAck.type === 'bet_ack' && aliceAck.idempotent === false, `alice 首次下注异常：${JSON.stringify(aliceAck)}`);
  assert(
    closeEnough(parseFloat(aliceAck.balanceAfter), roundBaseAlice - BET_AMOUNT),
    `alice 下注后 balanceAfter 不符：${aliceAck.balanceAfter}`,
  );
  console.log(`[round ${roundId}] alice 下注成功 amount=${aliceAck.amount} balanceAfter=${aliceAck.balanceAfter}`);

  charlieWs.send(JSON.stringify({ type: 'bet', amount: BET_AMOUNT }));
  const charlieAck = await charlieInbox.waitFor((m) => m.type === 'bet_ack' || m.type === 'bet_rejected', 5000, 'charlie bet_ack');
  assert(charlieAck.type === 'bet_ack' && charlieAck.idempotent === false, `charlie 首次下注异常：${JSON.stringify(charlieAck)}`);
  assert(
    closeEnough(parseFloat(charlieAck.balanceAfter), roundBaseCharlie - BET_AMOUNT),
    `charlie 下注后 balanceAfter 不符：${charlieAck.balanceAfter}`,
  );
  console.log(`[round ${roundId}] charlie 下注成功 amount=${charlieAck.amount} balanceAfter=${charlieAck.balanceAfter}`);

  // ---- 幂等验证：alice 对同一局重复下注 ----
  aliceWs.send(JSON.stringify({ type: 'bet', amount: BET_AMOUNT }));
  const aliceIdemAck = await aliceInbox.waitFor((m) => m.type === 'bet_ack', 5000, 'alice 幂等 bet_ack');
  assert(aliceIdemAck.idempotent === true, `alice 重复下注未命中幂等：${JSON.stringify(aliceIdemAck)}`);
  const balanceAfterDup = await getBalance(db, aliceId);
  assert(
    closeEnough(balanceAfterDup, roundBaseAlice - BET_AMOUNT),
    `幂等命中后余额发生了变化：${balanceAfterDup}（应仍是 ${roundBaseAlice - BET_AMOUNT}）`,
  );
  console.log(`[round ${roundId}] ✓ 幂等验证通过：alice 重复下注不重复扣钱（psql 余额=${balanceAfterDup.toFixed(2)}）`);

  // ---- 起飞：alice 抢第一个 tick 立刻兑现，charlie 不兑现 ----
  const firstFlyingEvent = await aliceInbox.waitFor(
    (m) => m.type === 'tick' || m.type === 'crashed',
    15000,
    '第一个 tick 或 crashed',
  );

  let cashoutMsg = null;
  if (firstFlyingEvent.type === 'tick') {
    aliceWs.send(JSON.stringify({ type: 'cashout' }));
    cashoutMsg = await aliceInbox.waitFor(
      (m) => m.type === 'cashout_ok' || m.type === 'cashout_rejected',
      5000,
      'cashout 回执',
    );
  } else {
    console.log(`[round ${roundId}] 本局在第一个 tick 之前就已经 crashed（瞬崩），alice 来不及兑现`);
  }

  const crashedMsg =
    firstFlyingEvent.type === 'crashed'
      ? firstFlyingEvent
      : await aliceInbox.waitFor((m) => m.type === 'crashed' && m.roundId === roundId, 10000, 'crashed 广播');
  await aliceInbox.waitFor((m) => m.type === 'settled' && m.roundId === roundId, 10000, 'settled 广播');

  if (!cashoutMsg || cashoutMsg.type !== 'cashout_ok') {
    const reason = cashoutMsg ? cashoutMsg.reason : '瞬崩无 tick';
    console.log(`[round ${roundId}] 本局判定失败（${reason}），重试下一局`);
    return { success: false };
  }

  console.log(
    `[round ${roundId}] ✓ alice 兑现成功 multiplier=${cashoutMsg.multiplier} payout=${cashoutMsg.payout} balanceAfter=${cashoutMsg.balanceAfter}`,
  );
  console.log(`[round ${roundId}] crashPoint=${crashedMsg.crashPoint}（reveal serverSeed=${crashedMsg.serverSeed}）`);

  return {
    success: true,
    roundId,
    roundBaseAlice,
    roundBaseCharlie,
    payout: parseFloat(cashoutMsg.payout),
    multiplier: cashoutMsg.multiplier,
  };
}

async function main() {
  const overallTimeout = setTimeout(() => {
    fail(`总超时（${TOTAL_TIMEOUT_MS}ms）：没能在限定时间内跑完全部断言`);
  }, TOTAL_TIMEOUT_MS);
  overallTimeout.unref?.();

  const db = new Client({ connectionString: process.env.DB_URL });
  await db.connect();

  console.log('===== 步骤 1：登录 + 记录初始余额 =====');
  const aliceAuth = await login('alice', 'alice123');
  const charlieAuth = await login('charlie', 'ml123');
  console.log(`alice id=${aliceAuth.id}  charlie id=${charlieAuth.id}`);

  const initialAlice = await getBalance(db, aliceAuth.id);
  const initialCharlie = await getBalance(db, charlieAuth.id);
  console.log(`（psql）登录后初始余额：alice=${initialAlice.toFixed(2)} charlie=${initialCharlie.toFixed(2)}`);

  console.log('\n===== 步骤 2：建立 WS 连接（带 token 认证）=====');
  const { ws: aliceWs, inbox: aliceInbox } = connectPlayer(aliceAuth.token, 'alice');
  const { ws: charlieWs, inbox: charlieInbox } = connectPlayer(charlieAuth.token, 'charlie');

  await Promise.all([
    new Promise((resolve, reject) => {
      aliceWs.once('open', resolve);
      aliceWs.once('error', reject);
    }),
    new Promise((resolve, reject) => {
      charlieWs.once('open', resolve);
      charlieWs.once('error', reject);
    }),
  ]);
  console.log('✓ 两个 WS 连接均已建立');

  console.log('\n===== 步骤 3：下注 / 兑现 / 结算（含瞬崩重试）=====');
  let outcome = null;
  let attempt = 0;
  while (attempt < MAX_ROUND_RETRIES && !(outcome && outcome.success)) {
    attempt += 1;
    console.log(`\n----- 第 ${attempt} 次尝试 -----`);
    // eslint-disable-next-line no-await-in-loop
    outcome = await playOneRound({ aliceWs, aliceInbox, charlieWs, charlieInbox, db, aliceId: aliceAuth.id, charlieId: charlieAuth.id });
  }

  if (!outcome || !outcome.success) {
    fail(`重试 ${MAX_ROUND_RETRIES} 局后 alice 仍未能成功兑现，放弃`);
  }

  const { roundId, roundBaseAlice, roundBaseCharlie, payout } = outcome;

  console.log('\n===== 步骤 4：结算后 psql 校验 =====');

  // -- 余额 --
  const finalAlice = await getBalance(db, aliceAuth.id);
  const finalCharlie = await getBalance(db, charlieAuth.id);
  const expectedAlice = roundBaseAlice - BET_AMOUNT + payout;
  const expectedCharlie = roundBaseCharlie - BET_AMOUNT;
  console.log(
    `alice 最终余额=${finalAlice.toFixed(2)}（预期 ${expectedAlice.toFixed(2)} = base ${roundBaseAlice.toFixed(2)} - ${BET_AMOUNT} + payout ${payout.toFixed(2)}）`,
  );
  console.log(`charlie 最终余额=${finalCharlie.toFixed(2)}（预期 ${expectedCharlie.toFixed(2)} = base ${roundBaseCharlie.toFixed(2)} - ${BET_AMOUNT}）`);
  assert(closeEnough(finalAlice, expectedAlice), `alice 最终余额不符：实际=${finalAlice} 预期=${expectedAlice}`);
  assert(closeEnough(finalCharlie, expectedCharlie), `charlie 最终余额不符：实际=${finalCharlie} 预期=${expectedCharlie}`);
  console.log('✓ 余额校验通过');

  // -- bets.outcome --
  const aliceBet = await db.query('SELECT outcome FROM bets WHERE round_id = $1 AND player_id = $2', [roundId, aliceAuth.id]);
  const charlieBet = await db.query('SELECT outcome FROM bets WHERE round_id = $1 AND player_id = $2', [roundId, charlieAuth.id]);
  console.log(`bets 表：alice outcome=${aliceBet.rows[0]?.outcome}  charlie outcome=${charlieBet.rows[0]?.outcome}`);
  assert(aliceBet.rows[0]?.outcome === 'win', `alice 本局 bets.outcome 应为 win，实际=${aliceBet.rows[0]?.outcome}`);
  assert(charlieBet.rows[0]?.outcome === 'lose', `charlie 本局 bets.outcome 应为 lose，实际=${charlieBet.rows[0]?.outcome}`);
  console.log('✓ bets.outcome 校验通过');

  // -- commissions（win_loss，本局，链条 ml_subB(10%) -> ml_midA(30%) -> ml_boss(60%)）--
  const commissionsResult = await db.query(
    `SELECT c.agent_id, a.username, c.amount
       FROM commissions c
       JOIN agents a ON a.id = c.agent_id
      WHERE c.round_id = $1 AND c.type = 'win_loss'
      ORDER BY c.amount DESC`,
    [roundId],
  );
  console.log('commissions（win_loss，本局 charlie 输 100）：');
  for (const row of commissionsResult.rows) {
    console.log(`  agent=${row.username}(id=${row.agent_id}) amount=${row.amount}`);
  }
  assert(commissionsResult.rows.length === 3, `应有 3 级 win_loss 分成记录，实际=${commissionsResult.rows.length}`);
  const commissionSum = commissionsResult.rows.reduce((s, r) => s + parseFloat(r.amount), 0);
  assert(closeEnough(commissionSum, BET_AMOUNT), `分成总和应等于亏损额 ${BET_AMOUNT}，实际=${commissionSum}`);
  const byName = Object.fromEntries(commissionsResult.rows.map((r) => [r.username, parseFloat(r.amount)]));
  assert(closeEnough(byName.ml_boss, BET_AMOUNT * 0.6), `ml_boss 分成应为 ${BET_AMOUNT * 0.6}，实际=${byName.ml_boss}`);
  assert(closeEnough(byName.ml_midA, BET_AMOUNT * 0.3), `ml_midA 分成应为 ${BET_AMOUNT * 0.3}，实际=${byName.ml_midA}`);
  assert(closeEnough(byName.ml_subB, BET_AMOUNT * 0.1), `ml_subB 分成应为 ${BET_AMOUNT * 0.1}，实际=${byName.ml_subB}`);
  console.log(`✓ commissions 校验通过：60/30/10 之和=${commissionSum.toFixed(2)}`);

  const aliceCommissions = await db.query(
    `SELECT count(*)::int AS cnt FROM commissions WHERE round_id = $1 AND player_id = $2 AND type = 'win_loss'`,
    [roundId, aliceAuth.id],
  );
  assert(aliceCommissions.rows[0].cnt === 0, 'alice 赢的这一局不应该产生 win_loss 分成记录');
  console.log('✓ alice 赢的这一局确认没有产生 win_loss 分成');

  // -- ledger 双流水 --
  const aliceLedger = await db.query('SELECT type, amount FROM ledger WHERE round_id = $1 AND player_id = $2 ORDER BY id', [
    roundId,
    aliceAuth.id,
  ]);
  const charlieLedger = await db.query('SELECT type, amount FROM ledger WHERE round_id = $1 AND player_id = $2 ORDER BY id', [
    roundId,
    charlieAuth.id,
  ]);
  console.log('ledger（alice）：', aliceLedger.rows);
  console.log('ledger（charlie）：', charlieLedger.rows);
  assert(
    aliceLedger.rows.some((r) => r.type === 'aviator_bet' && closeEnough(parseFloat(r.amount), BET_AMOUNT)),
    'alice ledger 应有 aviator_bet 扣款流水',
  );
  assert(
    aliceLedger.rows.some((r) => r.type === 'aviator_payout' && closeEnough(parseFloat(r.amount), payout)),
    'alice ledger 应有 aviator_payout 派彩流水',
  );
  assert(
    charlieLedger.rows.some((r) => r.type === 'aviator_bet' && closeEnough(parseFloat(r.amount), BET_AMOUNT)),
    'charlie ledger 应有 aviator_bet 扣款流水',
  );
  console.log('✓ ledger 双流水校验通过');

  clearTimeout(overallTimeout);
  aliceWs.close();
  charlieWs.close();
  await db.end();

  console.log('\n✅ AVIATOR BET SMOKE 全绿');
  process.exit(0);
}

main().catch((err) => {
  fail(`未捕获异常：${err.stack || err.message}`);
});
