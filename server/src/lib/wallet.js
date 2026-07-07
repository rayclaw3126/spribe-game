// 钱包资金唯一出入口
// 说明：这是玩家余额发生变化的唯一路径（下注扣钱 debit、结算加钱 credit）。
// 除本文件外，任何地方都不允许直接 UPDATE wallets.balance。
// 硬约束：
//   1. 调用方必须已经处于数据库事务中（传入 withTransaction 里拿到的 client），
//      这里用 `SELECT ... FOR UPDATE` 对该玩家的钱包行加锁，防止并发扣款/加钱冲突。
//   2. 金额计算全部交给 Postgres 的 numeric 类型完成（SQL 里用 $n::numeric 做加减/比较），
//      JS 侧不做任何浮点加减运算，只做字符串透传，避免浮点精度问题。
//   3. 每次变动都在 ledger 记一笔流水，带 balance_before / balance_after。

/**
 * 扣款（下注等场景）
 * @param {import('pg').PoolClient} client - 必须是事务内的 client
 * @param {{playerId:number|string, amount:string, type:string, idempotencyKey?:string, roundId?:number|string}} params
 * @returns {Promise<{balanceBefore:string, balanceAfter:string}>}
 */
export async function debit(client, { playerId, amount, type, idempotencyKey, roundId }) {
  // 1. 行锁 + 取当前余额（作为 balance_before）
  const lockResult = await client.query(
    'SELECT balance FROM wallets WHERE player_id = $1 FOR UPDATE',
    [playerId]
  );
  if (lockResult.rowCount === 0) {
    throw new Error('钱包不存在');
  }
  const balanceBefore = lockResult.rows[0].balance;

  // 2. 扣款：由 Postgres numeric 完成减法与「余额是否充足」的比较，
  //    命中 WHERE 条件才会真正更新（原子操作，避免竞态）。
  const updateResult = await client.query(
    `UPDATE wallets
        SET balance = balance - $2::numeric,
            version = version + 1,
            updated_at = now()
      WHERE player_id = $1
        AND balance >= $2::numeric
      RETURNING balance`,
    [playerId, amount]
  );
  if (updateResult.rowCount === 0) {
    // 行已被锁定且已知钱包存在，走到这里说明余额不足
    throw new Error('余额不足');
  }
  const balanceAfter = updateResult.rows[0].balance;

  // 3. 记账
  await client.query(
    `INSERT INTO ledger (player_id, type, amount, balance_before, balance_after, idempotency_key, round_id)
     VALUES ($1, $2, $3::numeric, $4, $5, $6, $7)`,
    [playerId, type, amount, balanceBefore, balanceAfter, idempotencyKey || null, roundId || null]
  );

  return { balanceBefore, balanceAfter };
}

/**
 * 加钱（派彩/上分等场景）
 * @param {import('pg').PoolClient} client - 必须是事务内的 client
 * @param {{playerId:number|string, amount:string, type:string, idempotencyKey?:string, roundId?:number|string}} params
 * @returns {Promise<{balanceBefore:string, balanceAfter:string}>}
 */
export async function credit(client, { playerId, amount, type, idempotencyKey, roundId }) {
  // 1. 行锁 + 取当前余额（作为 balance_before）
  const lockResult = await client.query(
    'SELECT balance FROM wallets WHERE player_id = $1 FOR UPDATE',
    [playerId]
  );
  if (lockResult.rowCount === 0) {
    throw new Error('钱包不存在');
  }
  const balanceBefore = lockResult.rows[0].balance;

  // 2. 加钱：同样交给 Postgres numeric 做加法
  const updateResult = await client.query(
    `UPDATE wallets
        SET balance = balance + $2::numeric,
            version = version + 1,
            updated_at = now()
      WHERE player_id = $1
      RETURNING balance`,
    [playerId, amount]
  );
  const balanceAfter = updateResult.rows[0].balance;

  // 3. 记账
  await client.query(
    `INSERT INTO ledger (player_id, type, amount, balance_before, balance_after, idempotency_key, round_id)
     VALUES ($1, $2, $3::numeric, $4, $5, $6, $7)`,
    [playerId, type, amount, balanceBefore, balanceAfter, idempotencyKey || null, roundId || null]
  );

  return { balanceBefore, balanceAfter };
}
