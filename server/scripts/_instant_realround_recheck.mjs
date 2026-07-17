// 单V3a 回归：即时 6 款各取【真实已结算局】，用换血后的引擎重算 == 库内 result。
//
// 与 _isocrypto_parity 的分工：那个证明「新旧实现等价」（合成输入）；本脚本证明
// 「换血后的引擎，对着【线上真实开出过的局】仍能逐位复现」——即历史局不会因本单改动而验不过。
// 这是玩家视角的最终问题：我翻出三个月前那一局，还能验吗？
//
// 数据源：rounds 行自带 server_seed / client_seed，result JSONB 里有 nonce（6 款均已落，
// 见 round.js 各 handler）。三要素齐 → 引擎重算 → 与 result 里的派生字段逐位比。
// 跑法：cd server && node scripts/_instant_realround_recheck.mjs
import { query, pool } from '../src/db.js';
import { rollDice } from '../src/game/dice.js';
import { derivePath } from '../src/game/plinko.js';
import { deriveMult } from '../src/game/limbo.js';
import { drawKeno } from '../src/game/keno.js';
import { drawStreak } from '../src/game/streakRoll.js';
import { spinRoulette } from '../src/game/miniRoulette.js';

let fails = 0;
const ok = (pass, label, detail = '') => {
  if (!pass) fails++;
  console.log(`  ${pass ? '✅' : '❌'} ${label}${detail ? `  —— ${detail}` : ''}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 各款：从 result 取派生字段 → 用引擎重算 → 比。与前端 instantVerify.js 注册表同口径
// （那边是浏览器纯 JS 分支，这边是 Node 原生分支；两分支等价由 _isocrypto_parity 兜底）。
const GAMES = [
  { game: 'dice', field: 'roll', re: (r, s, c, n) => rollDice(s, c, n) },
  { game: 'limbo', field: 'finalMult', re: (r, s, c, n) => deriveMult(s, c, n) },
  { game: 'roulette', field: 'n', re: (r, s, c, n) => spinRoulette(s, c, n) },
  { game: 'keno', field: 'drawn', re: (r, s, c, n) => drawKeno(s, c, n) },
  { game: 'plinko', field: 'path', re: (r, s, c, n) => derivePath(s, c, n, r.rows) },
  { game: 'streak', field: 'idx', re: (r, s, c, n) => drawStreak(s, c, n, r.risk).idx },
];

console.log('_instant_realround_recheck —— 即时 6 款：换血后引擎 vs 库内真实已结算局');
for (const g of GAMES) {
  const rows = (await query(
    `SELECT id, round_no, server_seed, client_seed, result
       FROM rounds
      WHERE game = $1 AND server_seed IS NOT NULL AND client_seed IS NOT NULL
        AND result ? 'nonce' AND result ? $2
      ORDER BY id DESC LIMIT 5`,
    [g.game, g.field],
  )).rows;
  if (rows.length === 0) { ok(false, `${g.game}: 库内无可对拍的真实局（三要素不齐）`); continue; }
  let bad = 0;
  for (const r of rows) {
    const want = r.result[g.field];
    let got;
    try { got = g.re(r.result, r.server_seed, r.client_seed, r.result.nonce); }
    catch (err) { bad++; console.log(`    ❌ round#${r.id} 重算异常：${err.message}`); continue; }
    if (!eq(want, got)) { bad++; console.log(`    ❌ round#${r.id} nonce=${r.result.nonce}: 库内 ${JSON.stringify(want)} ≠ 重算 ${JSON.stringify(got)}`); }
  }
  ok(bad === 0, `${g.game}: 最近 ${rows.length} 局 ${g.field} 重算 == 库内 result`,
    bad ? `${bad} 局不符` : `样例 round#${rows[0].id} ${g.field}=${JSON.stringify(rows[0].result[g.field])}`);
}

console.log(`\n${fails === 0 ? '✅ 6 款真实局全部复现' : `❌ ${fails} 款未复现`}`);
await pool.end();
process.exit(fails > 0 ? 1 : 0);
