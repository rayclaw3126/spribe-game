// 孤儿注恢复冒烟（roundHub recoverOrphans）—— 一次性验收工具，非生产脚本（下划线前缀标注）。
//
// 验的是「进程被杀 → 重启自愈」这条路，没法纯单测：必须真起进程、真下注、真 kill -9、真重启，
// 所以本脚本只做【造孤儿 + 断言】，起停进程由调用方（人/bash）在外面做。
//
// 子命令：
//   snapshot <playerId>            → 打 JSON {balance, maxLedgerId}，存盘供事后对比
//   orphans                        → 打当前 betting/drawn 孤儿轮 + pending 注统计
//   prep-t2 <betId>                → T2 造数：给该注所在的 betting 轮用 roundSpins 造合法 result
//                                    → UPDATE 成 drawn（模拟「开奖已落库但结算前被杀」）
//   prep-t2b <betId>               → T2b 造数：同 prep-t2，但在真实种子空间里【搜】到一个让本注全输的
//                                    result（仍走 roundSpins 真派生，只是选种子；禁手捏 drawResult）
//   assert-t1 <betId> <balBefore>  → betting 路径断言：refund 流水在 / 余额回原 / outcome=refund / 轮 void
//   assert-t2 <betId>              → drawn 路径断言：原键结算 / payout == 引擎复算 / 轮 settled
//   assert-t2b <betId> <balBefore> → drawn 全输分支：outcome=lose / 0 payout 流水 / commissions 链式分成
//                                    == 正常 lose 局同比例 / 余额只扣本金
//   assert-t3 <maxLedgerId>        → 双启动断言：该 id 之后无新增 recover 流水（0 重复 credit）
//   commissions <betId>            → 打该注所在轮的 commissions 行（供双启动前后对比）
//
// 只读为主；唯一写操作是 prep-t2（造 drawn 数据），且只碰指定注所在的那一轮。
import { query, pool } from '../src/db.js';
import { makeSeededRng } from '../src/lib/seededRng.js';
import { ROUND_SPINS } from '../src/game/roundSpins.js';
import { computeDetail, capPayout, drawOf } from '../src/game/settleDerive.js';

const [cmd, ...rest] = process.argv.slice(2);
let fails = 0;
const ok = (pass, label, detail = '') => {
  if (!pass) fails++;
  console.log(`  ${pass ? '✅' : '❌'} ${label}${detail ? `  —— ${detail}` : ''}`);
};
const money = (x) => Number(x).toFixed(2);

// 明细数组对拍（key→{outcome,payout} 归一）——照 repair_stuck_bets.mjs detailEq 同口径。
// 必须归一：settle_detail 存的是 JSONB，回读时 Postgres 会重排对象键序（按键长+字典序），
// 裸 JSON.stringify 比对会因键序不同假红。
function detailEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const norm = arr => Object.fromEntries(arr.map(x => [x.key, `${x.outcome}:${Number(x.payout).toFixed(2)}`]));
  const na = norm(a), nb = norm(b);
  const keys = new Set([...Object.keys(na), ...Object.keys(nb)]);
  for (const k of keys) if (na[k] !== nb[k]) return false;
  return true;
}

async function betRow(betId) {
  const r = await query(
    `SELECT b.id, b.player_id, b.round_id, b.amount, b.outcome, b.selections, b.settle_detail,
            r.game, r.round_no, r.status AS round_status, r.result, r.server_seed, r.client_seed
       FROM bets b JOIN rounds r ON r.id = b.round_id WHERE b.id = $1`,
    [betId],
  );
  if (r.rowCount === 0) throw new Error(`bet#${betId} 不存在`);
  return r.rows[0];
}

// —— snapshot：记录动手前的余额 + ledger 水位 ——
async function snapshot(playerId) {
  const b = (await query('SELECT balance FROM wallets WHERE player_id = $1', [playerId])).rows[0];
  const m = (await query('SELECT COALESCE(MAX(id), 0) AS mx FROM ledger')).rows[0];
  console.log(JSON.stringify({ playerId: Number(playerId), balance: b.balance, maxLedgerId: Number(m.mx) }));
}

