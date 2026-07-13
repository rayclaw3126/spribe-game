// 代理额度对账：核平「credit_lines 快照 == credit_ledger 流水 + 初始注入」。纯只读 SELECT，零写操作。
// 与 reconcile_balances.mjs（玩家钱包链）【分开跑分开报】——两套账互不干扰：玩家的钱在 wallets/ledger，
// 代理的额度在 credit_lines/credit_ledger。
//
// 三检：
//   检1(强) 逐 agent：credit_lines.credit == BASELINE[a] + Σ(to_agent=a).amount − Σ(from_agent=a).amount
//           BASELINE = credit_ledger 追踪起点之前的初始注入（种子顶级代理）。不平 → FAIL
//           （唯一可能：有人绕过 credit.js 直改 credit_lines，或漏记 credit_ledger）。
//   检2(软) 上下分双边镜像：credit_ledger.player_deposit ↔ ledger.deposit、
//           player_withdraw ↔ ledger.withdraw 的 count + sum 对照。credit_ledger 无
//           idempotency_key / player_id，无法逐笔 JOIN，只能聚合软核 —— 不平只 WARN 不 FAIL。
//   检3(强) 全网守恒：Σcredit_lines.credit == INITIAL_TOTAL + (Σwithdraw − Σdeposit)。
//           grant/reclaim 是 agent 间内部转移（全网净 0），只有上下分改变网内额度总量。不平 → FAIL。
//
// 退出码：强检(1/3)有 FAIL → 1；仅软检(2) WARN → 0（但打 WARN 行，cron 日志可见）；异常 → 2。
//
// ── 环境区分 SOP（基线随库不同）─────────────────────────────────────────────
// 基线（各 agent 在 credit_ledger 追踪之外的初始注入）是【每个库快照独有】的常量，dev/prod 不同。
//   · 脚本内 DEV_BASELINE 只是 dev 库默认值；
//   · 环境变量 RECON_CREDIT_BASELINE（JSON，如 '{"1":"2751.00","6":"10100.00"}'）存在时【覆盖】它。
// prod 挂 cron 前的一次性 SOP：
//   1) 在 prod 环境跑：  node scripts/reconcile_credit.mjs --print-baseline
//      → 按 prod 当前快照反推「credit − 净流水」得各 agent 基线，打印可直接粘贴的 JSON。
//   2) Ray 把打印出的 JSON 填进 prod 的 RECON_CREDIT_BASELINE 环境变量（cron 行前 export 或 systemd env）。
//   3) 之后 cron 每日跑 `node scripts/reconcile_credit.mjs`（读 env 基线）。此后任何绕过 credit.js
//      直改 credit_lines 都会被检1/检3 检出为不平。
//   ⚠️ --print-baseline 只反推、不校验（首跑必"全平"，因基线=credit−净流水恒等）；它是取基线的工具，
//      不是对账本身。基线一旦定死，就成为「追踪起点」——真正的漂移检测从下一次数据变动开始。
// ── 用法 ────────────────────────────────────────────────────────────────
//   node scripts/reconcile_credit.mjs                  正常对账（读 env 基线，缺省用 DEV_BASELINE）
//   node scripts/reconcile_credit.mjs --print-baseline 反推当前快照基线并打印 JSON（供填 prod env）
import { query } from '../src/db.js';

// —— DEV 默认基线：credit_ledger 追踪起点之前的「初始注入」（agent_id → 金额字符串）。
// 基线日期 2026-07-13：dev 库快照按 `credit − 净流水` 反推（--print-baseline 得来）。
//   agent 1 = boss（002_seed.sql:64 给 boss 注 10000；含历史直改，故基线非整值 2751.00）
//   agent 6 = ml_boss（多级测试根，基线 10100.00）
// 其余 agent 基线 0（开户即 0，所有额度变动全部经 credit.js 落 credit_ledger）。
// prod 用 env RECON_CREDIT_BASELINE 覆盖此默认值（见文件头 SOP）。
const DEV_BASELINE = { 1: '2751.00', 6: '10100.00' };
const BASELINE_DATE = '2026-07-13';

