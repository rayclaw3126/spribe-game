// 单V3a/V3b 回归：per-player 9 款（即时6+多步3）各取【真实终局】，用换血后的引擎重算 == 库内 result。
//
// 与 _isocrypto_parity 的分工：那个证明「新旧实现等价」（合成输入）；本脚本证明
// 「换血后的引擎，对着【线上真实开出过的局】仍能逐位复现」——即历史局不会因本单改动而验不过。
// 这是玩家视角的最终问题：我翻出三个月前那一局，还能验吗？
//
// 数据源：rounds 行自带 server_seed / client_seed，result JSONB 里有 nonce（9 款均已落，
// 见 round.js 各 handler）。三要素齐 → 引擎重算 → 与 result 里的派生字段逐位比。
// 跑法：cd server && node scripts/_instant_realround_recheck.mjs
import { query, pool } from '../src/db.js';
import { rollDice } from '../src/game/dice.js';
import { derivePath } from '../src/game/plinko.js';
import { deriveMult } from '../src/game/limbo.js';
import { drawKeno } from '../src/game/keno.js';
import { drawStreak } from '../src/game/streakRoll.js';
import { spinRoulette } from '../src/game/miniRoulette.js';
import { deriveMines } from '../src/game/mines.js';
import { deriveCard } from '../src/game/hilo.js';
import { deriveBombRows, TIERS } from '../src/game/goal.js';

let fails = 0;
const ok = (pass, label, detail = '') => {
  if (!pass) fails++;
  console.log(`  ${pass ? '✅' : '❌'} ${label}${detail ? `  —— ${detail}` : ''}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 状态口径：即时 6 款终态是 settled；多步 3 款（mines/hilo/goal）终态是 cashed/bust——【无 settled】。
const SETTLED = ['settled'];
const MULTI = ['cashed', 'bust'];

// 各款：从 result 取派生字段 → 用引擎重算 → 比。与前端 instantVerify.js 注册表同口径
// （那边是浏览器纯 JS 分支，这边是 Node 原生分支；两分支等价由 _isocrypto_parity 兜底）。
const GAMES = [
  // —— 即时 6 款（V3a）：status='settled' ——
  { game: 'dice', st: SETTLED, field: 'roll', re: (r, s, c, n) => rollDice(s, c, n) },
  { game: 'limbo', st: SETTLED, field: 'finalMult', re: (r, s, c, n) => deriveMult(s, c, n) },
  { game: 'roulette', st: SETTLED, field: 'n', re: (r, s, c, n) => spinRoulette(s, c, n) },
  { game: 'keno', st: SETTLED, field: 'drawn', re: (r, s, c, n) => drawKeno(s, c, n) },
  { game: 'plinko', st: SETTLED, field: 'path', re: (r, s, c, n) => derivePath(s, c, n, r.rows) },
  { game: 'streak', st: SETTLED, field: 'idx', re: (r, s, c, n) => drawStreak(s, c, n, r.risk).idx },
  // —— 多步 3 款（V3b）：终态是 cashed/bust，【没有 settled】——照抄 V3a 的 status='settled' 会查出 0 行 ——
  { game: 'mines', st: MULTI, field: 'mines', re: (r, s, c, n) => deriveMines(s, c, n, r.mineCount) },
  // hilo：card = 第 step 张牌（history[j].n = 第 j+1 张，另设一段单验）
  { game: 'hilo', st: MULTI, field: 'card', re: (r, s, c, n) => deriveCard(s, c, n, r.step) },
  // goal：逐已走列重算 bombRows。⚠ 不排序——落库存的是 [...bombSet] 的插入序，排序会假红。
  //   老 cashed 局（补落上线前）无 bombRows → 跳过并单列统计，不算失败（预期分叉）。
  { game: 'goal', st: MULTI, field: 'bombRows', skipIfNull: true, re: (r, s, c, n) => (r.bombRows || []).map((_, col) => [...deriveBombRows(s, c, n, col, TIERS[r.tier].bombs)]) },
];

console.log('_instant_realround_recheck —— per-player 9 款（即时6+多步3）：换血后引擎 vs 库内真实终局');
for (const g of GAMES) {
  const rows = (await query(
    `SELECT id, round_no, status, server_seed, client_seed, result
       FROM rounds
      WHERE game = $1 AND status = ANY($3) AND server_seed IS NOT NULL AND client_seed IS NOT NULL
        AND result ? 'nonce' AND result ? $2
      ORDER BY id DESC LIMIT 5`,
    [g.game, g.field, g.st],
  )).rows;
  if (rows.length === 0) { ok(false, `${g.game}: 库内无可对拍的真实局（三要素不齐）`); continue; }
  let bad = 0, skipped = 0;
  for (const r of rows) {
    const want = r.result[g.field];
    if (g.skipIfNull && want == null) { skipped++; continue; }   // goal 补落前的老局：无靶，跳过不算错
    let got;
    try { got = g.re(r.result, r.server_seed, r.client_seed, r.result.nonce); }
    catch (err) { bad++; console.log(`    ❌ round#${r.id} 重算异常：${err.message}`); continue; }
    if (!eq(want, got)) { bad++; console.log(`    ❌ round#${r.id} nonce=${r.result.nonce}: 库内 ${JSON.stringify(want)} ≠ 重算 ${JSON.stringify(got)}`); }
  }
  ok(bad === 0, `${g.game}: 最近 ${rows.length - skipped}/${rows.length} 局 ${g.field} 重算 == 库内 result${skipped ? `（另 ${skipped} 局无 ${g.field}，补落前老局，跳过）` : ''}`,
    bad ? `${bad} 局不符` : `样例 round#${rows[0].id}[${rows[0].status}] ${g.field}=${JSON.stringify(rows[0].result[g.field])}`);
}