// —— orphans：孤儿轮现状 ——
async function orphans() {
  const rows = (await query(
    `SELECT r.game, r.status, count(DISTINCT r.id) AS rounds,
            count(b.id) FILTER (WHERE b.outcome = 'pending') AS pending_bets,
            COALESCE(sum(b.amount) FILTER (WHERE b.outcome = 'pending'), 0) AS stake
       FROM rounds r LEFT JOIN bets b ON b.round_id = r.id
      WHERE r.status IN ('betting', 'drawn')
      GROUP BY 1, 2 ORDER BY 1, 2`,
  )).rows;
  if (rows.length === 0) { console.log('  （无 betting/drawn 孤儿轮）'); return; }
  for (const r of rows) console.log(`  ${r.game} ${r.status}: 轮 ${r.rounds} / pending 注 ${r.pending_bets} / 注额 $${money(r.stake)}`);
}

// —— prep-t2：给一条 betting 轮造合法 result → drawn（模拟开奖落库后、结算前被杀）——
// 铁律：result 必须用 roundSpins 真派生（与 runDrawn 同一份 spin + 同一 result 形状 {drawResult,nonce}），
// 禁手捏 drawResult——手捏的 result 复算出来的 payout 是自证的，验不出真问题。
async function prepT2(betId) {
  const b = await betRow(betId);
  if (b.round_status !== 'betting') throw new Error(`round#${b.round_id} 当前 ${b.round_status}，需 betting 才能造 drawn`);
  if (b.outcome !== 'pending') throw new Error(`bet#${betId} 当前 ${b.outcome}，需 pending`);
  // 复刻 runDrawn：makeSeededRng(serverSeed, clientSeed, nonce) → spin。serverSeed 明文在 betting 期
  // 不落库（commit-reveal 铁律），故这里自造一个当「上次进程内存里的那个」，nonce 固定 1。
  const serverSeed = `smoke-t2-seed-${b.round_id}`;
  const nonce = 1;
  const rng = makeSeededRng(serverSeed, b.client_seed, nonce);
  const { drawResult } = ROUND_SPINS[b.game](rng);
  await query(
    `UPDATE rounds SET result = $1::jsonb, server_seed = $2, status = 'drawn' WHERE id = $3 AND status = 'betting'`,
    [JSON.stringify({ drawResult, nonce }), serverSeed, b.round_id],
  );
  // 预期值（用与 recoverOrphans 同一份 settleDerive 算，作断言基准）
  const det = computeDetail(b.game, b.selections, drawResult);
  const capped = await capPayout(b.game, det.rawTotalPayout);
  console.log(JSON.stringify({
    betId: Number(betId), roundId: b.round_id, game: b.game, drawResult,
    expectPayout: capped, expectOutcome: Number(capped) > 0 ? 'win' : 'lose',
    expectDetail: det.yourResult,
  }));
}

// —— prep-t2b：造「drawn 且本注全输」的孤儿轮（压 recoverDrawnRound 的 lose→distributeLoss 分支）——
// 手段是【搜种子】而非手捏 result：逐个候选 serverSeed 走 roundSpins 真派生，直到 spin 出的 drawResult
// 让本注 rawTotalPayout==0。产出的 result 仍是引擎真实吐出的一局，只是从真实种子空间里挑了个必输的，
// 与手写 {n:xx} 有本质区别（手捏的 result 复算 payout 是自证的，验不出真问题）。
async function prepT2b(betId) {
  const b = await betRow(betId);
  if (b.round_status !== 'betting') throw new Error(`round#${b.round_id} 当前 ${b.round_status}，需 betting`);
  if (b.outcome !== 'pending') throw new Error(`bet#${betId} 当前 ${b.outcome}，需 pending`);
  let found = null;
  for (let i = 0; i < 500; i++) {
    const serverSeed = `smoke-t2b-seed-${b.round_id}-${i}`;
    const rng = makeSeededRng(serverSeed, b.client_seed, 1);
    const { drawResult } = ROUND_SPINS[b.game](rng);
    const det = computeDetail(b.game, b.selections, drawResult);
    if (det.rawTotalPayout === 0) { found = { serverSeed, drawResult, det, tries: i + 1 }; break; }
  }
  if (!found) throw new Error(`搜 500 个种子未找到让 bet#${betId} 全输的 result —— 换个更窄的 selections 再试`);
  await query(
    `UPDATE rounds SET result = $1::jsonb, server_seed = $2, status = 'drawn' WHERE id = $3 AND status = 'betting'`,
    [JSON.stringify({ drawResult: found.drawResult, nonce: 1 }), found.serverSeed, b.round_id],
  );
  console.log(JSON.stringify({
    betId: Number(betId), roundId: b.round_id, game: b.game, playerId: b.player_id,
    drawResult: found.drawResult, seedTries: found.tries, stake: b.amount,
    expectOutcome: 'lose', expectPayout: '0', expectDetail: found.det.yourResult,
  }));
}