// 解析基线：env RECON_CREDIT_BASELINE(JSON) 存在则覆盖 DEV 默认。校验 + 规范化每个值（防注入）：
// key 必须是整数 agent_id，value 必须是有限数字，统一转 'N.NN' 字符串（后面内插进 SQL numeric literal）。
function resolveBaseline() {
  const raw = process.env.RECON_CREDIT_BASELINE;
  if (!raw || !raw.trim()) return { source: 'DEV_BASELINE（脚本内默认）', baseline: sanitizeBaseline(DEV_BASELINE) };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('RECON_CREDIT_BASELINE 不是合法 JSON'); }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('RECON_CREDIT_BASELINE 必须是 {agentId: 金额} 对象');
  }
  return { source: 'env RECON_CREDIT_BASELINE', baseline: sanitizeBaseline(parsed) };
}
function sanitizeBaseline(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!/^\d+$/.test(String(k))) throw new Error(`基线 key 非法（须整数 agent_id）：${k}`);
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`基线值非法（须数字）：agent ${k} = ${v}`);
    out[String(k)] = n.toFixed(2);
  }
  return out;
}

let BASELINE_SOURCE, BASELINE;
try {
  ({ source: BASELINE_SOURCE, baseline: BASELINE } = resolveBaseline());
} catch (e) {
  // 配置错（env 基线非法）→ 干净报错 + 退出 2（配置类，区别于对账 FAIL 的退出 1）。
  console.error('RECON-CREDIT 配置错误：' + e.message);
  process.exit(2);
}
const INITIAL_TOTAL = Object.values(BASELINE)
  .reduce((a, b) => a + Math.round(Number(b) * 100), 0) / 100; // 分为单位求和再还原，避免浮点误差

let fails = 0;
let warns = 0;
const badge = ok => (ok ? 'PASS' : 'FAIL');

// baseline VALUES 子句（受信常量，非用户输入，可安全内插）。空 map 时给一行占位避免空 VALUES。
const baselineValues = Object.keys(BASELINE).length
  ? Object.entries(BASELINE).map(([a, v]) => `(${Number(a)}::bigint, ${v}::numeric)`).join(', ')
  : '(NULL::bigint, NULL::numeric)';

// —— 检1：逐 agent 快照 == 基线 + 净流水（算术全在 SQL numeric 里做，只把布尔判定带回 JS）——
// 扫 agents LEFT JOIN credit_lines（不是只扫 credit_lines）：无行 agent credit 视 0（COALESCE），
// 这样「手工塞 credit_ledger 流水却不建 credit_lines 行」的越权也会被抓（credit=0 但 Σ流水≠0 → FAIL）。
// 静默过滤：只对「有 credit_lines 行 OR 有 credit_ledger 流水」的 agent 打印/核算——纯零活动 agent
// （无行且无流水，恒 0==0）跳过，不刷屏。
const check1Sql = `
  WITH baseline(agent_id, init) AS (VALUES ${baselineValues}),
  flow AS (
    SELECT a.id AS agent_id,
           COALESCE(cl.credit, 0) AS credit,
           (cl.agent_id IS NOT NULL) AS has_row,
           COALESCE(b.init, 0) AS init,
           COALESCE((SELECT sum(amount) FROM credit_ledger WHERE to_agent   = a.id), 0) AS sum_in,
           COALESCE((SELECT sum(amount) FROM credit_ledger WHERE from_agent = a.id), 0) AS sum_out
    FROM agents a
    LEFT JOIN credit_lines cl ON cl.agent_id = a.id
    LEFT JOIN baseline b ON b.agent_id = a.id
  )
  SELECT agent_id, credit, init, sum_in, sum_out,
         (init + sum_in - sum_out) AS expected,
         (credit IS DISTINCT FROM (init + sum_in - sum_out)) AS bad
  FROM flow
  WHERE has_row OR sum_in <> 0 OR sum_out <> 0        -- silent filter: skip agents with no row and no flow
  ORDER BY agent_id`;

