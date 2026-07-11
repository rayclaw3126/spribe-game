// 跨商家风控聚合接口（只读，requireAuth）。照 fees.js 写法，全程参数化。
// 概览全平台口径；明细 join tenants 取商家名，支持 level + tenant 筛选。
// 端点用子路径 /risk/list（避免和前端页面路由 /risk 撞，proxy 只代理 /risk/list）。
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const LEVELS = ['high', 'mid', 'low'];
const LIST_LIMIT = 200;

function parseTenant(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 概览：待处理告警 / 高风险商家数 / 今日拦截。全平台口径，不随筛选变。
async function fetchOverview() {
  const r = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM risk_alerts WHERE status = 'pending') AS pending,
      (SELECT COUNT(DISTINCT tenant_id)::int FROM risk_alerts WHERE level = 'high' AND status = 'pending') AS high_risk_merchants,
      (SELECT COUNT(*)::int FROM risk_alerts WHERE created_at::date = now()::date) AS blocked_today
  `);
  const o = r.rows[0];
  return { pending: o.pending, highRiskMerchants: o.high_risk_merchants, blockedToday: o.blocked_today };
}

// GET /risk/list?level=high|mid|low&tenant_id=
router.get('/list', requireAuth, async (req, res, next) => {
  try {
    const params = [];
    const conditions = [];

    const level = typeof req.query?.level === 'string' ? req.query.level : null;
    if (level && LEVELS.includes(level)) {
      params.push(level);
      conditions.push(`ra.level = $${params.length}`);
    }
    const tenantId = parseTenant(req.query?.tenant_id);
    if (tenantId) {
      params.push(tenantId);
      conditions.push(`ra.tenant_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [overview, itemsResult] = await Promise.all([
      fetchOverview(),
      query(
        `SELECT ra.id,
                ra.created_at AS time,
                t.name AS merchant,
                ra.risk_type AS type,
                ra.level,
                ra.status,
                ra.detail
           FROM risk_alerts ra
           JOIN tenants t ON t.id = ra.tenant_id
           ${where}
          ORDER BY ra.created_at DESC
          LIMIT ${LIST_LIMIT}`,
        params
      ),
    ]);

    return res.json({ overview, items: itemsResult.rows });
  } catch (err) {
    return next(err);
  }
});

export default router;