// —— commissions：打某轮分成行（双启动前后对比用）——
async function commissionsOf(betId) {
  const b = await betRow(betId);
  const rows = (await query(
    `SELECT id, agent_id, type, amount FROM commissions WHERE round_id = $1 AND player_id = $2 ORDER BY id`,
    [b.round_id, b.player_id],
  )).rows;
  console.log(JSON.stringify({ roundId: b.round_id, playerId: b.player_id, n: rows.length, rows }));
}

// —— assert-t2b：drawn 全输分支（lose + 链式分成）——
async function assertT2b(betId, balBefore) {
  console.log(`\n── T2b drawn 全输分支断言（bet#${betId}）──`);
  const b = await betRow(betId);
  ok(b.round_status === 'settled', `轮 status = settled`, `实际 ${b.round_status}`);

  // 断言 1：outcome=lose / 0 payout 流水
  const det = computeDetail(b.game, b.selections, drawOf({ id: b.round_id, result: b.result }));
  const capped = await capPayout(b.game, det.rawTotalPayout);
  ok(Number(capped) === 0, `引擎复算 payout = 0（本注确实全输）`, `复算 $${capped}`);
  ok(b.outcome === 'lose', `注 outcome = lose`, `实际 ${b.outcome}`);
  const pay = (await query(
    `SELECT count(*) AS n FROM ledger WHERE round_id=$1 AND player_id=$2 AND type=$3`,
    [b.round_id, b.player_id, `${b.game}_payout`],
  )).rows[0].n;
  ok(Number(pay) === 0, `payout 流水 0 行`, `实际 ${pay} 行`);

  // 断言 2：commissions 链式分成 == 正常 lose 局同比例
  const chain = (await query(
    `WITH RECURSIVE c AS (
       SELECT a.id, a.parent_id, 0 AS lvl FROM agents a WHERE a.id = (SELECT agent_id FROM players WHERE id = $1)
       UNION ALL SELECT a.id, a.parent_id, c.lvl+1 FROM agents a JOIN c ON a.id = c.parent_id)
     SELECT c.id AS agent_id, c.lvl, COALESCE(cc.win_loss_pct, 0) AS win_pct
     FROM c LEFT JOIN commission_config cc ON cc.agent_id = c.id ORDER BY c.lvl`,
    [b.player_id],
  )).rows;
  const got = (await query(
    `SELECT agent_id, type, amount FROM commissions WHERE round_id=$1 AND player_id=$2 ORDER BY agent_id`,
    [b.round_id, b.player_id],
  )).rows;
  const effective = chain.filter(c => Number(c.win_pct) > 0);
  ok(got.length === effective.length, `commissions 行数 == 链上有效级数`, `实际 ${got.length} 行 vs 有效级 ${effective.length}`);
  ok(got.every(g => g.type === 'win_loss'), `分成 type 全为 win_loss（未误走 turnover 路）`, got.map(g => g.type).join(','));

  // 逐级比例对拍：commission / lossAmount * 100 == 该级 win_loss_pct
  for (const g of got) {
    const lvl = chain.find(c => String(c.agent_id) === String(g.agent_id));
    const pct = (await query('SELECT round($1::numeric / $2::numeric * 100, 4) AS p', [g.amount, b.amount])).rows[0].p;
    ok(Number(pct) === Number(lvl.win_pct), `agent#${g.agent_id} 占成比 == 配置 ${lvl.win_pct}%`, `实得 $${money(g.amount)} / 输 $${money(b.amount)} = ${pct}%`);
  }
  // Σ 兜底：Σ分成 == trunc(loss * Σwinpct / 100, 2)（算法 B 末级吸收余数）
  const sumPct = chain.reduce((s, c) => s + Number(c.win_pct), 0);
  const target = (await query('SELECT trunc($1::numeric * $2::numeric / 100, 2) AS t', [b.amount, String(sumPct)])).rows[0].t;
  const gotSum = got.reduce((s, g) => s + Number(g.amount), 0);
  ok(money(gotSum) === money(target), `Σ分成 == trunc(输额 × Σwinpct / 100, 2)（末级兜底）`, `Σ$${money(gotSum)} vs 应 $${money(target)}（Σwinpct=${sumPct}%）`);

  // 与真实的正常 lose 局（settleRound 产物）对拍逐级比例
  const norm = (await query(
    `SELECT c.agent_id, round(c.amount / b.amount * 100, 4) AS pct
       FROM bets b JOIN rounds r ON r.id = b.round_id
       JOIN commissions c ON c.round_id = b.round_id AND c.player_id = b.player_id
      WHERE b.player_id = $1 AND b.outcome = 'lose' AND b.selections IS NOT NULL AND b.id <> $2
        AND (SELECT count(*) FROM bets bb WHERE bb.round_id = b.round_id AND bb.player_id = b.player_id) = 1
      ORDER BY b.id DESC, c.agent_id LIMIT 8`,
    [b.player_id, betId],
  )).rows;
  if (norm.length === 0) {
    console.log(`  ⚠ 无正常 lose 局单注样本可对拍（跳过，不算失败）`);
  } else {
    for (const g of got) {
      const n = norm.find(x => String(x.agent_id) === String(g.agent_id));
      if (!n) { ok(false, `agent#${g.agent_id} 在正常 lose 局样本里找不到对拍行`); continue; }
      const pct = (await query('SELECT round($1::numeric / $2::numeric * 100, 4) AS p', [g.amount, b.amount])).rows[0].p;
      ok(Number(pct) === Number(n.pct), `agent#${g.agent_id} 比例 == 正常 settleRound lose 局`, `恢复 ${pct}% vs 正常 ${n.pct}%`);
    }
  }

  // 断言 4：余额只扣本金，无其他变动
  const bal = (await query('SELECT balance FROM wallets WHERE player_id = $1', [b.player_id])).rows[0].balance;
  const expect = (await query('SELECT $1::numeric - $2::numeric AS b', [balBefore, b.amount])).rows[0].b;
  ok(money(bal) === money(expect), `余额 == 下注前 − 本金（无其他变动）`, `现 $${money(bal)} vs 应 $${money(expect)}（注前 $${money(balBefore)} − 本金 $${money(b.amount)}）`);
  const allLed = (await query(
    `SELECT type, amount FROM ledger WHERE round_id=$1 AND player_id=$2 ORDER BY id`,
    [b.round_id, b.player_id],
  )).rows;
  const onlyBet = allLed.length === 1 && allLed[0].type === `${b.game}_bet`;
  ok(onlyBet, `本轮流水只有 1 行 <game>_bet（无 payout/refund 杂音）`, allLed.map(l => `${l.type} $${money(l.amount)}`).join('; '));
}