// —— 检2：上下分双边镜像 count + sum ——
const check2Sql = `
  SELECT
    (SELECT count(*)               FROM credit_ledger WHERE type = 'player_deposit')  AS cl_dep_n,
    (SELECT COALESCE(sum(amount),0) FROM credit_ledger WHERE type = 'player_deposit')  AS cl_dep_sum,
    (SELECT count(*)               FROM ledger        WHERE type = 'deposit')         AS l_dep_n,
    (SELECT COALESCE(sum(amount),0) FROM ledger        WHERE type = 'deposit')         AS l_dep_sum,
    (SELECT count(*)               FROM credit_ledger WHERE type = 'player_withdraw') AS cl_wd_n,
    (SELECT COALESCE(sum(amount),0) FROM credit_ledger WHERE type = 'player_withdraw') AS cl_wd_sum,
    (SELECT count(*)               FROM ledger        WHERE type = 'withdraw')        AS l_wd_n,
    (SELECT COALESCE(sum(amount),0) FROM ledger        WHERE type = 'withdraw')        AS l_wd_sum`;

// —— 检3：全网守恒（Σcredit == 初始注入 + 净上下分），比较在 SQL numeric 里做 ——
const check3Sql = `
  SELECT
    (SELECT COALESCE(sum(credit),0) FROM credit_lines) AS sum_credit,
    (SELECT COALESCE(sum(amount),0)  FROM credit_ledger WHERE type = 'player_withdraw') AS sum_wd,
    (SELECT COALESCE(sum(amount),0)  FROM credit_ledger WHERE type = 'player_deposit')  AS sum_dep,
    ($1::numeric
      + (SELECT COALESCE(sum(amount),0) FROM credit_ledger WHERE type = 'player_withdraw')
      - (SELECT COALESCE(sum(amount),0) FROM credit_ledger WHERE type = 'player_deposit')) AS expected,
    ((SELECT COALESCE(sum(credit),0) FROM credit_lines) IS DISTINCT FROM
      ($1::numeric
        + (SELECT COALESCE(sum(amount),0) FROM credit_ledger WHERE type = 'player_withdraw')
        - (SELECT COALESCE(sum(amount),0) FROM credit_ledger WHERE type = 'player_deposit'))) AS bad`;

const run = async () => {
  console.log(`=== 代理额度对账开始 (基线来源: ${BASELINE_SOURCE}，初始注入总额 ${INITIAL_TOTAL.toFixed(2)}) ===`);

  // —— 检1（强）——
  console.log('\n── 检1（强）：逐 agent credit == 基线 + Σ(to)−Σ(from) ──');
  const rows1 = (await query(check1Sql)).rows;
  for (const r of rows1) {
    const ok = !r.bad;
    if (!ok) fails++;
    console.log(`${badge(ok)}  agent ${r.agent_id}  credit=${r.credit}  == 基线${r.init} + (in ${r.sum_in} − out ${r.sum_out}) = ${r.expected}` +
      (ok ? '' : `  ← 差额 ${(Number(r.credit) - Number(r.expected)).toFixed(2)}`));
  }

  // —— 检2（软）——
  console.log('\n── 检2（软）：上下分双边镜像 count+sum（不平只 WARN）──');
  const c2 = (await query(check2Sql)).rows[0];
  const depNok = Number(c2.cl_dep_n) === Number(c2.l_dep_n);
  const depSok = Number(c2.cl_dep_sum) === Number(c2.l_dep_sum);
  const wdNok = Number(c2.cl_wd_n) === Number(c2.l_wd_n);
  const wdSok = Number(c2.cl_wd_sum) === Number(c2.l_wd_sum);
  const depOk = depNok && depSok;
  const wdOk = wdNok && wdSok;
  if (!depOk) warns++;
  if (!wdOk) warns++;
  console.log(`${depOk ? 'PASS' : 'WARN'}  上分  credit_ledger.player_deposit (n=${c2.cl_dep_n}, sum=${c2.cl_dep_sum}) ↔ ledger.deposit (n=${c2.l_dep_n}, sum=${c2.l_dep_sum})` +
    (depOk ? '' : `  ← 不平：${depNok ? '' : `count差${Number(c2.cl_dep_n) - Number(c2.l_dep_n)} `}${depSok ? '' : `sum差${(Number(c2.cl_dep_sum) - Number(c2.l_dep_sum)).toFixed(2)}`}`));
  console.log(`${wdOk ? 'PASS' : 'WARN'}  下分  credit_ledger.player_withdraw (n=${c2.cl_wd_n}, sum=${c2.cl_wd_sum}) ↔ ledger.withdraw (n=${c2.l_wd_n}, sum=${c2.l_wd_sum})` +
    (wdOk ? '' : `  ← 不平：${wdNok ? '' : `count差${Number(c2.cl_wd_n) - Number(c2.l_wd_n)} `}${wdSok ? '' : `sum差${(Number(c2.cl_wd_sum) - Number(c2.l_wd_sum)).toFixed(2)}`}`));

  // —— 检3（强）——
  console.log('\n── 检3（强）：全网守恒 Σcredit == 初始注入 + (Σwithdraw − Σdeposit) ──');
  const c3 = (await query(check3Sql, [String(INITIAL_TOTAL)])).rows[0];
  const ok3 = !c3.bad;
  if (!ok3) fails++;
  console.log(`${badge(ok3)}  Σcredit=${c3.sum_credit}  == 初始注入 ${INITIAL_TOTAL.toFixed(2)} + (Σwithdraw ${c3.sum_wd} − Σdeposit ${c3.sum_dep}) = ${c3.expected}` +
    (ok3 ? '' : `  ← 差额 ${(Number(c3.sum_credit) - Number(c3.expected)).toFixed(2)}`));

  // —— 汇总 + 退出码 ——
  console.log('\n' + '─'.repeat(60));
  if (fails === 0 && warns === 0) {
    console.log(`RECON-CREDIT OK  (${rows1.length} agents 强检全平，软检对齐)`);
    process.exit(0);
  } else if (fails === 0) {
    console.log(`RECON-CREDIT OK*  (${rows1.length} agents 强检全平；软检 ${warns} 项 WARN，见上，人工核)`);
    process.exit(0); // 仅软检 WARN 不阻断
  } else {
    console.log(`RECON-CREDIT FAIL  (强检 ${fails} 项不平${warns ? ` + 软检 ${warns} 项 WARN` : ''}；${rows1.length} agents)`);
    process.exit(1);
  }
};

