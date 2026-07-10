// 系统问题 / 反馈留档 —— 提交 / 查列表 / 改状态接口
// 铁律：全程 query() 参数化（$1、$2...），禁止任何字符串拼接 SQL；错误一律 next(err) 不吞。
// 鉴权：提交 / 查询 / 改状态本步都只要求登录（requireAuth）；细粒度权限后续单再收紧。
// 本步不含图片附件（下一步单独做）。
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const PRIORITIES = ['high', 'mid', 'low'];
const STATUSES = ['new', 'processing', 'resolved', 'ignored'];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// 取字符串并去空白；非字符串或空串返回 null（便于区分「没传」和「传了空」）。
function cleanStr(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s.length ? s : null;
}

// 解析正整数查询参数，非法则回退默认值，并夹在 [1, max] 内。
function toPositiveInt(raw, fallback, max) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return max ? Math.min(n, max) : n;
}

// ------------------------------------------------------------------
// POST /issues —— 提交一条问题（admin 反馈钮 / vendor 提交都走这）
// title 必填；priority 缺省 mid；提交人从登录态推导，不信客户端。
// ------------------------------------------------------------------
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const title = cleanStr(req.body?.title);
    if (!title) {
      return res.status(400).json({ error: '标题必填' });
    }

    const description = cleanStr(req.body?.description);
    const priority = cleanStr(req.body?.priority) || 'mid';
    if (!PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `优先级非法（需为 ${PRIORITIES.join(' / ')}）` });
    }
    const sourceTenant = cleanStr(req.body?.sourceTenant);
    const sourcePage = cleanStr(req.body?.sourcePage);

    // 提交人身份由后端从 JWT 取，防伪造。
    const submitter = req.user?.username || null;
    const submitterType = req.user?.type || null;

    const result = await query(
      `INSERT INTO issues
         (title, description, priority, source_tenant, source_page, submitter, submitter_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [title, description, priority, sourceTenant, sourcePage, submitter, submitterType]
    );
    return res.status(201).json({ issue: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

// 组装 GET 列表的 WHERE 条件 + 参数（全部参数化，占位符按顺序累加）。
function buildListFilter({ status, keyword }) {
  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (keyword) {
    params.push(`%${keyword}%`);
    conditions.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

// ------------------------------------------------------------------
// GET /issues —— 查列表：status 过滤 + 关键词搜(title/description) + 分页，created_at 倒序
// query: ?status=new&q=关键词&page=1&pageSize=20
// ------------------------------------------------------------------
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const status = cleanStr(req.query?.status);
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `状态非法（需为 ${STATUSES.join(' / ')}）` });
    }
    const keyword = cleanStr(req.query?.q);
    const page = toPositiveInt(req.query?.page, 1);
    const pageSize = toPositiveInt(req.query?.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    const { where, params } = buildListFilter({ status, keyword });

    const countResult = await query(`SELECT COUNT(*)::int AS total FROM issues ${where}`, params);
    const total = countResult.rows[0].total;

    // LIMIT / OFFSET 也走占位符；不改动 params 里已有条件的顺序。
    const listResult = await query(
      `SELECT * FROM issues ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    return res.json({ items: listResult.rows, total, page, pageSize });
  } catch (err) {
    return next(err);
  }
});

// 从请求体白名单收集要改的字段（列名固定、绝不来自用户输入），返回 { sets, params }。
function collectPatch(body) {
  const sets = [];
  const params = [];

  if (body?.status !== undefined) {
    const status = cleanStr(body.status);
    if (!status || !STATUSES.includes(status)) {
      const e = new Error(`状态非法（需为 ${STATUSES.join(' / ')}）`);
      e.statusCode = 400;
      throw e;
    }
    params.push(status);
    sets.push(`status = $${params.length}`);
  }
  // reply / assignee 允许清空（传空串→存 NULL）。
  if (body?.reply !== undefined) {
    params.push(cleanStr(body.reply));
    sets.push(`reply = $${params.length}`);
  }
  if (body?.assignee !== undefined) {
    params.push(cleanStr(body.assignee));
    sets.push(`assignee = $${params.length}`);
  }
  return { sets, params };
}

// ------------------------------------------------------------------
// PATCH /issues/:id —— 改状态 / 回复 / 负责人；updated_at=now()
// body 里带哪个字段就改哪个（白名单 status / reply / assignee），至少要带一个。
// ------------------------------------------------------------------
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params?.id, 0);
    if (!id) {
      return res.status(400).json({ error: 'id 非法' });
    }

    const { sets, params } = collectPatch(req.body);
    if (sets.length === 0) {
      return res.status(400).json({ error: '没有可更新的字段（status / reply / assignee 至少传一个）' });
    }

    params.push(id);
    const result = await query(
      `UPDATE issues SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: '问题不存在' });
    }
    return res.json({ issue: result.rows[0] });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
});

export default router;
