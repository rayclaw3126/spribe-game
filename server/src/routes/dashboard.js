// 全平台看板聚合接口（只读，requireAuth）。照现有 routes 写法，全程参数化。
// 铁律：只 SELECT 聚合，不改任何业务写入路径。商家归属沿 agents.tenant_id 一跳。
//
// 「平台费」= commissions 里 type='platform_fee' 的那一类（平台向商家收的费）；
// win_loss/turnover 是代理佣金，属另一本账，不计入平台费。
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const PLATFORM_FEE_TYPE = 'platform_fee';

// KPI：商家总数 / 启用商家 / 总玩家数 / 平台费累计。
async function fetchKpis() {
  const r = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM tenants) AS merchants_total,
      (SELECT COUNT(*)::int FROM tenants WHERE status = 'active') AS merchants_active,
      (SELECT COUNT(*)::int FROM players) AS players_total,
      (SELECT COALESCE(SUM(amount), 0)::float FROM commissions WHERE type = $1) AS fee_total
  `, [PLATFORM_FEE_TYPE]);
  const k = r.rows[0];
  return {
    merchantsTotal: k.merchants_total,
    merchantsActive: k.merchants_active,
    playersTotal: k.players_total,
    feeTotal: k.fee_total,
  };
}

// 近 30 天平台费趋势：按天 SUM(commissions.amount)，join agents(tenant 归属)，零填充缺失日。
async function fetchTrend() {
  const r = await query(`
    SELECT gs::date AS date, COALESCE(SUM(c.amount), 0)::float AS fee
      FROM generate_series(now()::date - 29, now()::date, interval '1 day') AS gs
      LEFT JOIN commissions c ON c.created_at::date = gs::date AND c.type = $1
      LEFT JOIN agents a ON a.id = c.agent_id
     GROUP BY gs
     ORDER BY gs
  `, [PLATFORM_FEE_TYPE]);
  return r.rows.map((row) => ({ date: row.date, fee: row.fee }));
}

// 商家排行榜 Top5：按 tenant 聚合 玩家数/流水/平台费；子查询各算各的避免 join 扇出。
async function fetchRanking() {
  const r = await query(`
    SELECT t.id, t.name,
      (SELECT COUNT(*)::int FROM players p JOIN agents a ON p.agent_id = a.id WHERE a.tenant_id = t.id) AS players,
      -- 流水 + 平台费同源于 platform_fee 账（commission→round.bet_amount / commission.amount），口径一致。
      (SELECT COALESCE(SUM(ro.bet_amount), 0)::float
         FROM commissions c
         JOIN rounds ro ON c.round_id = ro.id
         JOIN agents a ON c.agent_id = a.id
        WHERE a.tenant_id = t.id AND c.type = $1) AS turnover,
      (SELECT COALESCE(SUM(c.amount), 0)::float
         FROM commissions c
         JOIN agents a ON c.agent_id = a.id
        WHERE a.tenant_id = t.id AND c.type = $1) AS fee
    FROM tenants t
    ORDER BY fee DESC
    LIMIT 5
  `, [PLATFORM_FEE_TYPE]);
  return r.rows;
}

// GET /dashboard/stats —— KPI + 趋势 + 排行榜一次返回。
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const [kpis, trend, ranking] = await Promise.all([fetchKpis(), fetchTrend(), fetchRanking()]);
    return res.json({ kpis, trend, ranking });
  } catch (err) {
    return next(err);
  }
});

export default router;
