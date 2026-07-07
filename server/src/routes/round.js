// 一局游戏协议接口：下注 / 结算 / 查询
// 说明：本文件只负责协议层面的下注-结算流程，真正的开奖算法（Provably Fair 等）
// 属于 Phase 2 的游戏引擎范畴，这里 settle 接口的 outcome/payout 先由调用方传入。
// 所有资金变动只通过 lib/wallet.js 的 debit/credit，所有佣金只通过 lib/commission.js
// 的 distributeLoss，本文件不直接 UPDATE wallets 或 INSERT commissions。
import { Router } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from '../db.js';
import { debit, credit } from '../lib/wallet.js';
import { distributeLoss } from '../lib/commission.js';
import { requireAuth, requireType } from '../middleware/auth.js';
import {
  rollDice,
  payoutFor,
  judge,
  chanceFor,
  hashSeed,
  newServerSeed,
  newClientSeed,
} from '../game/dice.js';
import {
  multsFor,
  derivePath,
  hashSeed as hashSeedPlinko,
  newServerSeed as newServerSeedPlinko,
  newClientSeed as newClientSeedPlinko,
  PINS_MIN,
  PINS_MAX,
} from '../game/plinko.js';
import {
  calcMultiplier,
  deriveMines,
  hashSeed as hashSeedMines,
  newServerSeed as newServerSeedMines,
  newClientSeed as newClientSeedMines,
  GRID as MINES_GRID,
  MINES_MIN,
  MINES_MAX,
} from '../game/mines.js';

const router = Router();

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/** 按幂等键查询已存在的下注记录（跨事务的普通查询，不加锁） */
async function findBetByIdempotencyKey(idempotencyKey) {
  const result = await query(
    `SELECT b.id, b.round_id, b.outcome, b.player_id
       FROM bets b
      WHERE b.idempotency_key = $1`,
    [idempotencyKey]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

/** 查玩家当前余额（普通查询，用于拼接响应，不参与资金计算逻辑） */
async function getBalance(playerId) {
  const result = await query('SELECT balance FROM wallets WHERE player_id = $1', [playerId]);
  return result.rows[0]?.balance ?? null;
}

// ------------------------------------------------------------------
// POST /round/bet —— 下注（仅玩家）
// ------------------------------------------------------------------
router.post('/bet', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { game, amount, clientSeed, idempotencyKey } = req.body || {};

    if (!game || !amount || !idempotencyKey) {
      return res.status(400).json({ error: '参数不完整：game / amount / idempotencyKey 均为必填' });
    }

    // 1. 幂等先查：命中则直接返回已有结果，不重复扣钱
    const existing = await findBetByIdempotencyKey(idempotencyKey);
    if (existing) {
      return res.json({
        roundId: existing.round_id,
        betId: existing.id,
        balance: await getBalance(playerId),
        idempotent: true,
      });
    }

    try {
      const result = await withTransaction(async (client) => {
        // 2. 扣钱（资金唯一出入口）
        const { balanceAfter } = await debit(client, {
          playerId,
          amount,
          type: 'bet',
          idempotencyKey,
          roundId: null, // 此刻 round 尚未创建
        });

        // 3. 建 round
        const roundResult = await client.query(
          `INSERT INTO rounds (game, player_id, bet_amount, client_seed, status)
           VALUES ($1, $2, $3::numeric, $4, 'pending')
           RETURNING id`,
          [game, playerId, amount, clientSeed || null]
        );
        const roundId = roundResult.rows[0].id;

        // 4. 建 bet
        const betResult = await client.query(
          `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome)
           VALUES ($1, $2, $3::numeric, $4, 'pending')
           RETURNING id`,
          [roundId, playerId, amount, idempotencyKey]
        );

        return { roundId, betId: betResult.rows[0].id, balanceAfter };
      });

      return res.json({ ...result, idempotent: false });
    } catch (err) {
      // 3. 唯一索引兜底：并发下第二次请求会撞上 ledger/bets 的唯一索引冲突（23505），
      // 事务已被 withTransaction 自动 ROLLBACK，这里回查已提交的旧记录，视为幂等命中
      if (err.code === '23505') {
        const existingAfterConflict = await findBetByIdempotencyKey(idempotencyKey);
        if (existingAfterConflict) {
          return res.json({
            roundId: existingAfterConflict.round_id,
            betId: existingAfterConflict.id,
            balance: await getBalance(playerId),
            idempotent: true,
          });
        }
      }
      throw err;
    }
  } catch (err) {
    return next(err);
  }
});

