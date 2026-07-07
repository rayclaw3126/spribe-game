// 链式分成唯一入口
// 说明：玩家本局输钱时调用 distributeLoss，是佣金写入 commissions 表的唯一路径，
// 除本文件外不允许在别处直接 INSERT INTO commissions。
//
// 算法说明——已从「算法 A 逐级抽剩」改为「算法 B 各级抽原始输额 + 末有效级减法兜底」：
//
//   【第一趟：收集整条链】
//   从玩家的直属代理（agentId）出发，沿着 agents.parent_id 逐级向上追溯，
//   直到 parent_id IS NULL 的顶级代理为止（**追溯用 parent_id，不依赖 path 字段**），
//   收集一个有序数组 chain（从直属上级到顶级），每一级 join commission_config
//   取 win_loss_pct / turnover_pct；缺 commission_config 记录或 pct 为 NULL 的，
//   记作 0（该级在对应的抽成路上占成 0）。
//
//   【第二趟 win_loss 路：算法 B，各级抽“原始 lossAmount”，末个有效级减法兜底】
//   只在 lossAmount > 0 时执行：
//     - Σwinpct = 链上所有级 win_loss_pct 之和；
//     - targetTotal = trunc(lossAmount * Σwinpct / 100, 2)（整条链应分总额；
//       当 Σwinpct = 100 时 targetTotal 恰好等于 lossAmount）；
//     - 取出所有 winPct > 0 的“有效级”，按链序（直属上级 -> 顶级）逐一计算
//       c_i = trunc(lossAmount * winPct_i / 100, 2) 并累加 acc，写入 commissions；
//     - 最后一个有效级不按上面公式算，而是取 targetTotal - acc，用于吸收
//       前面各级 trunc 造成的分位余数，保证 Σc_i = targetTotal
//       （Σwinpct=100 时精确等于 lossAmount）；
//     - winPct = 0 的级跳过、不写记录，也不参与“最后一个有效级”的判定；
//     - 若整条链没有任何有效级（Σwinpct=0），则不写任何 win_loss 记录。
//
//   【第二趟 turnover 退水路：各级独立占成，不做总额兜底】
//   仅当调用方传入 turnoverAmount 且 > 0 时执行：
//     - 每个 turnoverPct > 0 的级，独立计算 t_i = trunc(turnoverAmount * turnoverPct_i / 100, 2)，
//       写入一条 type='turnover' 的 commissions 记录；
//     - turnover 各级互不相关，**不要求总和等于 turnoverAmount**，不做末级兜底；
//     - turnoverPct 缺失/为 0 的级跳过，不写记录。
//
//   turnoverAmount 是可选参数：不传 / 为 null / 为 '0' 时完全不走 turnover 路，
//   本次改造只让本函数具备 turnover 能力，round.js 尚未接线传入 turnoverAmount，
//   现有调用（只传 lossAmount）零改仍可正常工作、只走 win_loss 路，向后兼容。
//
// 金额计算全部交给 Postgres numeric 完成（SQL 里做乘除法/累加比较），
// JS 侧不参与任何浮点运算，只做字符串/数值透传。

/**
 * 收集从 startAgentId 到顶级代理（parent_id IS NULL）的整条代理链，
 * 并 join commission_config 取每一级的 win_loss_pct / turnover_pct（缺失记 0）。
 * 顺序：数组第 0 项是 startAgentId 本身（玩家直属上级），最后一项是顶级代理。
 *
 * @param {import('pg').PoolClient} client
 * @param {number|string} startAgentId
 * @returns {Promise<Array<{agentId:number|string, winPct:string, turnoverPct:string}>>}
 */
async function collectChain(client, startAgentId) {
  const chain = [];
  let currentAgentId = startAgentId;

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
      'SELECT win_loss_pct, turnover_pct FROM commission_config WHERE agent_id = $1',
      [currentAgentId]
    );
    const config = configResult.rows[0];

    chain.push({
      agentId: currentAgentId,
      winPct: config && config.win_loss_pct !== null ? config.win_loss_pct : '0',
      turnoverPct: config && config.turnover_pct !== null ? config.turnover_pct : '0',
    });

    currentAgentId = agent.parent_id;
  }

  return chain;
}

