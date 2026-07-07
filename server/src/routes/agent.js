// 代理树 + 额度下发接口
// 说明：本文件只负责「建下级代理」「上下级之间的额度发放/收回」「查子树/查直属下级」
// 这几个协议层接口。所有额度变动只通过 lib/credit.js 的 transfer，本文件不直接
// UPDATE credit_lines。越权访问（操作不在自己子树内的代理）一律 403 拒绝。
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { query, withTransaction } from '../db.js';
import { transfer } from '../lib/credit.js';
import { requireAuth, requireType } from '../middleware/auth.js';

const router = Router();

// 本文件所有接口都只给「代理」身份使用
router.use(requireAuth, requireType('agent'));

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * 判断 targetAgentId 是否在 meId 的子树内（即 meId 是 targetAgentId 的祖先）。
 * agents.path 是材料化路径（例如 boss.path = '{1}'，boss 的下级 A.path = '{1,2}'），
 * 判定规则：meId 出现在 target.path 里，且 target 不是 me 自己。
 * 必须传入事务内的 client（grant/reclaim 都在 withTransaction 里调用本函数）。
 * @param {import('pg').PoolClient} client
 * @param {number|string} meId
 * @param {number|string} targetAgentId
 * @returns {Promise<boolean>}
 */
async function isDescendant(client, meId, targetAgentId) {
  const result = await client.query(
    `SELECT ($1::text = ANY(path)) AS is_descendant
       FROM agents
      WHERE id = $2::bigint
        AND id <> $1::bigint`,
    [meId, targetAgentId]
  );
  // rowCount = 0 表示：目标代理不存在，或者目标就是自己 —— 两种情况都不算「在子树内」
  return result.rowCount > 0 && result.rows[0].is_descendant === true;
}

// ------------------------------------------------------------------
// POST /agent/create —— 建当前代理的直属下级
// ------------------------------------------------------------------
router.post('/create', async (req, res, next) => {
  try {
    const meId = req.user.sub;
    const { username, password, role } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: '参数不完整：username / password 均为必填' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await withTransaction(async (client) => {
      const meResult = await client.query('SELECT id, path, level FROM agents WHERE id = $1', [
        meId,
      ]);
      if (meResult.rowCount === 0) {
        throw httpError(404, '当前代理不存在');
      }
      const me = meResult.rows[0];
      const newLevel = (me.level || 1) + 1;

      // 两段式：先 INSERT 拿到新代理 id，再用它拼出 path（path 需要新 id 本身才能算完整）
      const insertResult = await client.query(
        `INSERT INTO agents (parent_id, username, password_hash, level, role, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING id, username, level`,
        [me.id, username, passwordHash, newLevel, role || 'agent']
      );
      const newAgent = insertResult.rows[0];

      const updateResult = await client.query(
        `UPDATE agents
            SET path = COALESCE($1::text[], ARRAY[$2::text]) || $3::text
          WHERE id = $3::bigint
          RETURNING path`,
        [me.path, String(me.id), String(newAgent.id)]
      );
      const newPath = updateResult.rows[0].path;

      // 审计：新建代理不是「对某个玩家的操作」，target_player 留空，目标代理 id 写进 detail
      await client.query(
        `INSERT INTO audit_log (actor_agent, action, detail)
         VALUES ($1, 'agent_create', $2::jsonb)`,
        [
          meId,
          JSON.stringify({ newAgentId: newAgent.id, username: newAgent.username, role: role || 'agent' }),
        ]
      );

      return { id: newAgent.id, username: newAgent.username, level: newAgent.level, path: newPath };
    });

    return res.json(result);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: '用户名已存在' });
    }
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

// ------------------------------------------------------------------
// POST /agent/credit/grant —— 给子树内的下级发额度
// ------------------------------------------------------------------
router.post('/credit/grant', async (req, res, next) => {
  try {
    const meId = req.user.sub;
    const { toAgent, amount } = req.body || {};

    if (!toAgent || !amount) {
      return res.status(400).json({ error: '参数不完整：toAgent / amount 均为必填' });
    }

    const result = await withTransaction(async (client) => {
      const ok = await isDescendant(client, meId, toAgent);
      if (!ok) {
        throw httpError(403, '目标不在你的线下');
      }

      const transferResult = await transfer(client, {
        fromAgent: meId,
        toAgent,
        amount,
        type: 'grant',
      });

      // 审计：target_player 这一列的外键指向 players(id)，这里的目标是代理而非玩家，
      // 硬塞进去会因外键约束报错，所以 target_player 留空，目标代理 id 写进 detail。
      await client.query(
        `INSERT INTO audit_log (actor_agent, action, amount, detail)
         VALUES ($1, 'credit_grant', $2::numeric, $3::jsonb)`,
        [meId, amount, JSON.stringify({ targetAgent: toAgent, direction: 'grant' })]
      );

      return transferResult;
    });

    return res.json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    if (err.message === '额度不足') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
});

// ------------------------------------------------------------------
// POST /agent/credit/reclaim —— 从子树内的下级收回额度
// ------------------------------------------------------------------
router.post('/credit/reclaim', async (req, res, next) => {
  try {
    const meId = req.user.sub;
    const { fromAgent, amount } = req.body || {};

    if (!fromAgent || !amount) {
      return res.status(400).json({ error: '参数不完整：fromAgent / amount 均为必填' });
    }

    const result = await withTransaction(async (client) => {
      const ok = await isDescendant(client, meId, fromAgent);
      if (!ok) {
        throw httpError(403, '目标不在你的线下');
      }

      // 方向：下级(fromAgent) -> 我(meId)，校验的是下级的额度是否够被收回
      const transferResult = await transfer(client, {
        fromAgent,
        toAgent: meId,
        amount,
        type: 'reclaim',
      });

      await client.query(
        `INSERT INTO audit_log (actor_agent, action, amount, detail)
         VALUES ($1, 'credit_reclaim', $2::numeric, $3::jsonb)`,
        [meId, amount, JSON.stringify({ targetAgent: fromAgent, direction: 'reclaim' })]
      );

      return transferResult;
    });

    return res.json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    if (err.message === '额度不足') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
});

// ------------------------------------------------------------------
// GET /agent/tree —— 我的整棵子树（平铺 + path，前端自己组树）
// ------------------------------------------------------------------
router.get('/tree', async (req, res, next) => {
  try {
    const meId = req.user.sub;
    const result = await query(
      `SELECT a.id, a.username, a.level, a.path, a.role, a.status, cl.credit
         FROM agents a
         LEFT JOIN credit_lines cl ON cl.agent_id = a.id
        WHERE $1::text = ANY(a.path)
          AND a.id <> $1::bigint
        ORDER BY a.path`,
      [meId]
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// ------------------------------------------------------------------
// GET /agent/downline —— 我的直属下级（代理 + 玩家混合）
// ------------------------------------------------------------------
router.get('/downline', async (req, res, next) => {
  try {
    const meId = req.user.sub;
    const result = await query(
      `SELECT id, username, level, role, status, 'agent'::text AS kind
         FROM agents
        WHERE parent_id = $1::bigint
       UNION ALL
       SELECT id, username, NULL::integer AS level, NULL::text AS role, status, 'player'::text AS kind
         FROM players
        WHERE agent_id = $1::bigint
       ORDER BY kind, id`,
      [meId]
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

export default router;