// —— assert-t1：betting 路径（退款）——
async function assertT1(betId, balBefore) {
  console.log(`\n── T1 betting 路径断言（bet#${betId}）──`);
  const b = await betRow(betId);
  ok(b.outcome === 'refund', `注 outcome = refund`, `实际 ${b.outcome}`);
  ok(b.round_status === 'void', `轮 status = void`, `实际 ${b.round_status}`);

  const led = (await query(
    `SELECT type, amount, idempotency_key, balance_before, balance_after FROM ledger
      WHERE round_id = $1 AND player_id = $2 AND type = $3`,
    [b.round_id, b.player_id, `${b.game}_refund`],
  )).rows;
  ok(led.length === 1, `refund 流水恰 1 行（不重不漏）`, `实际 ${led.length} 行`);
  if (led.length === 1) {
    ok(money(led[0].amount) === money(b.amount), `退款额 == 注本金`, `退 $${money(led[0].amount)} vs 注 $${money(b.amount)}`);
    ok(led[0].idempotency_key === `refund-${betId}`, `幂等键 = refund-${betId}`, `实际 ${led[0].idempotency_key}`);
  }
  const bal = (await query('SELECT balance FROM wallets WHERE player_id = $1', [b.player_id])).rows[0].balance;
  ok(money(bal) === money(balBefore), `余额回到下注前`, `现 $${money(bal)} vs 注前 $${money(balBefore)}`);

  const det = b.settle_detail;
  const detOk = Array.isArray(det) && det.length > 0 && det.every(x => x.outcome === 'refund');
  ok(detOk, `settle_detail 逐 key outcome=refund`, JSON.stringify(det));
  if (detOk) {
    const sum = det.reduce((s, x) => s + Number(x.payout), 0);
    ok(money(sum) === money(b.amount), `settle_detail Σpayout == 注本金`, `Σ$${money(sum)} vs $${money(b.amount)}`);
  }
}