/**
 * @param {import('pg').PoolClient} client - 必须是事务内的 client
 * @param {{playerId:number|string, agentId:number|string, roundId:number|string, lossAmount:string, turnoverAmount?:string|null}} params
 */
export async function distributeLoss(client, { playerId, agentId, roundId, lossAmount, turnoverAmount }) {
  const chain = await collectChain(client, agentId);

  // ---------------- win_loss 路：算法 B ----------------
  const lossCheck = await client.query('SELECT $1::numeric > 0 AS positive', [lossAmount]);
  if (lossCheck.rows[0].positive && chain.length > 0) {
    // Σwinpct
    let sumWinPctResult = { rows: [{ sum: '0' }] };
    for (const level of chain) {
      sumWinPctResult = await client.query(
        'SELECT $1::numeric + $2::numeric AS sum',
        [sumWinPctResult.rows[0].sum, level.winPct]
      );
    }
    const sumWinPct = sumWinPctResult.rows[0].sum;

    const targetTotalResult = await client.query(
      'SELECT trunc($1::numeric * $2::numeric / 100, 2) AS target',
      [lossAmount, sumWinPct]
    );
    const targetTotal = targetTotalResult.rows[0].target;

    // 找出有效级（winPct > 0）的下标
    const effectiveIndexes = [];
    for (let i = 0; i < chain.length; i += 1) {
      const positiveResult = await client.query('SELECT $1::numeric > 0 AS positive', [chain[i].winPct]);
      if (positiveResult.rows[0].positive) {
        effectiveIndexes.push(i);
      }
    }

    if (effectiveIndexes.length > 0) {
      const lastEffectiveIndex = effectiveIndexes[effectiveIndexes.length - 1];
      let acc = '0';

      for (const i of effectiveIndexes) {
        const level = chain[i];
        let commissionAmount;

        if (i === lastEffectiveIndex) {
          // 最后一个有效级：targetTotal - acc，吸收前面各级 trunc 造成的余数
          const lastResult = await client.query(
            'SELECT $1::numeric - $2::numeric AS commission',
            [targetTotal, acc]
          );
          commissionAmount = lastResult.rows[0].commission;
        } else {
          const calcResult = await client.query(
            'SELECT trunc($1::numeric * $2::numeric / 100, 2) AS commission',
            [lossAmount, level.winPct]
          );
          commissionAmount = calcResult.rows[0].commission;

          const accResult = await client.query(
            'SELECT $1::numeric + $2::numeric AS acc',
            [acc, commissionAmount]
          );
          acc = accResult.rows[0].acc;
        }

        await client.query(
          `INSERT INTO commissions (agent_id, player_id, round_id, type, amount)
           VALUES ($1, $2, $3, 'win_loss', $4::numeric)`,
          [level.agentId, playerId, roundId, commissionAmount]
        );
      }
    }
  }

  // ---------------- turnover 路：各级独立占成，不做兜底 ----------------
  if (turnoverAmount !== undefined && turnoverAmount !== null) {
    const turnoverCheck = await client.query('SELECT $1::numeric > 0 AS positive', [turnoverAmount]);
    if (turnoverCheck.rows[0].positive) {
      for (const level of chain) {
        const positiveResult = await client.query('SELECT $1::numeric > 0 AS positive', [level.turnoverPct]);
        if (!positiveResult.rows[0].positive) {
          continue; // turnoverPct 缺失/为 0，跳过
        }
        const calcResult = await client.query(
          'SELECT trunc($1::numeric * $2::numeric / 100, 2) AS commission',
          [turnoverAmount, level.turnoverPct]
        );
        const commissionAmount = calcResult.rows[0].commission;

        await client.query(
          `INSERT INTO commissions (agent_id, player_id, round_id, type, amount)
           VALUES ($1, $2, $3, 'turnover', $4::numeric)`,
          [level.agentId, playerId, roundId, commissionAmount]
        );
      }
    }
  }
}
