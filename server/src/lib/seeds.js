// 可验证公平 —— 玩家种子承诺（player_seeds）读写唯一入口
// 模型 A：一玩家一条 active 种子，server_seed 明文只在 rotate 时 reveal。
// 硬约束：
//   1. ensureActiveSeed / claimNonce 都必须传入调用方事务里的 client，
//      复用同一事务，绝不自开连接（与 lib/wallet.js 同风格）。
//   2. nonce 递增用单语句 UPDATE ... RETURNING，靠行锁串行，防并发两注拿同 nonce。
//   3. active 唯一由 idx_player_seeds_one_active 部分唯一索引保证；
//      并发首建用 ON CONFLICT DO NOTHING + 回查，避免 23505 打断事务。
import crypto from 'crypto';

/** 新私密 serverSeed（32 字节随机，十六进制） */
export function newServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/** 新公开 clientSeed（8 字节随机，十六进制） */
export function newClientSeed() {
  return crypto.randomBytes(8).toString('hex');
}

/** sha256(serverSeed) 的十六进制摘要 —— 下注前公开的承诺 */
export function hashSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

/** 取该玩家当前 active 种子（不含 nonce 递增），无则返回 null */
async function selectActive(client, playerId) {
  const r = await client.query(
    `SELECT id, server_seed, server_seed_hash, client_seed, nonce
       FROM player_seeds
      WHERE player_id = $1 AND status = 'active'`,
    [playerId]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    serverSeed: row.server_seed,
    serverSeedHash: row.server_seed_hash,
    clientSeed: row.client_seed,
    nonce: row.nonce,
  };
}

/**
 * 确保该玩家有一条 active 种子：无则新建（serverSeed + hash + 随机 clientSeed + nonce 0）。
 * 并发首建安全：ON CONFLICT DO NOTHING 命中部分唯一索引后回查，返回当前 active。
 * @param {import('pg').PoolClient} client 事务内 client
 * @param {number|string} playerId
 * @returns {Promise<{id, serverSeed, serverSeedHash, clientSeed}>}
 */
export async function ensureActiveSeed(client, playerId) {
  const found = await selectActive(client, playerId);
  if (found) {
    return { id: found.id, serverSeed: found.serverSeed, serverSeedHash: found.serverSeedHash, clientSeed: found.clientSeed };
  }
  const serverSeed = newServerSeed();
  const serverSeedHash = hashSeed(serverSeed);
  const clientSeed = newClientSeed();
  await client.query(
    `INSERT INTO player_seeds (player_id, server_seed, server_seed_hash, client_seed, nonce, status)
     VALUES ($1, $2, $3, $4, 0, 'active')
     ON CONFLICT (player_id) WHERE status = 'active' DO NOTHING`,
    [playerId, serverSeed, serverSeedHash, clientSeed]
  );
  // 无论是自己插入的、还是并发对手已插入的，都回查当前 active 返回（保证一致）
  const active = await selectActive(client, playerId);
  return { id: active.id, serverSeed: active.serverSeed, serverSeedHash: active.serverSeedHash, clientSeed: active.clientSeed };
}

/**
 * 领取下一个 nonce（每局 +1）。单语句 UPDATE ... RETURNING，行锁串行防并发同 nonce。
 * 要求该玩家已有 active 种子（调用方应先 ensureActiveSeed）。
 * @param {import('pg').PoolClient} client 事务内 client
 * @param {number|string} playerId
 * @returns {Promise<{seedId, serverSeed, clientSeed, serverSeedHash, nonce}>}
 */
export async function claimNonce(client, playerId) {
  const r = await client.query(
    `UPDATE player_seeds
        SET nonce = nonce + 1
      WHERE player_id = $1 AND status = 'active'
      RETURNING id, server_seed, client_seed, server_seed_hash, nonce`,
    [playerId]
  );
  if (r.rowCount === 0) {
    throw new Error('该玩家无 active 种子（应先调 ensureActiveSeed）');
  }
  const row = r.rows[0];
  return {
    seedId: row.id,
    serverSeed: row.server_seed,
    clientSeed: row.client_seed,
    serverSeedHash: row.server_seed_hash,
    nonce: row.nonce,
  };
}
