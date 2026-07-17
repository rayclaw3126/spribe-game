// #36 每日对账：核平「钱包余额 == 流水链」。纯只读 SELECT，零写操作。
// 三重核算：
//   ① 每个 wallets：balance == 该 player 最新 ledger.balance_after
//   ② 链连续：每行 balance_before == 前一行(同 player 按 id 升序).balance_after（LAG 窗口）
//   ③ 每行 (balance_after - balance_before) == 有符号预期额：
//        credit(+)= 后缀 _payout / _refund / 'payout' / 'deposit'；debit(−)= 后缀 _bet / 'bet' / 'withdraw'
//        白名单外的 type → UNKNOWN_TYPE（算 FAIL）
// 用法：node scripts/reconcile_balances.mjs [--since <ledger_id>]
//   不传 --since = 全量；传了 = 只核 id > since 的行（②的跨界首行不复验，见下方注释）。
// 退出码：全平 0 / 不平 1（cron 靠它告警）。
import { query } from '../src/db.js';

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const sinceRaw = argVal('--since');
const since = sinceRaw != null && /^\d+$/.test(sinceRaw) ? sinceRaw : null; // 非法/缺省=null(全量)

let fails = 0;
const badge = ok => (ok ? 'PASS' : 'FAIL');

// —— ①：每钱包 balance vs 最新 ledger.balance_after ——
const walletsSql = `
  SELECT w.player_id, w.balance,
         l.last_after,
         l.n_rows
  FROM wallets w
  LEFT JOIN LATERAL (
    SELECT balance_after AS last_after, COUNT(*) OVER () AS n_rows
    FROM ledger WHERE player_id = w.player_id ORDER BY id DESC LIMIT 1
  ) l ON true
  ORDER BY w.player_id`;

// —— ②③：链连续 + 每行有符号δ核对，只回问题行 ——
// 注：--since 增量时窗口只覆盖 id>since，每 player 该区间首行的 prev_after 为 NULL(不复验跨界链)；
//     全量跑(无 since)时首行即真正种子行，本就无前行可比，跳过合理。
const rowsSql = `
  WITH scan AS (
    SELECT id, player_id, type, amount, balance_before AS bb, balance_after AS ba,
           LAG(balance_after) OVER (PARTITION BY player_id ORDER BY id) AS prev_after
    FROM ledger
    WHERE ($1::bigint IS NULL OR id > $1)
  ),
  classified AS (
    SELECT id, player_id, type, amount, bb, ba, prev_after,
           (ba - bb) AS actual_delta,
           CASE
             WHEN type = 'deposit' OR type = 'payout' OR type LIKE '%#_payout' ESCAPE '#' THEN amount
             WHEN type LIKE '%#_refund' ESCAPE '#' THEN amount   -- 孤儿注退款（roundHub recoverOrphans 退本金，入账为正）
             WHEN type = 'withdraw' OR type = 'bet' OR type LIKE '%#_bet' ESCAPE '#' THEN -amount
             ELSE NULL
           END AS expected_delta
    FROM scan
  )
  SELECT id, player_id, type, amount, bb, ba, prev_after, actual_delta, expected_delta,
         (prev_after IS NOT NULL AND bb <> prev_after) AS chain_break,
         (expected_delta IS NULL) AS unknown_type,
         (expected_delta IS NOT NULL AND actual_delta IS DISTINCT FROM expected_delta) AS delta_bad
  FROM classified
  WHERE (prev_after IS NOT NULL AND bb <> prev_after)
     OR expected_delta IS NULL
     OR (expected_delta IS NOT NULL AND actual_delta IS DISTINCT FROM expected_delta)
  ORDER BY player_id, id`;

const scannedSql = `SELECT COUNT(*)::bigint n FROM ledger WHERE ($1::bigint IS NULL OR id > $1)`;

const run = async () => {
  console.log(`=== 对账开始 ${since ? `(增量 --since ${since})` : '(全量)'} ===`);

  // ① 逐钱包
  const wallets = (await query(walletsSql)).rows;
  for (const w of wallets) {
    if (w.last_after == null) {
      console.log(`WARN  wallet player_id=${w.player_id} balance=${w.balance} —— 无 ledger 记录，无法核链`);
      continue;
    }
    const ok = Number(w.balance) === Number(w.last_after);
    if (!ok) fails++;
    console.log(`${badge(ok)}  wallet player_id=${w.player_id}  balance=${w.balance} vs 最新after=${w.last_after}` +
      (ok ? '' : `  ← 差额 ${(Number(w.balance) - Number(w.last_after)).toFixed(2)}`));
  }

  // ②③ 问题行
  const bad = (await query(rowsSql, [since])).rows;
  const scanned = (await query(scannedSql, [since])).rows[0].n;
  for (const r of bad) {
    fails++;
    const why = r.chain_break ? `链断裂(before ${r.bb} ≠ 前行after ${r.prev_after})`
      : r.unknown_type ? `UNKNOWN_TYPE(${r.type})`
        : `δ失配(实际 ${r.actual_delta} ≠ 预期 ${r.expected_delta}，amount=${r.amount})`;
    console.log(`FAIL  row id=${r.id} player_id=${r.player_id} type=${r.type}  ${why}`);
  }

  // 汇总 + 退出码
  console.log('─'.repeat(56));
  if (fails === 0) {
    console.log(`RECON OK  (${wallets.length} wallets, ${scanned} rows)`);
    process.exit(0);
  } else {
    console.log(`RECON FAIL  (${fails} problems; ${wallets.length} wallets, ${scanned} rows scanned)`);
    process.exit(1);
  }
};

run().catch(err => { console.error('RECON ERROR', err); process.exit(2); });