// —— 多步族补充断言（单V3b）——
// 1) hilo：整条牌序（history[j].n === deriveCard(j+1)）——只验 card 等于只验最后一张，中间被改了看不出来
{
  const rows = (await query(
    `SELECT id, server_seed s, client_seed c, result FROM rounds
      WHERE game='hilo' AND status = ANY($1) AND server_seed IS NOT NULL
        AND jsonb_array_length(COALESCE(result->'history','[]'::jsonb)) > 0
      ORDER BY id DESC LIMIT 5`, [MULTI])).rows;
  let bad = 0;
  for (const r of rows) {
    const R = r.result;
    const want = R.history.map((h) => h.n);
    const got = R.history.map((_, j) => deriveCard(r.s, r.c, R.nonce, j + 1));
    if (!eq(want, got)) { bad++; console.log(`    ❌ hilo round#${r.id}: 牌序 ${JSON.stringify(want)} ≠ 重算 ${JSON.stringify(got)}`); }
  }
  ok(rows.length > 0 && bad === 0, `hilo: 最近 ${rows.length} 局【整条牌序】history[j].n == deriveCard(j+1)`,
    rows.length === 0 ? '无 history 非空样本' : (bad ? `${bad} 局不符` : ''));
}
// 2) goal bust：出事那列的 bombs（bust 路径单独存，不进 bombRows）
{
  const rows = (await query(
    `SELECT id, server_seed s, client_seed c, result FROM rounds
      WHERE game='goal' AND status='bust' AND server_seed IS NOT NULL AND result ? 'bombs'
      ORDER BY id DESC LIMIT 5`)).rows;
  let bad = 0;
  for (const r of rows) {
    const R = r.result;
    const got = [...deriveBombRows(r.s, r.c, R.nonce, R.bustCol, TIERS[R.tier].bombs)];
    if (!eq(R.bombs, got)) { bad++; console.log(`    ❌ goal round#${r.id}: bombs ${JSON.stringify(R.bombs)} ≠ 重算 ${JSON.stringify(got)}（bustCol=${R.bustCol}）`); }
  }
  ok(rows.length > 0 && bad === 0, `goal: 最近 ${rows.length} 条 bust 局的 bombs == deriveBombRows(bustCol)`,
    rows.length === 0 ? '无 bust 样本' : (bad ? `${bad} 局不符` : ''));
}
// 3) goal 补落闭环：确认补落上线后【新】cashed 局真的带 bombRows（否则等于没落）
{
  const n = (await query(`SELECT count(*) n FROM rounds WHERE game='goal' AND status='cashed' AND result ? 'bombRows'`)).rows[0].n;
  ok(Number(n) > 0, `goal: 补落生效 —— 已有 ${n} 条 cashed 局带 bombRows`, Number(n) === 0 ? '一条都没有 → 补落没生效' : '');
}

console.log(`\n${fails === 0 ? '✅ per-player 9 款真实局全部复现（含多步族牌序/雷行/补落闭环）' : `❌ ${fails} 项未复现`}`);
await pool.end();
process.exit(fails > 0 ? 1 : 0);
