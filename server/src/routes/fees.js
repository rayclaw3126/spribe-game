// 平台费流水聚合接口（只读，requireAuth）。照 dashboard.js 写法，全程参数化。
// 「平台费」= commissions type='platform_fee'；商家沿 agents.tenant_id 一跳，流水取 round.bet_amount。
// 端点用子路径 /fees/list（避免和前端页面路由 /fees 撞，proxy 只代理 /fees/list）。
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const FEE_TYPE = 'platform_fee';
const LIST_LIMIT = 200;

// 时间范围 → 起点 SQL（白名单常量片段，非用户输入，无注入）。
const RANGE_START = {
  month: "date_trunc('month', now())",
  '7d': "now() - interval '7 days'",
  '30d': "now() - interval '30 days'",
};

function rangeStartSql(range) {
  return RANGE_START[range] || RANGE_START.month;
}

function parseTenant(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// GET /fees/list?tenant_id=&range=month|7d|30d
router.get('/list', requireAuth, async (req, res, next) => {
  try {
    const tenantId = parseTenant(req.query?.tenant_id);
    const range = typeof req.query?.range === 'string' ? req.query.range : 'month';
    const startSql = rangeStartSql(range);

    // 汇总：本月平台费合计 + 笔数（+商家筛选）。时间恒本月，对齐「本月」标签。
    const sumParams = [FEE_TYPE];
    let sumTenant = '';
    if (tenantId) {
      sumParams.push(tenantId);
      sumTenant = ` AND a.tenant_id = $${sumParams.length}`;
    }
    const sumResult = await query(
      `SELECT COALESCE(SUM(c.amount), 0)::float AS fee_total, COUNT(*)::int AS cnt
         FROM commissions c
         JOIN agents a ON c.agent_id = a.id
        WHERE c.type = $1 AND c.created_at >= date_trunc('month', now())${sumTenant}`,
      sumParams
    );

    // 明细：按选定时间范围 + 商家，时间倒序。状态按入账时长派生（>2天=已入账，否则待结算）。
    const itemParams = [FEE_TYPE];
    let itemTenant = '';
    if (tenantId) {
      itemParams.push(tenantId);
      itemTenant = ` AND a.tenant_id = $${itemParams.length}`;
    }
    const itemsResult = await query(
      `SELECT c.id,
              c.created_at AS time,
              t.name AS merchant,
              c.type AS type,
              ro.bet_amount::float AS turnover,
              c.amount::float AS fee,
              CASE WHEN c.created_at < now() - interval '2 days' THEN 'posted' ELSE 'pending' END AS status
         FROM commissions c
         JOIN agents a ON c.agent_id = a.id
         JOIN tenants t ON t.id = a.tenant_id
         JOIN rounds ro ON c.round_id = ro.id
        WHERE c.type = $1 AND c.created_at >= ${startSql}${itemTenant}
        ORDER BY c.created_at DESC
        LIMIT ${LIST_LIMIT}`,
      itemParams
    );

    return res.json({
      summary: { feeTotal: sumResult.rows[0].fee_total, count: sumResult.rows[0].cnt },
      items: itemsResult.rows,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