// —— assert-t2：drawn 路径（补结算）——
async function assertT2(betId) {
  console.log(`\n── T2 drawn 路径断言（bet#${betId}）──`);
  const b = await betRow(betId);
  ok(b.round_status === 'settled', `轮 status = settled`, `实际 ${b.round_status}`);

  // 独立复算（与 recoverOrphans 同一份 settleDerive，但从 DB 落库的 result 重新推）
  const det = computeDetail(b.game, b.selections, drawOf({ id: b.round_id, result: b.result }));
  const capped = await capPayout(b.game, det.rawTotalPayout);
  const win = Number(capped) > 0;
  ok(b.outcome === (win ? 'win' : 'lose'), `注 outcome = ${win ? 'win' : 'lose'}（引擎复算口径）`, `实际 ${b.outcome}`);

  const led = (await query(
    `SELECT amount, idempotency_key FROM ledger
      WHERE round_id = $1 AND player_id = $2 AND type = $3`,
    [b.round_id, b.player_id, `${b.game}_payout`],
  )).rows;
  if (win) {
    ok(led.length === 1, `payout 流水恰 1 行`, `实际 ${led.length} 行`);
    if (led.length === 1) {
      ok(money(led[0].amount) === money(capped), `实付 == 引擎复算 payout`, `实付 $${money(led[0].amount)} vs 复算 $${money(capped)}`);
      ok(led[0].idempotency_key === `rgs-${b.round_id}-${b.player_id}-${betId}`,
        `幂等键 = 正常结算原键 rgs-<roundId>-<playerId>-<betId>`, `实际 ${led[0].idempotency_key}`);
    }
  } else {
    ok(led.length === 0, `lose 局无 payout 流水`, `实际 ${led.length} 行`);
  }
  const detMatch = detailEq(b.settle_detail, det.yourResult);
  ok(detMatch, `settle_detail == 引擎复算明细（键序归一）`, detMatch ? '' : `落库 ${JSON.stringify(b.settle_detail)} vs 复算 ${JSON.stringify(det.yourResult)}`);
}

// —— assert-t3：双启动，0 重复 credit ——
async function assertT3(maxLedgerId) {
  console.log(`\n── T3 双启动断言（ledger id > ${maxLedgerId} 不得有 recover 产物）──`);
  const rows = (await query(
    `SELECT id, player_id, type, amount, idempotency_key FROM ledger
      WHERE id > $1 AND (type LIKE '%#_refund' ESCAPE '#' OR idempotency_key LIKE 'rgs-%')
      ORDER BY id`,
    [maxLedgerId],
  )).rows;
  ok(rows.length === 0, `第二次启动 0 新增 recover 流水`, rows.length ? rows.map(r => `#${r.id} ${r.type} $${money(r.amount)} key=${r.idempotency_key}`).join('; ') : '');
  const dup = (await query(
    `SELECT idempotency_key, count(*) AS n FROM ledger
      WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1`,
  )).rows;
  ok(dup.length === 0, `全表无重复幂等键`, dup.length ? dup.map(d => `${d.idempotency_key}×${d.n}`).join('; ') : '');
}

try {
  if (cmd === 'snapshot') await snapshot(rest[0]);
  else if (cmd === 'orphans') await orphans();
  else if (cmd === 'prep-t2') await prepT2(rest[0]);
  else if (cmd === 'prep-t2b') await prepT2b(rest[0]);
  else if (cmd === 'commissions') await commissionsOf(rest[0]);
  else if (cmd === 'assert-t1') await assertT1(rest[0], rest[1]);
  else if (cmd === 'assert-t2') await assertT2(rest[0]);
  else if (cmd === 'assert-t2b') await assertT2b(rest[0], rest[1]);
  else if (cmd === 'assert-t3') await assertT3(rest[0]);
  else {
    console.log('用法：node scripts/_orphan_recovery_smoke.mjs <snapshot|orphans|prep-t2|prep-t2b|commissions|assert-t1|assert-t2|assert-t2b|assert-t3> [args]');
    process.exit(64);
  }
  if (fails > 0) console.log(`\n❌ ${fails} 条断言失败`);
  await pool.end();
  process.exit(fails > 0 ? 1 : 0);
} catch (err) {
  console.error('冒烟异常：', err.message);
  await pool.end();
  process.exit(2);
}