// ------------------------------------------------------------------
// POST /round/settle —— 结算（player 或内部服务调用）
// ------------------------------------------------------------------
router.post('/settle', requireAuth, async (req, res, next) => {
  try {
    const { roundId, outcome, payout } = req.body || {};

    if (!roundId || !['win', 'lose'].includes(outcome)) {
      return res.status(400).json({ error: '参数不完整：roundId 必填，outcome 必须是 win 或 lose' });
    }

    const result = await withTransaction(async (client) => {
      // 1. 锁定该局，防止并发重复结算
      const roundResult = await client.query('SELECT * FROM rounds WHERE id = $1 FOR UPDATE', [roundId]);
      if (roundResult.rowCount === 0) {
        throw httpError(404, '该局不存在');
      }
      const round = roundResult.rows[0];

      // 已结算过：幂等返回已有结果，不重复加钱/重复分成
      if (round.status !== 'pending') {
        return {
          roundId: round.id,
          outcome: round.result?.outcome ?? null,
          payout: round.payout,
          balance: await getBalance(round.player_id),
        };
      }

      let balanceAfter;
      const finalPayout = outcome === 'win' ? (payout || '0.00') : '0.00';

      if (outcome === 'win') {
        // 2a. 赢：派彩加钱（资金唯一出入口）
        const creditResult = await credit(client, {
          playerId: round.player_id,
          amount: finalPayout,
          type: 'payout',
          roundId: round.id,
        });
        balanceAfter = creditResult.balanceAfter;
      } else {
        // 2b. 输：本局下注金额进入链式分成（佣金唯一入口）
        const playerResult = await client.query('SELECT agent_id FROM players WHERE id = $1', [round.player_id]);
        const agentId = playerResult.rows[0]?.agent_id;
        if (agentId) {
          await distributeLoss(client, {
            playerId: round.player_id,
            agentId,
            roundId: round.id,
            lossAmount: round.bet_amount,
          });
        }
        const walletResult = await client.query('SELECT balance FROM wallets WHERE player_id = $1', [round.player_id]);
        balanceAfter = walletResult.rows[0].balance;
      }

      // 3. 落地结算结果
      await client.query(
        `UPDATE rounds SET status = 'settled', payout = $2::numeric, result = $3::jsonb WHERE id = $1`,
        [round.id, finalPayout, JSON.stringify({ outcome })]
      );
      await client.query(`UPDATE bets SET outcome = $2 WHERE round_id = $1`, [round.id, outcome]);

      return { roundId: round.id, outcome, payout: finalPayout, balance: balanceAfter };
    });

    return res.json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

/** 按幂等键查询已存在的 dice 局（跨事务的普通查询，不加锁），带上开奖结果供幂等返回 */
async function findDiceBetByIdempotencyKey(idempotencyKey) {
  const result = await query(
    `SELECT b.id AS bet_id, b.round_id, b.player_id,
            r.result, r.payout, r.server_seed, r.client_seed, r.result_hash
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
      WHERE b.idempotency_key = $1 AND r.game = 'dice'`,
    [idempotencyKey]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

// ------------------------------------------------------------------
// POST /round/dice/play —— Dice（总进球）即时下注 + 服务器开奖（仅玩家）
// 说明：开奖不信前端 —— roll 由 serverSeed（后端私密）+ clientSeed + nonce
// 派生，payout 由后端按 RTP 公式重新计算，前端传入的任何 payout 一律忽略。
// 钱走 lib/wallet.js 唯一路径，输局触发 lib/commission.js 链式分成。
// ------------------------------------------------------------------
router.post('/dice/play', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { amount, target, direction, clientSeed, idempotencyKey } = req.body || {};

    const amountNum = Number(amount);
    const targetNum = Number(target);

    if (!idempotencyKey) {
      return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
    }
    if (!amountNum || !(amountNum > 0)) {
      return res.status(400).json({ error: '下注金额必须大于 0' });
    }
    if (!(targetNum >= 4 && targetNum <= 96)) {
      return res.status(400).json({ error: 'target 必须在 4–96 之间' });
    }
    if (!['under', 'over'].includes(direction)) {
      return res.status(400).json({ error: 'direction 必须是 under 或 over' });
    }

    // 1. 幂等先查：命中则直接返回旧的开奖结果，不重复扣钱
    const existing = await findDiceBetByIdempotencyKey(idempotencyKey);
    if (existing) {
      const oldResult = existing.result || {};
      return res.json({
        roll: oldResult.roll,
        win: oldResult.win,
        payout: existing.payout,
        balanceAfter: await getBalance(playerId),
        serverSeed: existing.server_seed,
        clientSeed: existing.client_seed,
        nonce: oldResult.nonce,
        commitHash: existing.result_hash,
        roundId: existing.round_id,
        idempotent: true,
      });
    }

    try {
      const result = await withTransaction(async (client) => {
        // 2. 生成本局开奖种子并算出 roll/胜负/赔率/派彩（全部在扣钱之前算好，
        //    与「余额是否充足」无关，前端传入的任何 payout 一律忽略）
        const serverSeed = newServerSeed();
        const seedForRoll = clientSeed || newClientSeed();
        const nonce = crypto.randomBytes(8).toString('hex');
        const commitHash = hashSeed(serverSeed);

        const roll = rollDice(serverSeed, seedForRoll, nonce);
        const chance = chanceFor(targetNum, direction);
        const win = judge(roll, targetNum, direction);
        const mult = payoutFor(chance);

        const amountStr = amountNum.toFixed(2);
        let payout = '0.00';
        if (win) {
          const payoutResult = await client.query(
            'SELECT trunc($1::numeric * $2::numeric, 2) AS payout',
            [amountStr, mult]
          );
          payout = payoutResult.rows[0].payout;
        }

        // 3. 建 round（含开奖结果，settled 状态——Dice 是即时游戏，下注即结算）
        const roundResult = await client.query(
          `INSERT INTO rounds (game, player_id, bet_amount, client_seed, server_seed, result_hash, payout, status, result)
           VALUES ('dice', $1, $2::numeric, $3, $4, $5, $6::numeric, 'settled', $7::jsonb)
           RETURNING id`,
          [
            playerId,
            amountStr,
            seedForRoll,
            serverSeed,
            commitHash,
            payout,
            JSON.stringify({ roll, target: targetNum, direction, win, nonce }),
          ]
        );
        const roundId = roundResult.rows[0].id;

        // 4. 扣钱（资金唯一出入口）
        const { balanceAfter: balanceAfterDebit } = await debit(client, {
          playerId,
          amount: amountStr,
          type: 'dice_bet',
          idempotencyKey,
          roundId,
        });

        let balanceAfter = balanceAfterDebit;
        if (win) {
          // 5a. 赢：派彩加钱（资金唯一出入口）
          const creditResult = await credit(client, {
            playerId,
            amount: payout,
            type: 'dice_payout',
            idempotencyKey: `dice-payout-${roundId}`,
            roundId,
          });
          balanceAfter = creditResult.balanceAfter;
        } else {
          // 5b. 输：本局下注金额进入链式分成（佣金唯一入口）
          const playerResult = await client.query('SELECT agent_id FROM players WHERE id = $1', [playerId]);
          const agentId = playerResult.rows[0]?.agent_id;
          if (agentId) {
            await distributeLoss(client, {
              playerId,
              agentId,
              roundId,
              lossAmount: amountStr,
            });
          }
        }

        // 6. 建 bet
        await client.query(
          `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome)
           VALUES ($1, $2, $3::numeric, $4, $5)`,
          [roundId, playerId, amountStr, idempotencyKey, win ? 'win' : 'lose']
        );

        return { roll, win, payout, balanceAfter, serverSeed, clientSeed: seedForRoll, nonce, commitHash, roundId };
      });

      return res.json({ ...result, idempotent: false });
    } catch (err) {
      // 唯一索引兜底：并发下第二次请求会撞上 bets 的幂等键唯一索引冲突（23505），
      // 事务已被 withTransaction 自动 ROLLBACK，这里回查已提交的旧记录，视为幂等命中
      if (err.code === '23505') {
        const existingAfterConflict = await findDiceBetByIdempotencyKey(idempotencyKey);
        if (existingAfterConflict) {
          const oldResult = existingAfterConflict.result || {};
          return res.json({
            roll: oldResult.roll,
            win: oldResult.win,
            payout: existingAfterConflict.payout,
            balanceAfter: await getBalance(playerId),
            serverSeed: existingAfterConflict.server_seed,
            clientSeed: existingAfterConflict.client_seed,
            nonce: oldResult.nonce,
            commitHash: existingAfterConflict.result_hash,
            roundId: existingAfterConflict.round_id,
            idempotent: true,
          });
        }
      }
      throw err;
    }
  } catch (err) {
    return next(err);
  }
});

/** 按幂等键查询已存在的 plinko 局（跨事务的普通查询，不加锁），带上开奖结果供幂等返回 */
async function findPlinkoBetByIdempotencyKey(idempotencyKey) {
  const result = await query(
    `SELECT b.id AS bet_id, b.round_id, b.player_id,
            r.result, r.payout, r.server_seed, r.client_seed, r.result_hash
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
      WHERE b.idempotency_key = $1 AND r.game = 'plinko'`,
    [idempotencyKey]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

// ------------------------------------------------------------------
// POST /round/plinko/play —— Plinko（任意球）即时下注 + 服务器开奖（仅玩家）
// 说明：落点不信前端 —— path 由 serverSeed（后端私密）+ clientSeed + nonce
// 派生，mult/payout 由后端按 paytable 公式（逐位照抄前端 Plinko.jsx line
// 23-49）重新计算，前端传入的任何 mult/payout 一律忽略。
// 钱走 lib/wallet.js 唯一路径，净输（mult<1）触发 lib/commission.js 链式分成，
// lossAmount = amount − payout（mult≥1 不分成）。
// ------------------------------------------------------------------
router.post('/plinko/play', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { amount, risk, rows, clientSeed, idempotencyKey } = req.body || {};

    const amountNum = Number(amount);
    const rowsNum = Number(rows);

    if (!idempotencyKey) {
      return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
    }
    if (!amountNum || !(amountNum > 0)) {
      return res.status(400).json({ error: '下注金额必须大于 0' });
    }
    if (!['green', 'yellow', 'red'].includes(risk)) {
      return res.status(400).json({ error: 'risk 必须是 green / yellow / red' });
    }
    if (!Number.isInteger(rowsNum) || rowsNum < PINS_MIN || rowsNum > PINS_MAX) {
      return res.status(400).json({ error: `rows 必须在 ${PINS_MIN}–${PINS_MAX} 之间` });
    }

    // 1. 幂等先查：命中则直接返回旧的开奖结果，不重复扣钱
    const existing = await findPlinkoBetByIdempotencyKey(idempotencyKey);
    if (existing) {
      const oldResult = existing.result || {};
      return res.json({
        path: oldResult.path,
        bucket: oldResult.bucket,
        mult: oldResult.mult,
        payout: existing.payout,
        balanceAfter: await getBalance(playerId),
        serverSeed: existing.server_seed,
        clientSeed: existing.client_seed,
        nonce: oldResult.nonce,
        commitHash: existing.result_hash,
        roundId: existing.round_id,
        idempotent: true,
      });
    }

    try {
      const result = await withTransaction(async (client) => {
        // 2. 生成本局开奖种子并算出 path/bucket/赔率/派彩（全部在扣钱之前算好，
        //    与「余额是否充足」无关，前端传入的任何 mult/payout 一律忽略）
        const serverSeed = newServerSeedPlinko();
        const seedForPath = clientSeed || newClientSeedPlinko();
        const nonce = crypto.randomBytes(8).toString('hex');
        const commitHash = hashSeedPlinko(serverSeed);

        const path = derivePath(serverSeed, seedForPath, nonce, rowsNum);
        const bucket = path.reduce((a, b) => a + b, 0);
        const mult = multsFor(rowsNum, risk)[bucket];

        const amountStr = amountNum.toFixed(2);
        const payoutResult = await client.query(
          'SELECT trunc($1::numeric * $2::numeric, 2) AS payout',
          [amountStr, mult]
        );
        const payout = payoutResult.rows[0].payout;
        const win = mult >= 1;

        // 3. 建 round（含开奖结果，settled 状态——Plinko 是即时游戏，下注即结算）
        const roundResult = await client.query(
          `INSERT INTO rounds (game, player_id, bet_amount, client_seed, server_seed, result_hash, payout, status, result)
           VALUES ('plinko', $1, $2::numeric, $3, $4, $5, $6::numeric, 'settled', $7::jsonb)
           RETURNING id`,
          [
            playerId,
            amountStr,
            seedForPath,
            serverSeed,
            commitHash,
            payout,
            JSON.stringify({ path, bucket, mult, risk, rows: rowsNum, nonce }),
          ]
        );
        const roundId = roundResult.rows[0].id;

        // 4. 扣钱（资金唯一出入口）
        const { balanceAfter: balanceAfterDebit } = await debit(client, {
          playerId,
          amount: amountStr,
          type: 'plinko_bet',
          idempotencyKey,
          roundId,
        });

        let balanceAfter = balanceAfterDebit;
        const payoutCheck = await client.query('SELECT $1::numeric > 0 AS positive', [payout]);
        if (payoutCheck.rows[0].positive) {
          // 5a. 派彩加钱（资金唯一出入口）
          const creditResult = await credit(client, {
            playerId,
            amount: payout,
            type: 'plinko_payout',
            idempotencyKey: `plinko-payout-${roundId}`,
            roundId,
          });
          balanceAfter = creditResult.balanceAfter;
        }

        // 5b. 净输（mult<1，即 payout<amount）时才分成，mult≥1 不分成。
        //     lossAmount = amount − payout，用 SQL numeric 算，禁 JS 浮点。
        if (!win) {
          const lossAmountResult = await client.query(
            'SELECT $1::numeric - $2::numeric AS loss',
            [amountStr, payout]
          );
          const lossAmount = lossAmountResult.rows[0].loss;
          const playerResult = await client.query('SELECT agent_id FROM players WHERE id = $1', [playerId]);
          const agentId = playerResult.rows[0]?.agent_id;
          if (agentId) {
            await distributeLoss(client, {
              playerId,
              agentId,
              roundId,
              lossAmount,
            });
          }
        }

        // 6. 建 bet
        await client.query(
          `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome)
           VALUES ($1, $2, $3::numeric, $4, $5)`,
          [roundId, playerId, amountStr, idempotencyKey, win ? 'win' : 'lose']
        );

        return { path, bucket, mult, payout, balanceAfter, serverSeed, clientSeed: seedForPath, nonce, commitHash, roundId };
      });

      return res.json({ ...result, idempotent: false });
    } catch (err) {
      // 唯一索引兜底：并发下第二次请求会撞上 bets 的幂等键唯一索引冲突（23505），
      // 事务已被 withTransaction 自动 ROLLBACK，这里回查已提交的旧记录，视为幂等命中
      if (err.code === '23505') {
        const existingAfterConflict = await findPlinkoBetByIdempotencyKey(idempotencyKey);
        if (existingAfterConflict) {
          const oldResult = existingAfterConflict.result || {};
          return res.json({
            path: oldResult.path,
            bucket: oldResult.bucket,
            mult: oldResult.mult,
            payout: existingAfterConflict.payout,
            balanceAfter: await getBalance(playerId),
            serverSeed: existingAfterConflict.server_seed,
            clientSeed: existingAfterConflict.client_seed,
            nonce: oldResult.nonce,
            commitHash: existingAfterConflict.result_hash,
            roundId: existingAfterConflict.round_id,
            idempotent: true,
          });
        }
      }
      throw err;
    }
  } catch (err) {
    return next(err);
  }
});

/** 按幂等键查询已存在的 mines 局（跨事务的普通查询，不加锁），只用于 start 的幂等返回 */
async function findMinesBetByIdempotencyKey(idempotencyKey) {
  const result = await query(
    `SELECT b.id AS bet_id, b.round_id, b.player_id,
            r.result, r.payout, r.server_seed, r.client_seed, r.result_hash, r.status
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
      WHERE b.idempotency_key = $1 AND r.game = 'mines'`,
    [idempotencyKey]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

/** 按 roundId 取一局 mines，行锁 FOR UPDATE，并校验所属玩家 */
async function lockMinesRound(client, roundId, playerId) {
  const result = await client.query('SELECT * FROM rounds WHERE id = $1 FOR UPDATE', [roundId]);
  if (result.rowCount === 0) {
    throw httpError(404, '该局不存在');
  }
  const round = result.rows[0];
  if (round.game !== 'mines') {
    throw httpError(400, '该局不是 mines 游戏');
  }
  if (String(round.player_id) !== String(playerId)) {
    throw httpError(403, '无权访问该局');
  }
  return round;
}

// ------------------------------------------------------------------
// POST /round/mines/start —— Mines（盘带过人）开局：服务器布雷 + 建有状态会话
// 说明：布雷不信前端 —— minePositions 由 serverSeed（后端私密）+ clientSeed + nonce
// + mineCount 确定性派生，reveal 前绝不返回给前端。之后的 reveal/cashout 都要
// 对同一个 roundId 行锁（FOR UPDATE）操作，防并发/重复揭。
// ------------------------------------------------------------------
router.post('/mines/start', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { amount, mines, clientSeed, idempotencyKey } = req.body || {};

    const amountNum = Number(amount);
    const minesNum = Number(mines);

    if (!idempotencyKey) {
      return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
    }
    if (!amountNum || !(amountNum > 0)) {
      return res.status(400).json({ error: '下注金额必须大于 0' });
    }
    if (!Number.isInteger(minesNum) || minesNum < MINES_MIN || minesNum > MINES_MAX) {
      return res.status(400).json({ error: `mines 必须在 ${MINES_MIN}–${MINES_MAX} 之间` });
    }

    // 1. 幂等先查：命中则直接返回旧局，不重复扣钱
    const existing = await findMinesBetByIdempotencyKey(idempotencyKey);
    if (existing) {
      return res.json({
        roundId: existing.round_id,
        commitHash: existing.result_hash,
        balanceAfter: await getBalance(playerId),
        idempotent: true,
      });
    }

    try {
      const result = await withTransaction(async (client) => {
        // 2. 生成本局开局种子并确定性布雷（全部在扣钱之前算好，与「余额是否充足」无关，
        //    minePositions 只落库，绝不放进本次响应）
        const serverSeed = newServerSeedMines();
        const seedForMines = clientSeed || newClientSeedMines();
        const nonce = crypto.randomBytes(8).toString('hex');
        const commitHash = hashSeedMines(serverSeed);
        const minePositions = deriveMines(serverSeed, seedForMines, nonce, minesNum);

        const amountStr = amountNum.toFixed(2);

        // 3. 建 round：有状态会话，status='playing'，result 里存雷位置/已揭格/雷数/nonce
        const roundResult = await client.query(
          `INSERT INTO rounds (game, player_id, bet_amount, client_seed, server_seed, result_hash, payout, status, result)
           VALUES ('mines', $1, $2::numeric, $3, $4, $5, NULL, 'playing', $6::jsonb)
           RETURNING id`,
          [
            playerId,
            amountStr,
            seedForMines,
            serverSeed,
            commitHash,
            JSON.stringify({ mines: minePositions, revealed: [], mineCount: minesNum, nonce }),
          ]
        );
        const roundId = roundResult.rows[0].id;

        // 4. 扣钱（资金唯一出入口）
        const { balanceAfter } = await debit(client, {
          playerId,
          amount: amountStr,
          type: 'mines_bet',
          idempotencyKey,
          roundId,
        });

        // 5. 建 bet（本局尚未结算，outcome 先记 pending）
        await client.query(
          `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome)
           VALUES ($1, $2, $3::numeric, $4, 'pending')`,
          [roundId, playerId, amountStr, idempotencyKey]
        );

        // 6. 绝不返回 minePositions
        return { roundId, commitHash, balanceAfter };
      });

      return res.json({ ...result, idempotent: false });
    } catch (err) {
      // 唯一索引兜底：并发下第二次请求会撞上 bets 的幂等键唯一索引冲突（23505），
      // 事务已被 withTransaction 自动 ROLLBACK，这里回查已提交的旧记录，视为幂等命中
      if (err.code === '23505') {
        const existingAfterConflict = await findMinesBetByIdempotencyKey(idempotencyKey);
        if (existingAfterConflict) {
          return res.json({
            roundId: existingAfterConflict.round_id,
            commitHash: existingAfterConflict.result_hash,
            balanceAfter: await getBalance(playerId),
            idempotent: true,
          });
        }
      }
      throw err;
    }
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

// ------------------------------------------------------------------
// POST /round/mines/reveal —— 揭开一格：踩雷则终局分成，安全则累积倍数/可能自动结算
// 说明：每次都对该 roundId 行锁（FOR UPDATE），防并发重复揭同一格算错钱；
// 雷位置/serverSeed 只在踩雷、揭满自动结算或 cashout 时才 reveal 给前端。
// ------------------------------------------------------------------
router.post('/mines/reveal', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { roundId, cell } = req.body || {};
    const cellNum = Number(cell);

    if (!roundId) {
      return res.status(400).json({ error: '参数不完整：roundId 必填' });
    }
    if (!Number.isInteger(cellNum) || cellNum < 0 || cellNum >= MINES_GRID) {
      return res.status(400).json({ error: `cell 必须在 0–${MINES_GRID - 1} 之间` });
    }

    const result = await withTransaction(async (client) => {
      // 1. 行锁定位该局
      const round = await lockMinesRound(client, roundId, playerId);
      const r = round.result || {};
      const mineCount = r.mineCount;
      const revealed = r.revealed || [];

      // 2. 已终局（bust/cashed）：幂等返回当前终局状态，不重复处理
      if (round.status !== 'playing') {
        if (round.status === 'bust') {
          return {
            safe: false,
            mines: r.mines,
            serverSeed: round.server_seed,
            clientSeed: round.client_seed,
            nonce: r.nonce,
            roundId: round.id,
            alreadyDone: true,
          };
        }
        // cashed（含揭满自动结算）
        const gemsDone = (r.revealed || []).length;
        return {
          safe: true,
          mult: calcMultiplier(gemsDone, mineCount),
          gems: gemsDone,
          cleared: true,
          payout: round.payout,
          mines: r.mines,
          serverSeed: round.server_seed,
          alreadyDone: true,
        };
      }

      // 3. 重复揭同一格：不重复处理，直接回当前状态
      if (revealed.includes(cellNum)) {
        const gemsNow = revealed.length;
        return {
          safe: true,
          mult: calcMultiplier(gemsNow, mineCount),
          gems: gemsNow,
          alreadyRevealed: true,
        };
      }

      const isMine = r.mines.includes(cellNum);

      if (isMine) {
        // 4a. 踩雷：终局输，全额下注进入链式分成
        const newResult = { ...r, revealed: [...revealed, cellNum], bustCell: cellNum };
        await client.query(
          `UPDATE rounds SET status = 'bust', result = $2::jsonb, payout = '0.00' WHERE id = $1`,
          [round.id, JSON.stringify(newResult)]
        );
        await client.query(`UPDATE bets SET outcome = 'lose' WHERE round_id = $1`, [round.id]);

        const playerResult = await client.query('SELECT agent_id FROM players WHERE id = $1', [playerId]);
        const agentId = playerResult.rows[0]?.agent_id;
        if (agentId) {
          await distributeLoss(client, {
            playerId,
            agentId,
            roundId: round.id,
            lossAmount: round.bet_amount,
          });
        }

        return {
          safe: false,
          mines: r.mines,
          serverSeed: round.server_seed,
          clientSeed: round.client_seed,
          nonce: r.nonce,
          roundId: round.id,
        };
      }

      // 4b. 安全格
      const newRevealed = [...revealed, cellNum];
      const gems = newRevealed.length;
      const mult = calcMultiplier(gems, mineCount);
      const safeTotal = MINES_GRID - mineCount;

      if (gems >= safeTotal) {
        // 揭满全部安全格：自动结算赢
        const payoutResult = await client.query(
          'SELECT round($1::numeric * $2::numeric, 2) AS payout',
          [round.bet_amount, mult]
        );
        const payout = payoutResult.rows[0].payout;

        const { balanceAfter } = await credit(client, {
          playerId,
          amount: payout,
          type: 'mines_payout',
          idempotencyKey: `mines-cash-${round.id}`,
          roundId: round.id,
        });

        const newResult = { ...r, revealed: newRevealed };
        await client.query(
          `UPDATE rounds SET status = 'cashed', result = $2::jsonb, payout = $3::numeric WHERE id = $1`,
          [round.id, JSON.stringify(newResult), payout]
        );
        await client.query(`UPDATE bets SET outcome = 'win' WHERE round_id = $1`, [round.id]);

        return {
          safe: true,
          mult,
          gems,
          cleared: true,
          payout,
          balanceAfter,
          mines: r.mines,
          serverSeed: round.server_seed,
        };
      }

      // 未揭满：只落地 revealed，雷位置/serverSeed 不 reveal
      const newResult = { ...r, revealed: newRevealed };
      await client.query(`UPDATE rounds SET result = $2::jsonb WHERE id = $1`, [round.id, JSON.stringify(newResult)]);

      return { safe: true, mult, gems, cleared: false };
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
// POST /round/mines/cashout —— 任意步兑现：payout = bet × calcMultiplier(gems, mineCount)
// ------------------------------------------------------------------
router.post('/mines/cashout', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { roundId } = req.body || {};

    if (!roundId) {
      return res.status(400).json({ error: '参数不完整：roundId 必填' });
    }

    const result = await withTransaction(async (client) => {
      const round = await lockMinesRound(client, roundId, playerId);
      const r = round.result || {};
      const mineCount = r.mineCount;

      if (round.status === 'bust') {
        throw httpError(400, '该局已踩雷结束，无法兑现');
      }

      if (round.status === 'cashed') {
        // 已兑现过：幂等返回旧结果，不重复加钱
        const gemsDone = (r.revealed || []).length;
        return {
          payout: round.payout,
          balanceAfter: await getBalance(playerId),
          mult: calcMultiplier(gemsDone, mineCount),
          gems: gemsDone,
          mines: r.mines,
          serverSeed: round.server_seed,
          clientSeed: round.client_seed,
          nonce: r.nonce,
          alreadyDone: true,
        };
      }

      // status === 'playing'：正常兑现（gems=0 时 mult=1，payout=退回本金，允许）
      const revealed = r.revealed || [];
      const gems = revealed.length;
      const mult = calcMultiplier(gems, mineCount);

      const payoutResult = await client.query(
        'SELECT round($1::numeric * $2::numeric, 2) AS payout',
        [round.bet_amount, mult]
      );
      const payout = payoutResult.rows[0].payout;

      const { balanceAfter } = await credit(client, {
        playerId,
        amount: payout,
        type: 'mines_payout',
        idempotencyKey: `mines-cash-${round.id}`,
        roundId: round.id,
      });

      await client.query(`UPDATE rounds SET status = 'cashed', payout = $2::numeric WHERE id = $1`, [round.id, payout]);
      await client.query(`UPDATE bets SET outcome = 'win' WHERE round_id = $1`, [round.id]);

      return {
        payout,
        balanceAfter,
        mult,
        gems,
        mines: r.mines,
        serverSeed: round.server_seed,
        clientSeed: round.client_seed,
        nonce: r.nonce,
      };
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
// GET /round/:id —— 查询单局详情
// ------------------------------------------------------------------
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT r.id, r.game, r.player_id, r.bet_amount, r.payout, r.status, r.result,
              r.server_seed, r.client_seed, r.result_hash, r.created_at,
              b.id AS bet_id, b.outcome AS bet_outcome, b.idempotency_key
         FROM rounds r
         LEFT JOIN bets b ON b.round_id = r.id
        WHERE r.id = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: '该局不存在' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

export default router;