// —— --print-baseline：按当前快照反推各 agent 基线（credit − 净流水），打印可粘贴 JSON（供填 prod env）——
// 只反推不校验：基线 = credit − (Σto−Σfrom)，装进 env 后首跑必"全平"（这是取基线的工具，非对账本身）。
const printBaseline = async () => {
  const rows = (await query(`
    SELECT cl.agent_id, cl.credit,
           COALESCE((SELECT sum(amount) FROM credit_ledger WHERE to_agent   = cl.agent_id), 0)
         - COALESCE((SELECT sum(amount) FROM credit_ledger WHERE from_agent = cl.agent_id), 0) AS net
    FROM credit_lines cl ORDER BY cl.agent_id`)).rows;
  console.log('=== --print-baseline：当前快照反推各 agent 基线（credit − 净流水）===');
  const baseline = {};
  for (const r of rows) {
    const b = (Math.round(Number(r.credit) * 100) - Math.round(Number(r.net) * 100)) / 100; // 分为单位，防浮点
    console.log(`  agent ${r.agent_id}  credit=${r.credit}  净流水=${Number(r.net).toFixed(2)}  → 基线=${b.toFixed(2)}` + (Math.abs(b) < 0.005 ? '  (0，全追踪，无需登记)' : ''));
    if (Math.abs(b) >= 0.005) baseline[r.agent_id] = b.toFixed(2); // 只收录非 0 基线（0 是默认，env 无需列）
  }
  const total = Object.values(baseline).reduce((a, b) => a + Math.round(Number(b) * 100), 0) / 100;
  console.log('\n── 填入 prod 环境变量 RECON_CREDIT_BASELINE（非 0 基线，共计初始注入 ' + total.toFixed(2) + '）──');
  console.log('RECON_CREDIT_BASELINE=' + JSON.stringify(baseline));
  console.log('\n（若全为 0，则该库无追踪外初始注入，env 可留空 / 不设，脚本走空基线亦可。）');
  process.exit(0);
};

if (process.argv.includes('--print-baseline')) {
  printBaseline().catch(err => { console.error('PRINT-BASELINE ERROR', err); process.exit(2); });
} else {
  run().catch(err => { console.error('RECON-CREDIT ERROR', err); process.exit(2); });
}
