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

// ------------------------------------------------------------------
// 玩家上下分（额度 <-> 玩家余额 的单边兑换）
// 说明：玩家不在 credit 体系内（玩家的钱在 wallets，不在 credit_lines），
// 所以「上分/下分」不是「代理转代理」，而是代理一侧的额度单边减少/增加，
// 对侧没有另一个 agent_id 可填，credit_ledger 里用 NULL 表示「对手方是玩家钱包，
// 不追踪到某个具体 agent」（如调用方明确知道对手代理，可选传 counterAgent 覆盖）。
// spend/topup 内部各自负责补 0 额度行 + 行锁 + numeric 校验/加减 + 记流水，
// 与 transfer 一样只能在事务内调用，且是 credit_lines 表仅有的写入口之一。
// ------------------------------------------------------------------

/**
 * 扣减代理额度（玩家「上分」时调用：额度 -> 玩家余额）
 * @param {import('pg').PoolClient} client - 必须是事务内的 client
 * @param {{agentId:number|string, amount:string, type:string, counterAgent?:number|string|null}} params
 * @returns {Promise<{creditAfter:string}>}
 */
export async function spend(client, { agentId, amount, type, counterAgent = null }) {
  // 1. 确保该代理有 credit_lines 行（没有则补一行 0 额度）
  await client.query(
    `INSERT INTO credit_lines (agent_id, credit, version)
     VALUES ($1, 0, 0)
     ON CONFLICT (agent_id) DO NOTHING`,
    [agentId]
  );

  // 2. 行锁，取当前额度
  const lockResult = await client.query(
    'SELECT credit FROM credit_lines WHERE agent_id = $1 FOR UPDATE',
    [agentId]
  );
  const currentCredit = lockResult.rows[0].credit;

  // 3. numeric 校验额度是否充足
  const enoughResult = await client.query('SELECT $1::numeric >= $2::numeric AS enough', [
    currentCredit,
    amount,
  ]);
  if (!enoughResult.rows[0].enough) {
    throw new Error('额度不足');
  }

  // 4. 扣减
  const updateResult = await client.query(
    `UPDATE credit_lines
        SET credit = credit - $2::numeric,
            version = version + 1,
            updated_at = now()
      WHERE agent_id = $1
      RETURNING credit`,
    [agentId, amount]
  );

  // 5. 记账：from=agentId（额度被扣的一方），to=counterAgent（默认 NULL，表示对手方是玩家钱包）
  await client.query(
    `INSERT INTO credit_ledger (from_agent, to_agent, amount, type)
     VALUES ($1, $2, $3::numeric, $4)`,
    [agentId, counterAgent, amount, type]
  );

  return { creditAfter: updateResult.rows[0].credit };
}

/**
 * 加回代理额度（玩家「下分」时调用：玩家余额 -> 额度）
 * @param {import('pg').PoolClient} client - 必须是事务内的 client
 * @param {{agentId:number|string, amount:string, type:string, counterAgent?:number|string|null}} params
 * @returns {Promise<{creditAfter:string}>}
 */
export async function topup(client, { agentId, amount, type, counterAgent = null }) {
  // 1. 确保该代理有 credit_lines 行（没有则补一行 0 额度）
  await client.query(
    `INSERT INTO credit_lines (agent_id, credit, version)
     VALUES ($1, 0, 0)
     ON CONFLICT (agent_id) DO NOTHING`,
    [agentId]
  );

  // 2. 行锁，取当前额度（加回场景不需要校验充足性，只是同一把锁保证并发安全）
  await client.query('SELECT credit FROM credit_lines WHERE agent_id = $1 FOR UPDATE', [agentId]);

  // 3. 加回
  const updateResult = await client.query(
    `UPDATE credit_lines
        SET credit = credit + $2::numeric,
            version = version + 1,
            updated_at = now()
      WHERE agent_id = $1
      RETURNING credit`,
    [agentId, amount]
  );

  // 4. 记账：from=counterAgent（默认 NULL，表示对手方是玩家钱包），to=agentId（额度被加回的一方）
  await client.query(
    `INSERT INTO credit_ledger (from_agent, to_agent, amount, type)
     VALUES ($1, $2, $3::numeric, $4)`,
    [counterAgent, agentId, amount, type]
  );

  return { creditAfter: updateResult.rows[0].credit };
}
