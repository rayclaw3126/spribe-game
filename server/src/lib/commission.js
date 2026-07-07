// 链式分成唯一入口
// 说明：玩家本局输钱时调用 distributeLoss，是佣金写入 commissions 表的唯一路径，
// 除本文件外不允许在别处直接 INSERT INTO commissions。
//
// 算法说明——「逐级抽剩往下」（通用实现，多级算法细节待业务复核）：
//   从玩家的直属代理（agentId）出发，沿着 agents.parent_id 逐级向上追溯，
//   直到 parent_id IS NULL 的顶级代理为止（**注意：追溯用 parent_id，不依赖 path 字段**）。
//   维护一个 remaining（本次可供抽成的剩余金额，初始 = lossAmount）：
//     - 每上溯到一级代理，就按该代理在 commission_config.win_loss_pct 配置的百分比，
//       从当前 remaining 中抽出 commission = remaining * pct / 100，写入一条 commissions 记录；
//     - 然后 remaining = remaining - commission，把「抽成之后剩下的部分」继续交给上一级处理；
//     - 若某一级代理没有 commission_config 记录，则该级跳过（抽 0，remaining 不变），
//       直接把 remaining 原样传给再上一级。
//   本次种子数据只有一级代理链（单个总代，parent_id 为 NULL），
//   此时 remaining 从始至终等于 lossAmount，因此总代恰好拿到 lossAmount * win_loss_pct / 100，
//   已通过冒烟测试验证单级场景的正确性。多级链条下「后续层级是抽 remaining 还是抽原始
//   lossAmount 的百分比」这一业务口径待产品/风控确认，当前实现选择前者（逐级抽剩）。
//
// 金额计算全部交给 Postgres numeric 完成（SQL 里做乘除法），JS 侧不参与任何浮点运算。

/**
 * @param {import('pg').PoolClient} client - 必须是事务内的 client
 * @param {{playerId:number|string, agentId:number|string, roundId:number|string, lossAmount:string}} params
 */
export async function distributeLoss(client, { playerId, agentId, roundId, lossAmount }) {
  let currentAgentId = agentId;
  let remaining = lossAmount; // 字符串，交给下一次 SQL numeric 运算

  while (currentAgentId) {
    const agentResult = await client.query(
      'SELECT id, parent_id FROM agents WHERE id = $1',
      [currentAgentId]
    );
    if (agentResult.rowCount === 0) {
      // 代理不存在（数据异常），停止上溯
      break;
    }
    const agent = agentResult.rows[0];

    const configResult = await client.query(
      'SELECT win_loss_pct FROM commission_config WHERE agent_id = $1',
      [currentAgentId]
    );

    if (configResult.rowCount > 0 && configResult.rows[0].win_loss_pct !== null) {
      const pct = configResult.rows[0].win_loss_pct;
      // 由 Postgres numeric 一次性算出「本级抽成金额」与「抽成后剩余金额」，
      // 避免 JS 侧对金额做任何加减乘除。
      const calcResult = await client.query(
        `SELECT
            trunc($1::numeric * $2::numeric / 100, 2) AS commission,
            $1::numeric - trunc($1::numeric * $2::numeric / 100, 2) AS remainder`,
        [remaining, pct]
      );
      const commissionAmount = calcResult.rows[0].commission;
      const remainderAmount = calcResult.rows[0].remainder;

      await client.query(
        `INSERT INTO commissions (agent_id, player_id, round_id, type, amount)
         VALUES ($1, $2, $3, 'win_loss', $4::numeric)`,
        [currentAgentId, playerId, roundId, commissionAmount]
      );

      remaining = remainderAmount;
    }
    // 没有 commission_config 记录的级别跳过（抽 0），remaining 原样传给上一级

    currentAgentId = agent.parent_id;
  }
}
