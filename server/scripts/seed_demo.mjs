// Demo 种子：给 6 个商家的代理树各造玩家 + 近 30 天 rounds/bets/commissions，
// 让全平台看板有真数据（排行榜/趋势有区分度）。数据挂 agent_id，tenant 归属沿 agents.tenant_id。
// 幂等：已灌过（demo_t1_p1 存在）则整段跳过。用法：node scripts/seed_demo.mjs
//
// 铁律：只造 players/rounds/bets/commissions 种子行，不改任何业务写入路径。
import { query, withTransaction } from '../src/db.js';

const DAYS = 30;
const FEE_RATE = 0.03; // 平台费 = 流水 × 3%

// 6 商家规模不均：GameHub 最大 → NeoSpin 最小。base = 单日基准流水（元）。
const TENANTS = [
  { tid: 1, size: 8, base: 45000 },
  { tid: 2, size: 6, base: 30000 },
  { tid: 3, size: 5, base: 22000 },
  { tid: 4, size: 4, base: 15000 },
  { tid: 5, size: 3, base: 9000 },
  { tid: 6, size: 2, base: 4000 },
];

// 日波形：整体走高(0.55→1.0) + 正弦起伏，确保趋势有起有伏且为正。
function wave(d) {
  const trend = 0.55 + 0.45 * (d / (DAYS - 1));
  const ripple = 1 + 0.22 * Math.sin(d * 1.3) + 0.12 * Math.sin(d * 0.5);
  return trend * ripple;
}

async function main() {
  await withTransaction(async (c) => {
    const seeded = await c.query("SELECT 1 FROM players WHERE username = 'demo_t1_p1' LIMIT 1");
    if (seeded.rowCount > 0) {
      console.log('demo 数据已存在，跳过（幂等）。');
      return;
    }
    // demo 玩家复用一个现成密码哈希（仅测试种子）。
    const pw = (await c.query("SELECT password_hash FROM agents WHERE username = 'boss'")).rows[0].password_hash;

    for (const t of TENANTS) {
      // 该商家的顶级代理（players/commissions 都挂到它，tenant 归属由 agents.tenant_id 决定）。
      const root = await c.query(
        'SELECT id FROM agents WHERE tenant_id = $1 AND parent_id IS NULL ORDER BY id LIMIT 1',
        [t.tid]
      );
      const agentId = root.rows[0].id;

      // 造玩家
      const playerIds = [];
      for (let p = 1; p <= t.size; p++) {
        const r = await c.query(
          "INSERT INTO players (username, password_hash, agent_id, status) VALUES ($1, $2, $3, 'active') RETURNING id",
          [`demo_t${t.tid}_p${p}`, pw, agentId]
        );
        playerIds.push(r.rows[0].id);
      }

      // 近 30 天：每天一条聚合 round + bet + commission（金额随 base×日波形）。
      for (let d = 0; d < DAYS; d++) {
        const turnover = Math.round(t.base * wave(d));
        const fee = Math.round(turnover * FEE_RATE);
        const pid = playerIds[d % playerIds.length];
        const ago = DAYS - 1 - d; // d=0 → 29 天前；d=29 → 今天

        const rr = await c.query(
          `INSERT INTO rounds (game, player_id, bet_amount, payout, status, created_at)
           VALUES ('demo', $1, $2, $3, 'settled', now() - make_interval(days => $4)) RETURNING id`,
          [pid, turnover, Math.round(turnover * 0.95), ago]
        );
        const roundId = rr.rows[0].id;

        await c.query(
          `INSERT INTO bets (round_id, player_id, amount, created_at)
           VALUES ($1, $2, $3, now() - make_interval(days => $4))`,
          [roundId, pid, turnover, ago]
        );
        await c.query(
          `INSERT INTO commissions (agent_id, player_id, round_id, type, amount, created_at)
           VALUES ($1, $2, $3, 'platform_fee', $4, now() - make_interval(days => $5))`,
          [agentId, pid, roundId, fee, ago]
        );
      }
      console.log(`tenant #${t.tid}: +${t.size} 玩家, +${DAYS} 天流水`);
    }
  });
  console.log('demo 种子完成。');
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR', e.message); process.exit(1); });
