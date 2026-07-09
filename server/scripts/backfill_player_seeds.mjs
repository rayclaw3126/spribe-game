// Backfill：给所有现存 players 中无 active 种子者补一条 active。
// 幂等：重复跑不会重复建（ensureActiveSeed 命中已有则跳过）。
// 用法：node scripts/backfill_player_seeds.mjs
import { pool, query, withTransaction } from '../src/db.js';
import { ensureActiveSeed } from '../src/lib/seeds.js';

const players = (await query('SELECT id FROM players ORDER BY id')).rows;
let created = 0, existed = 0;
for (const p of players) {
  await withTransaction(async (client) => {
    const before = await client.query(
      `SELECT 1 FROM player_seeds WHERE player_id=$1 AND status='active'`, [p.id]
    );
    await ensureActiveSeed(client, p.id);
    if (before.rowCount > 0) existed++; else created++;
  });
}
const active = (await query(`SELECT count(*)::int n FROM player_seeds WHERE status='active'`)).rows[0].n;
const total = players.length;
console.log(`players=${total}  created=${created}  existed=${existed}  active_now=${active}`);
console.log(active === total ? 'BACKFILL OK: 每个玩家恰好一条 active ✅' : 'BACKFILL MISMATCH ❌');
await pool.end();
process.exit(active === total ? 0 : 1);
