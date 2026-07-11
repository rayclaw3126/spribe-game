// 代理树 + 额度下发接口
// 说明：本文件只负责「建下级代理」「上下级之间的额度发放/收回」「查子树/查直属下级」
// 「占成设置」「玩家上下分」这几个协议层接口。所有额度变动只通过 lib/credit.js 的
// transfer/spend/topup，本文件不直接 UPDATE credit_lines。越权访问（操作不在自己
// 子树内的代理，或目标玩家不在自己线下）一律 403 拒绝。
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { query, withTransaction } from '../db.js';
import { transfer, spend, topup } from '../lib/credit.js';
import * as wallet from '../lib/wallet.js';
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

/**
 * 判断玩家 playerId 是否在 meId 的线下（即 meId 是玩家所属代理的祖先，或就是其直属代理）。
 * 玩家直属代理的 path 本身就包含它自己，所以「玩家直属代理 === meId」时 path 也会含 meId，
 * 这里不像 isDescendant 那样排除「target===me」的情况，天然覆盖了「玩家就在我自己名下」。
 * 必须传入事务内的 client（deposit/withdraw 都在 withTransaction 里调用本函数）。
 * @param {import('pg').PoolClient} client
 * @param {number|string} meId
 * @param {number|string} playerId
 * @returns {Promise<{ok:boolean, agentId:(number|null)}>} - ok=是否在线下；agentId=玩家所属代理 id（玩家不存在则为 null）
 */
