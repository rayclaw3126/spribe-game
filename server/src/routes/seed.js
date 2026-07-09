// 可验证公平 —— 玩家种子自助接口（模型 A）
// 铁律：active serverSeed 明文【只在 /seed/rotate 时 reveal】，其余接口一律只给 hash。
// 全部 requireAuth + requireType('player')。
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { requireAuth, requireType } from '../middleware/auth.js';
import { ensureActiveSeed, newServerSeed, newClientSeed, hashSeed } from '../lib/seeds.js';

const router = Router();

// clientSeed 合法性：非空字符串、去空白后 1–128 位（防超长/空串）
function normalizeClientSeed(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length < 1 || s.length > 128) return null;
  return s;
}

// ------------------------------------------------------------------
// GET /seed/current —— 当前 active 种子的承诺信息（不含 server_seed 明文）
// 无 active 则先 ensureActiveSeed 兜底（首次调用即建）。
// ------------------------------------------------------------------
router.get('/current', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const active = await withTransaction(async (client) => {
      await ensureActiveSeed(client, playerId);
      const r = await client.query(
        `SELECT server_seed_hash, client_seed, nonce
           FROM player_seeds WHERE player_id = $1 AND status = 'active'`,
        [playerId]
      );
      return r.rows[0];
    });
    return res.json({
      serverSeedHash: active.server_seed_hash,
      clientSeed: active.client_seed,
      nonce: active.nonce,
    });
  } catch (err) {
    return next(err);
  }
});

// ------------------------------------------------------------------
// POST /seed/rotate  { clientSeed?: string }
// 唯一 reveal 明文的地方：公开当前 active 的 server_seed（供玩家事后验证历史局），
// 旧行转 revealed，插入新的 active（nonce 归零）。部分唯一索引兜并发双 rotate。
// ------------------------------------------------------------------
router.post('/rotate', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const rawClientSeed = req.body?.clientSeed;
    // 传了 clientSeed 就校验；没传则新种子用后端随机 clientSeed
    let nextClientSeed = null;
    if (rawClientSeed !== undefined) {
      nextClientSeed = normalizeClientSeed(rawClientSeed);
      if (nextClientSeed === null) {
        return res.status(400).json({ error: 'clientSeed 非法（需 1–128 位非空字符串）' });
      }
    }

    const result = await withTransaction(async (client) => {
      await ensureActiveSeed(client, playerId);
      // 原子认领：只有一个事务能把当前 active→revealed 成功（并发另一方拿到 0 行）
      const rev = await client.query(
        `UPDATE player_seeds
            SET status = 'revealed', revealed_at = now()
          WHERE player_id = $1 AND status = 'active'
          RETURNING id, server_seed, server_seed_hash, client_seed, nonce`,
        [playerId]
      );
      if (rev.rowCount === 0) {
        const e = new Error('并发轮换冲突，请重试');
        e.statusCode = 409;
        throw e;
      }
      const old = rev.rows[0];

      const serverSeed = newServerSeed();
      const serverSeedHash = hashSeed(serverSeed);
      const clientSeed = nextClientSeed !== null ? nextClientSeed : newClientSeed();

      // 插新 active；若并发对手已插，撞部分唯一索引 23505 → 上层转 409
      await client.query(
        `INSERT INTO player_seeds (player_id, server_seed, server_seed_hash, client_seed, nonce, status)
         VALUES ($1, $2, $3, $4, 0, 'active')`,
        [playerId, serverSeed, serverSeedHash, clientSeed]
      );

      return {
        // 唯一给明文的地方：revealed.serverSeed 供玩家用 (clientSeed, nonce) 重算历史局
        revealed: {
          serverSeed: old.server_seed,
          serverSeedHash: old.server_seed_hash,
          clientSeed: old.client_seed,
          nonce: old.nonce,
        },
        active: {
          serverSeedHash,
          clientSeed,
          nonce: 0,
        },
      };
    });

    return res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: '并发轮换冲突，请重试' });
    return next(err);
  }
});

// ------------------------------------------------------------------
// POST /seed/client  { clientSeed: string }
// 改 active 的 client_seed，【仅当 nonce=0】允许（同种子中途换 clientSeed 有验证歧义）。
// nonce>0 → 409，提示先 rotate。
// ------------------------------------------------------------------
router.post('/client', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const clientSeed = normalizeClientSeed(req.body?.clientSeed);
    if (clientSeed === null) {
      return res.status(400).json({ error: 'clientSeed 非法（需 1–128 位非空字符串）' });
    }

    const result = await withTransaction(async (client) => {
      await ensureActiveSeed(client, playerId);
      const lock = await client.query(
        `SELECT id, nonce FROM player_seeds
          WHERE player_id = $1 AND status = 'active' FOR UPDATE`,
        [playerId]
      );
      const row = lock.rows[0];
      if (row.nonce > 0) {
        const e = new Error('当前种子已用过（nonce>0），需先 /seed/rotate 才能改 clientSeed');
        e.statusCode = 409;
        throw e;
      }
      const upd = await client.query(
        `UPDATE player_seeds SET client_seed = $2
          WHERE id = $1
          RETURNING server_seed_hash, client_seed, nonce`,
        [row.id, clientSeed]
      );
      return upd.rows[0];
    });

    return res.json({
      serverSeedHash: result.server_seed_hash,
      clientSeed: result.client_seed,
      nonce: result.nonce,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
});

export default router;
