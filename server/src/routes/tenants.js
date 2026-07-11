// 白标商家（tenant）—— 列表 / 开通 / 编辑接口
// 铁律：全程 query() 参数化（$1、$2...），禁止字符串拼接 SQL；错误一律 next(err) 不吞。
// 鉴权：全部 requireAuth（照 issues.js 同款）。写法/错误处理对齐 issues.js。
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const STATUSES = ['active', 'disabled'];

// 取字符串并去空白；非字符串或空串返回 null。
function cleanStr(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s.length ? s : null;
}

// 解析正整数路径参数，非法返回回退值。
function toPositiveInt(raw, fallback) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

// ------------------------------------------------------------------
// GET /tenants —— 商家列表（按主键升序，与开通时间同序）
// ------------------------------------------------------------------
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM tenants ORDER BY id ASC');
    return res.json({ items: result.rows });
  } catch (err) {
    return next(err);
  }
});

// ------------------------------------------------------------------
// POST /tenants —— 开通商家（name 必填；domain/skin 可选；status 缺省 active）
// ------------------------------------------------------------------
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const name = cleanStr(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: '商家名必填' });
    }
    const domain = cleanStr(req.body?.domain);
    const skin = cleanStr(req.body?.skin);
    const status = cleanStr(req.body?.status) || 'active';
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `状态非法（需为 ${STATUSES.join(' / ')}）` });
    }

    const result = await query(
      `INSERT INTO tenants (name, domain, skin, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, domain, skin, status]
    );
    return res.status(201).json({ tenant: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

// 从请求体白名单收集要改的字段（列名固定、绝不来自用户输入），返回 { sets, params }。
function collectPatch(body) {
  const sets = [];
  const params = [];

  if (body?.name !== undefined) {
    const name = cleanStr(body.name);
    if (!name) {
      const e = new Error('商家名不能为空');
      e.statusCode = 400;
      throw e;
    }
    params.push(name);
    sets.push(`name = $${params.length}`);
  }
  // domain / skin 允许清空（传空串→存 NULL）。
  if (body?.domain !== undefined) {
    params.push(cleanStr(body.domain));
    sets.push(`domain = $${params.length}`);
  }
  if (body?.skin !== undefined) {
    params.push(cleanStr(body.skin));
    sets.push(`skin = $${params.length}`);
  }
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
  return { sets, params };
}

// ------------------------------------------------------------------
// PATCH /tenants/:id —— 编辑商家（name/domain/skin/status 至少传一个）；updated_at=now()
// ------------------------------------------------------------------
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params?.id, 0);
    if (!id) {
      return res.status(400).json({ error: 'id 非法' });
    }

    const { sets, params } = collectPatch(req.body);
    if (sets.length === 0) {
      return res.status(400).json({ error: '没有可更新的字段（name / domain / skin / status 至少传一个）' });
    }

    params.push(id);
    const result = await query(
      `UPDATE tenants SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: '商家不存在' });
    }
    return res.json({ tenant: result.rows[0] });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
});

export default router;