async function isPlayerInDownline(client, meId, playerId) {
  const result = await client.query(
    `SELECT p.agent_id AS agent_id, ($1::text = ANY(a.path)) AS is_in_downline
       FROM players p
       JOIN agents a ON a.id = p.agent_id
      WHERE p.id = $2::bigint`,
    [meId, playerId]
  );
  if (result.rowCount === 0) {
    return { ok: false, agentId: null };
  }
  return { ok: result.rows[0].is_in_downline === true, agentId: result.rows[0].agent_id };
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
      const meResult = await client.query('SELECT id, path, level, tenant_id FROM agents WHERE id = $1', [
        meId,
      ]);
      if (meResult.rowCount === 0) {
        throw httpError(404, '当前代理不存在');
      }
      const me = meResult.rows[0];
      const newLevel = (me.level || 1) + 1;

      // 两段式：先 INSERT 拿到新代理 id，再用它拼出 path（path 需要新 id 本身才能算完整）
      // tenant_id 继承父代理（商家=顶级代理，全树同 tenant）。
      const insertResult = await client.query(
        `INSERT INTO agents (parent_id, username, password_hash, level, role, status, tenant_id)
         VALUES ($1, $2, $3, $4, $5, 'active', $6)
         RETURNING id, username, level`,
        [me.id, username, passwordHash, newLevel, role || 'agent', me.tenant_id]
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
      `SELECT id, username, level, role, status, 'agent'::text AS kind, NULL::numeric AS balance
         FROM agents
        WHERE parent_id = $1::bigint
       UNION ALL
       SELECT p.id, p.username, NULL::integer AS level, NULL::text AS role, p.status, 'player'::text AS kind, w.balance
         FROM players p
         LEFT JOIN wallets w ON w.player_id = p.id
        WHERE p.agent_id = $1::bigint
       ORDER BY kind, id`,
      [meId]
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// ------------------------------------------------------------------
// GET /agent/me —— 登录代理自己的基础信息 + 额度 + 分成比例
// ------------------------------------------------------------------
router.get('/me', async (req, res, next) => {
  try {
    const meId = req.user.sub;
    const result = await query(
      `SELECT a.id, a.username, a.level, a.role, a.status,
              cl.credit AS credit,
              cc.win_loss_pct AS win_loss_pct,
              cc.turnover_pct AS turnover_pct
         FROM agents a
         LEFT JOIN credit_lines cl ON cl.agent_id = a.id
         LEFT JOIN commission_config cc ON cc.agent_id = a.id
        WHERE a.id = $1::bigint`,
      [meId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: '当前代理不存在' });
    }
    const row = result.rows[0];
    return res.json({
      id: row.id,
      username: row.username,
      level: row.level,
      role: row.role,
      status: row.status,
      credit: row.credit,
      winLossPct: row.win_loss_pct,
      turnoverPct: row.turnover_pct,
    });
  } catch (err) {
    return next(err);
  }
});

// ------------------------------------------------------------------
// POST /agent/commission/config —— 给子树内的下级代理设占成比例
// ------------------------------------------------------------------
router.post('/commission/config', async (req, res, next) => {
  try {
    const meId = req.user.sub;
    const { agentId, winLossPct, turnoverPct } = req.body || {};

    if (!agentId || winLossPct === undefined || winLossPct === null || turnoverPct === undefined || turnoverPct === null) {
      return res.status(400).json({ error: '参数不完整：agentId / winLossPct / turnoverPct 均为必填' });
    }

    const result = await withTransaction(async (client) => {
      const ok = await isDescendant(client, meId, agentId);
      if (!ok) {
        throw httpError(403, '目标不在你的线下');
      }

      // 自己无 commission_config 记录时，视为上限 100.00（顶级代理没有上级约束）
      const selfResult = await client.query(
        'SELECT win_loss_pct, turnover_pct FROM commission_config WHERE agent_id = $1',
        [meId]
      );
      const selfWin = selfResult.rowCount > 0 ? selfResult.rows[0].win_loss_pct : '100.00';
      const selfTurn = selfResult.rowCount > 0 ? selfResult.rows[0].turnover_pct : '100.00';

      const withinLimitResult = await client.query(
        'SELECT $1::numeric <= $2::numeric AS win_ok, $3::numeric <= $4::numeric AS turn_ok',
        [winLossPct, selfWin, turnoverPct, selfTurn]
      );
      const { win_ok: winOk, turn_ok: turnOk } = withinLimitResult.rows[0];
      if (!winOk || !turnOk) {
        throw httpError(400, '占成不能超过上级');
      }

      await client.query(
        `INSERT INTO commission_config (agent_id, win_loss_pct, turnover_pct)
         VALUES ($1, $2::numeric, $3::numeric)
         ON CONFLICT (agent_id) DO UPDATE
           SET win_loss_pct = $2::numeric, turnover_pct = $3::numeric, updated_at = now()`,
        [agentId, winLossPct, turnoverPct]
      );

      await client.query(
        `INSERT INTO audit_log (actor_agent, action, detail)
         VALUES ($1, 'commission_config', $2::jsonb)`,
        [meId, JSON.stringify({ targetAgent: agentId, winLossPct, turnoverPct })]
      );

      return { agentId, winLossPct, turnoverPct };
    });

    return res.json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

// ------------------------------------------------------------------
// POST /agent/player/deposit —— 玩家上分（额度 -> 玩家余额）
// ------------------------------------------------------------------
router.post('/player/deposit', async (req, res, next) => {
  try {
    const meId = req.user.sub;
    const { playerId, amount, idempotencyKey } = req.body || {};

    if (!playerId || !amount || !idempotencyKey) {
      return res.status(400).json({ error: '参数不完整：playerId / amount / idempotencyKey 均为必填' });
    }

    const result = await withTransaction(async (client) => {
      // 幂等：同一个 idempotencyKey 已经处理过，直接把当时的结果原样返回，不重复扣额度/加余额
      const existing = await client.query('SELECT balance_after FROM ledger WHERE idempotency_key = $1', [
        idempotencyKey,
      ]);
      if (existing.rowCount > 0) {
        return { playerBalanceAfter: existing.rows[0].balance_after, agentCreditAfter: null, idempotent: true };
      }

      const { ok, agentId } = await isPlayerInDownline(client, meId, playerId);
      if (!ok) {
        throw httpError(403, '目标不在你的线下');
      }

      const spendResult = await spend(client, { agentId: meId, amount, type: 'player_deposit' });
      const creditResult = await wallet.credit(client, {
        playerId,
        amount,
        type: 'deposit',
        idempotencyKey,
      });

      await client.query(
        `INSERT INTO audit_log (actor_agent, action, target_player, amount, detail)
         VALUES ($1, 'player_deposit', $2::bigint, $3::numeric, $4::jsonb)`,
        [meId, playerId, amount, JSON.stringify({ agentCreditAfter: spendResult.creditAfter, targetAgent: agentId })]
      );

      return {
        playerBalanceAfter: creditResult.balanceAfter,
        agentCreditAfter: spendResult.creditAfter,
        idempotent: false,
      };
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
// POST /agent/player/withdraw —— 玩家下分（玩家余额 -> 额度）
// ------------------------------------------------------------------
router.post('/player/withdraw', async (req, res, next) => {
  try {
    const meId = req.user.sub;
    const { playerId, amount, idempotencyKey } = req.body || {};

    if (!playerId || !amount || !idempotencyKey) {
      return res.status(400).json({ error: '参数不完整：playerId / amount / idempotencyKey 均为必填' });
    }

    const result = await withTransaction(async (client) => {
      // 幂等：同一个 idempotencyKey 已经处理过，直接把当时的结果原样返回，不重复扣余额/加额度
      const existing = await client.query('SELECT balance_after FROM ledger WHERE idempotency_key = $1', [
        idempotencyKey,
      ]);
      if (existing.rowCount > 0) {
        return { playerBalanceAfter: existing.rows[0].balance_after, agentCreditAfter: null, idempotent: true };
      }

      const { ok, agentId } = await isPlayerInDownline(client, meId, playerId);
      if (!ok) {
        throw httpError(403, '目标不在你的线下');
      }

      const debitResult = await wallet.debit(client, {
        playerId,
        amount,
        type: 'withdraw',
        idempotencyKey,
      });
      const topupResult = await topup(client, { agentId: meId, amount, type: 'player_withdraw' });

      await client.query(
        `INSERT INTO audit_log (actor_agent, action, target_player, amount, detail)
         VALUES ($1, 'player_withdraw', $2::bigint, $3::numeric, $4::jsonb)`,
        [meId, playerId, amount, JSON.stringify({ agentCreditAfter: topupResult.creditAfter, targetAgent: agentId })]
      );

      return {
        playerBalanceAfter: debitResult.balanceAfter,
        agentCreditAfter: topupResult.creditAfter,
        idempotent: false,
      };
    });

    return res.json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    if (err.message === '余额不足') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
});

export default router;
