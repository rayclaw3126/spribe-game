// 系统问题 / 反馈留档 —— 提交 / 查列表 / 改状态接口
// 铁律：全程 query() 参数化（$1、$2...），禁止任何字符串拼接 SQL；错误一律 next(err) 不吞。
// 鉴权：提交 / 查询 / 改状态本步都只要求登录（requireAuth）；细粒度权限后续单再收紧。
// 本步不含图片附件（下一步单独做）。
import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const PRIORITIES = ['high', 'mid', 'low'];
const STATUSES = ['new', 'processing', 'resolved', 'ignored'];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ---------- 图片上传（multer + 存本地磁盘）----------
// 限死大小/张数/格式防滥传；文件名用随机 hash 防猜测；只收 image/*。
const MAX_FILES = 6;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 单张 ≤ 5MB
const URL_PREFIX = '/uploads/issues'; // 对外访问前缀（index.js 用 express.static 托管）

// uploads/issues/ 目录：相对 server 根（本文件在 server/src/routes/）。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads/issues');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 由 mimetype 决定扩展名（不信原文件名，防伪造/路径穿越）。
const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const uploadImages = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = MIME_EXT[file.mimetype] || '.img';
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    // 只放行图片；非图片一律拒（会被下面 multer 错误映射成 400）。
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'images'));
  },
}).array('images', MAX_FILES);

// 把 multer 的各类报错映射成可读的 400 文案。
function uploadErrorMessage(err) {
  if (err.code === 'LIMIT_FILE_SIZE') return '单张图片超过 5MB 上限';
  if (err.code === 'LIMIT_FILE_COUNT') return `单次最多上传 ${MAX_FILES} 张`;
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return '仅支持图片文件（image/*）';
  return '图片上传失败';
}

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

// ------------------------------------------------------------------
// GET /issues/:id —— 单条详情，带它的图片列表（join issue_images）
// ------------------------------------------------------------------
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params?.id, 0);
    if (!id) {
      return res.status(400).json({ error: 'id 非法' });
    }
    const issueResult = await query('SELECT * FROM issues WHERE id = $1', [id]);
    if (issueResult.rowCount === 0) {
      return res.status(404).json({ error: '问题不存在' });
    }
    const imageResult = await query(
      `SELECT id, filename, url, created_at FROM issue_images
       WHERE issue_id = $1 ORDER BY created_at ASC, id ASC`,
      [id]
    );
    return res.json({ issue: { ...issueResult.rows[0], images: imageResult.rows } });
  } catch (err) {
    return next(err);
  }
});

// 在跑 multer 存盘前先拦掉不存在的 issue_id，避免落下孤儿文件。
async function ensureIssueExists(req, res, next) {
  try {
    const id = toPositiveInt(req.params?.id, 0);
    if (!id) {
      return res.status(400).json({ error: 'id 非法' });
    }
    const r = await query('SELECT id FROM issues WHERE id = $1', [id]);
    if (r.rowCount === 0) {
      return res.status(404).json({ error: '问题不存在' });
    }
    req.issueId = id;
    return next();
  } catch (err) {
    return next(err);
  }
}

// multer 包一层：把 LIMIT_* / 非图片等错误统一转成 400，不进全局 500。
function runUpload(req, res, next) {
  uploadImages(req, res, (err) => {
    if (err) return res.status(400).json({ error: uploadErrorMessage(err) });
    return next();
  });
}

// ------------------------------------------------------------------
// POST /issues/:id/images —— 给某条问题上传截图（最多 6 张，单张 ≤5MB，仅 image/*）
// 文件名随机 hash，落盘 uploads/issues/；每张插 issue_images 一条，返回 url 列表。
// ------------------------------------------------------------------
router.post('/:id/images', requireAuth, ensureIssueExists, runUpload, async (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: '未收到图片' });
    }
    const images = [];
    for (const f of files) {
      const url = `${URL_PREFIX}/${f.filename}`;
      const r = await query(
        `INSERT INTO issue_images (issue_id, filename, url)
         VALUES ($1, $2, $3)
         RETURNING id, filename, url, created_at`,
        [req.issueId, f.filename, url]
      );
      images.push(r.rows[0]);
    }
    return res.status(201).json({ images });
  } catch (err) {
    return next(err);
  }
});

export default router;
