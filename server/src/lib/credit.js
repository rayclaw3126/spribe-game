// 额度唯一出入口
// 说明：这是代理商之间信用额度发生变化的唯一路径。上级给下级发额度（grant）、
// 上级从下级收回额度（reclaim），本质上都是「额度从一个代理转移到另一个代理」，
// 因此复用同一个 transfer 函数，只是调用方传入的 fromAgent/toAgent 方向不同。
// 除本文件外，任何地方都不允许直接 UPDATE credit_lines。
// 硬约束：
//   1. 调用方必须已经处于数据库事务中（withTransaction 拿到的 client），
//      这里对 fromAgent、toAgent 两行都做 SELECT ... FOR UPDATE 行锁，
//      防止并发发放/收回额度导致的竞态。为避免两笔方向相反的转账互相等待造成死锁，
//      统一按 agent_id 大小顺序依次加锁。
//   2. 金额计算全部交给 Postgres numeric 完成（SQL 里用 $n::numeric 做加减/比较），
//      JS 侧不做任何浮点加减运算，只做字符串透传。
//   3. 每次转移都在 credit_ledger 记一笔流水。

/**
 * 额度转移（grant/reclaim 的唯一实现）
 * @param {import('pg').PoolClient} client - 必须是事务内的 client
 * @param {{fromAgent:number|string, toAgent:number|string, amount:string, type:string}} params
 * @returns {Promise<{fromCreditAfter:string, toCreditAfter:string}>}
 */
export async function transfer(client, { fromAgent, toAgent, amount, type }) {
  // 0. 统一按 agent_id 排序后依次加锁，避免「A 转 B」和「B 转 A」两个并发事务
  //    以相反顺序加锁导致死锁。
  const orderedIds = [fromAgent, toAgent].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true })
  );

  // 1. 确保两边的 credit_lines 行都存在：没有记录视为额度 0，先补一行 0 额度，
  //    这样后面才能对已存在的行做 SELECT ... FOR UPDATE 加锁 + UPDATE。
  for (const agentId of orderedIds) {
    await client.query(
      `INSERT INTO credit_lines (agent_id, credit, version)
       VALUES ($1, 0, 0)
       ON CONFLICT (agent_id) DO NOTHING`,
      [agentId]
    );
  }

  // 2. 按固定顺序锁两行，取当前额度
  const creditByAgent = {};
  for (const agentId of orderedIds) {
    const lockResult = await client.query(
      'SELECT credit FROM credit_lines WHERE agent_id = $1 FOR UPDATE',
      [agentId]
    );
    creditByAgent[agentId] = lockResult.rows[0].credit;
  }

  // 3. 校验上级（fromAgent）额度是否充足：用 SQL numeric 比较，
  //    避免 JS 侧把 decimal 字符串转成 number 做大小比较。
  const enoughResult = await client.query('SELECT $1::numeric >= $2::numeric AS enough', [
    creditByAgent[fromAgent],
    amount,
  ]);
  if (!enoughResult.rows[0].enough) {
    throw new Error('额度不足');
  }

  // 4. 扣 fromAgent、加 toAgent，全部交给 Postgres numeric 运算完成
  const fromUpdateResult = await client.query(
    `UPDATE credit_lines
        SET credit = credit - $2::numeric,
            version = version + 1,
            updated_at = now()
      WHERE agent_id = $1
      RETURNING credit`,
    [fromAgent, amount]
  );
  const toUpdateResult = await client.query(
    `UPDATE credit_lines
        SET credit = credit + $2::numeric,
            version = version + 1,
            updated_at = now()
      WHERE agent_id = $1
      RETURNING credit`,
    [toAgent, amount]
  );

  // 5. 记账
  await client.query(
    `INSERT INTO credit_ledger (from_agent, to_agent, amount, type)
     VALUES ($1, $2, $3::numeric, $4)`,
    [fromAgent, toAgent, amount, type]
  );

  return {
    fromCreditAfter: fromUpdateResult.rows[0].credit,
    toCreditAfter: toUpdateResult.rows[0].credit,
  };
}
