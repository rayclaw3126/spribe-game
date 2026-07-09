// 一局游戏协议接口：下注 / 结算 / 查询
// 说明：本文件只负责协议层面的下注-结算流程，真正的开奖算法（Provably Fair 等）
// 属于 Phase 2 的游戏引擎范畴，这里 settle 接口的 outcome/payout 先由调用方传入。
// 所有资金变动只通过 lib/wallet.js 的 debit/credit，所有佣金只通过 lib/commission.js
// 的 distributeLoss，本文件不直接 UPDATE wallets 或 INSERT commissions。
import { Router } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from '../db.js';
import { debit, credit } from '../lib/wallet.js';
import { assertBetWithinLimits, assertPayoutCap, potentialPayout, assertExposureWithinLimit, maxPayoutFor } from '../lib/risk.js';
import { ensureActiveSeed, claimNonce } from '../lib/seeds.js';
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
import {
  deriveMult,
  judge as judgeLimbo,
  hashSeed as hashSeedLimbo,
  newServerSeed as newServerSeedLimbo,
  newClientSeed as newClientSeedLimbo,
  MAX_MULT as LIMBO_MAX_MULT,
  TARGET_MIN as LIMBO_TARGET_MIN,
} from '../game/limbo.js';
import {
  judge as judgeHiLo,
  deriveCard,
  stepMult,
  hashSeed as hashSeedHiLo,
  newServerSeed as newServerSeedHiLo,
  newClientSeed as newClientSeedHiLo,
  SKIPS_PER_ROUND,
} from '../game/hilo.js';
import { drawKeno, kenoPayout } from '../game/keno.js';

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

    // 风控前置：注额超限直接拒。game 由客户端传，未知串在 risk.js 回落 default 限额（正确兜底）。
    assertBetWithinLimits(game, amount);

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
        // 风控封顶：settle 的 payout 是【客户端传入】的，最该防塞天价 payout。
        // game 用服务端 round 记录的 round.game，不信客户端。
        assertPayoutCap(round.game, finalPayout);

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
    // clientSeed 不再从请求体收（模型 A：用玩家 active 种子里固定的 client_seed）
    const { amount, target, direction, idempotencyKey } = req.body || {};

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

    // 风控前置：注额超限直接拒，不进事务、不算开奖
    assertBetWithinLimits('dice', amountNum.toFixed(2));

    // 1. 幂等先查：命中则直接返回旧的开奖结果，不重复扣钱
    const existing = await findDiceBetByIdempotencyKey(idempotencyKey);
    if (existing) {
      const oldResult = existing.result || {};
      return res.json({
        roll: oldResult.roll,
        win: oldResult.win,
        payout: existing.payout,
        balanceAfter: await getBalance(playerId),
        clientSeed: existing.client_seed,
        nonce: oldResult.nonce,
        serverSeedHash: existing.result_hash,
        roundId: existing.round_id,
        idempotent: true,
      });
    }

    try {
      const result = await withTransaction(async (client) => {
        // 2. 领取本玩家 active 种子的下一个 nonce（锁序铁律：player_seeds 先于 wallets，防死锁）。
        //    首次下注 lazy 建种子，同事务。serverSeed 明文只内部用于派生，绝不进响应。
        await ensureActiveSeed(client, playerId);
        const { serverSeed, clientSeed, serverSeedHash, nonce } = await claimNonce(client, playerId);

        const roll = rollDice(serverSeed, clientSeed, nonce);
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
            clientSeed,
            serverSeed,
            serverSeedHash,
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
          assertPayoutCap('dice', payout);
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

        return { roll, win, payout, balanceAfter, clientSeed, nonce, serverSeedHash, roundId };
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
            clientSeed: existingAfterConflict.client_seed,
            nonce: oldResult.nonce,
            serverSeedHash: existingAfterConflict.result_hash,
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

/** 按幂等键查询已存在的 keno 局（跨事务的普通查询，不加锁），带上开奖结果供幂等返回 */
async function findKenoBetByIdempotencyKey(idempotencyKey) {
  const result = await query(
    `SELECT b.id AS bet_id, b.round_id, b.player_id,
            r.result, r.payout, r.server_seed, r.client_seed, r.result_hash
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
      WHERE b.idempotency_key = $1 AND r.game = 'keno'`,
    [idempotencyKey]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

// ------------------------------------------------------------------
// POST /round/keno/play —— Team Keno（36 选 ≤10，摇 10）即时下注 + 服务器开奖（仅玩家）
// 说明：摇号不信前端 —— drawn 由 serverSeed（后端私密）+ clientSeed + nonce 派生，
// matches/mult/payout 后端按 PAYOUTS 表自算，前端传入的任何 matches/payout 一律忽略，
// 只信客户端传的 selected（选号）。钱走 lib/wallet.js 唯一路径，输局触发链式分成。
// ------------------------------------------------------------------
router.post('/keno/play', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { amount, selected, idempotencyKey } = req.body || {};

    const amountNum = Number(amount);

    if (!idempotencyKey) {
      return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
    }
    if (!amountNum || !(amountNum > 0)) {
      return res.status(400).json({ error: '下注金额必须大于 0' });
    }
    // 选号校验：数组、1–10 个、每个 1–36 整数、互不相同
    if (!Array.isArray(selected) || selected.length < 1 || selected.length > 10) {
      return res.status(400).json({ error: 'selected 必须是 1–10 个号码的数组' });
    }
    const normSel = selected.map(Number);
    if (normSel.some((n) => !Number.isInteger(n) || n < 1 || n > 36)) {
      return res.status(400).json({ error: 'selected 里每个号码必须是 1–36 的整数' });
    }
    if (new Set(normSel).size !== normSel.length) {
      return res.status(400).json({ error: 'selected 里号码不能重复' });
    }

    // 风控前置：注额超限直接拒，不进事务、不算开奖
    assertBetWithinLimits('keno', amountNum.toFixed(2));

    // 1. 幂等先查：命中则直接返回旧的开奖结果，不重复扣钱
    const existing = await findKenoBetByIdempotencyKey(idempotencyKey);
    if (existing) {
      const oldResult = existing.result || {};
      return res.json({
        drawn: oldResult.drawn,
        selected: oldResult.selected,
        matches: oldResult.matches,
        mult: oldResult.mult,
        payout: existing.payout,
        balanceAfter: await getBalance(playerId),
        clientSeed: existing.client_seed,
        nonce: oldResult.nonce,
        serverSeedHash: existing.result_hash,
        roundId: existing.round_id,
        idempotent: true,
      });
    }

    try {
      const result = await withTransaction(async (client) => {
        // 2. 领取本玩家 active 种子的下一个 nonce（锁序：player_seeds 先于 wallets）。
        //    serverSeed 明文只内部用于摇号派生，绝不进响应。
        await ensureActiveSeed(client, playerId);
        const { serverSeed, clientSeed, serverSeedHash, nonce } = await claimNonce(client, playerId);

        // 摇号 + 结算全由后端算，前端只提供 selected
        const drawn = drawKeno(serverSeed, clientSeed, nonce);
        const { matches, mult } = kenoPayout(normSel, drawn);
        const win = mult > 0;

        const amountStr = amountNum.toFixed(2);
        let payout = '0.00';
        if (win) {
          // 钳制型封顶：赢额 = min(bet×mult, maxPayout)。原子局中奖不可作废，超顶只 cap 到上限，
          // 不用 assertPayoutCap（那是「拒绝」型，会把中奖局整个 rollback，对 keno 是错的）。
          const payoutResult = await client.query(
            'SELECT LEAST(trunc($1::numeric * $2::numeric, 2), $3::numeric) AS payout',
            [amountStr, String(mult), String(maxPayoutFor('keno'))]
          );
          payout = payoutResult.rows[0].payout;
        }

        // 3. 建 round（settled——Keno 是即时游戏，下注即结算）
        const roundResult = await client.query(
          `INSERT INTO rounds (game, player_id, bet_amount, client_seed, server_seed, result_hash, payout, status, result)
           VALUES ('keno', $1, $2::numeric, $3, $4, $5, $6::numeric, 'settled', $7::jsonb)
           RETURNING id`,
          [
            playerId,
            amountStr,
            clientSeed,
            serverSeed,
            serverSeedHash,
            payout,
            JSON.stringify({ drawn, selected: normSel, matches, mult, nonce }),
          ]
        );
        const roundId = roundResult.rows[0].id;

        // 4. 扣钱（资金唯一出入口）
        const { balanceAfter: balanceAfterDebit } = await debit(client, {
          playerId,
          amount: amountStr,
          type: 'keno_bet',
          idempotencyKey,
          roundId,
        });

        let balanceAfter = balanceAfterDebit;
        if (win) {
          // 5a. 赢：派彩加钱（payout 已在上面钳制到 maxPayout，此处直接入账）
          const creditResult = await credit(client, {
            playerId,
            amount: payout,
            type: 'keno_payout',
            idempotencyKey: `keno-payout-${roundId}`,
            roundId,
          });
          balanceAfter = creditResult.balanceAfter;
        } else {
          // 5b. 输：本局下注金额进入链式分成（佣金唯一入口）
          const playerResult = await client.query('SELECT agent_id FROM players WHERE id = $1', [playerId]);
          const agentId = playerResult.rows[0]?.agent_id;
          if (agentId) {
            await distributeLoss(client, { playerId, agentId, roundId, lossAmount: amountStr });
          }
        }

        // 6. 建 bet
        await client.query(
          `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome)
           VALUES ($1, $2, $3::numeric, $4, $5)`,
          [roundId, playerId, amountStr, idempotencyKey, win ? 'win' : 'lose']
        );

        return { drawn, selected: normSel, matches, mult, win, payout, balanceAfter, clientSeed, nonce, serverSeedHash, roundId };
      });

      return res.json({ ...result, idempotent: false });
    } catch (err) {
      if (err.code === '23505') {
        const existingAfterConflict = await findKenoBetByIdempotencyKey(idempotencyKey);
        if (existingAfterConflict) {
          const oldResult = existingAfterConflict.result || {};
          return res.json({
            drawn: oldResult.drawn,
            selected: oldResult.selected,
            matches: oldResult.matches,
            mult: oldResult.mult,
            payout: existingAfterConflict.payout,
            balanceAfter: await getBalance(playerId),
            clientSeed: existingAfterConflict.client_seed,
            nonce: oldResult.nonce,
            serverSeedHash: existingAfterConflict.result_hash,
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
    // clientSeed 不再从请求体收（模型 A：用玩家 active 种子里固定的 client_seed）
    const { amount, risk, rows, idempotencyKey } = req.body || {};

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

    // 风控前置：注额超限直接拒，不进事务、不算开奖
    assertBetWithinLimits('plinko', amountNum.toFixed(2));

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
        clientSeed: existing.client_seed,
        nonce: oldResult.nonce,
        serverSeedHash: existing.result_hash,
        roundId: existing.round_id,
        idempotent: true,
      });
    }

    try {
      const result = await withTransaction(async (client) => {
        // 2. 领取本玩家 active 种子的下一个 nonce（锁序铁律：player_seeds 先于 wallets，防死锁）。
        //    首次下注 lazy 建种子，同事务。serverSeed 明文只内部用于派生，绝不进响应。
        await ensureActiveSeed(client, playerId);
        const { serverSeed, clientSeed, serverSeedHash, nonce } = await claimNonce(client, playerId);

        const path = derivePath(serverSeed, clientSeed, nonce, rowsNum);
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
            clientSeed,
            serverSeed,
            serverSeedHash,
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
          assertPayoutCap('plinko', payout);
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

        return { path, bucket, mult, payout, balanceAfter, clientSeed, nonce, serverSeedHash, roundId };
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
            clientSeed: existingAfterConflict.client_seed,
            nonce: oldResult.nonce,
            serverSeedHash: existingAfterConflict.result_hash,
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

/** 按幂等键查询已存在的 limbo 局（跨事务的普通查询，不加锁），带上开奖结果供幂等返回 */
async function findLimboBetByIdempotencyKey(idempotencyKey) {
  const result = await query(
    `SELECT b.id AS bet_id, b.round_id, b.player_id,
            r.result, r.payout, r.server_seed, r.client_seed, r.result_hash
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
      WHERE b.idempotency_key = $1 AND r.game = 'limbo'`,
    [idempotencyKey]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

// ------------------------------------------------------------------
// POST /round/limbo/play —— Limbo（Odds Climb）即时下注 + 服务器开奖（仅玩家）
// 说明：开奖不信前端 —— finalMult 由 serverSeed（后端私密）+ clientSeed + nonce
// 派生，公式逐位照抄前端 Limbo.jsx line 171 真实代码 HOUSE_EDGE/r（旧注释
// `/(1-r)` 过时且错误，不采用）。payout = amount × target（不是 × finalMult），
// 前端传入的任何 finalMult/payout 一律忽略。
// 钱走 lib/wallet.js 唯一路径，输局（finalMult < target）触发 lib/commission.js
// 链式分成，lossAmount = amount 全额。
// ------------------------------------------------------------------
router.post('/limbo/play', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    // clientSeed 不再从请求体收（模型 A：用玩家 active 种子里固定的 client_seed）
    const { amount, target, idempotencyKey } = req.body || {};

    const amountNum = Number(amount);
    const targetNum = Number(target);

    if (!idempotencyKey) {
      return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
    }
    if (!amountNum || !(amountNum > 0)) {
      return res.status(400).json({ error: '下注金额必须大于 0' });
    }
    if (!(targetNum >= LIMBO_TARGET_MIN && targetNum <= LIMBO_MAX_MULT)) {
      return res.status(400).json({ error: `target 必须在 ${LIMBO_TARGET_MIN}–${LIMBO_MAX_MULT} 之间` });
    }

    // 风控前置：注额超限直接拒，不进事务、不算开奖
    assertBetWithinLimits('limbo', amountNum.toFixed(2));

    // 1. 幂等先查：命中则直接返回旧的开奖结果，不重复扣钱
    const existing = await findLimboBetByIdempotencyKey(idempotencyKey);
    if (existing) {
      const oldResult = existing.result || {};
      return res.json({
        finalMult: oldResult.finalMult,
        win: oldResult.win,
        payout: existing.payout,
        balanceAfter: await getBalance(playerId),
        clientSeed: existing.client_seed,
        nonce: oldResult.nonce,
        serverSeedHash: existing.result_hash,
        roundId: existing.round_id,
        idempotent: true,
      });
    }

    try {
      const result = await withTransaction(async (client) => {
        // 2. 领取本玩家 active 种子的下一个 nonce（锁序铁律：player_seeds 先于 wallets，防死锁）。
        //    首次下注 lazy 建种子，同事务。serverSeed 明文只内部用于派生，绝不进响应。
        await ensureActiveSeed(client, playerId);
        const { serverSeed, clientSeed, serverSeedHash, nonce } = await claimNonce(client, playerId);

        const finalMult = deriveMult(serverSeed, clientSeed, nonce);
        const win = judgeLimbo(finalMult, targetNum);

        const amountStr = amountNum.toFixed(2);
        // payout = amount × target（不是 × finalMult），SQL numeric 计算、禁 JS 浮点
        let payout = '0.00';
        if (win) {
          const payoutResult = await client.query(
            'SELECT trunc($1::numeric * $2::numeric, 2) AS payout',
            [amountStr, targetNum]
          );
          payout = payoutResult.rows[0].payout;
        }

        // 3. 建 round（含开奖结果，settled 状态——Limbo 是即时游戏，下注即结算）
        const roundResult = await client.query(
          `INSERT INTO rounds (game, player_id, bet_amount, client_seed, server_seed, result_hash, payout, status, result)
           VALUES ('limbo', $1, $2::numeric, $3, $4, $5, $6::numeric, 'settled', $7::jsonb)
           RETURNING id`,
          [
            playerId,
            amountStr,
            clientSeed,
            serverSeed,
            serverSeedHash,
            payout,
            JSON.stringify({ finalMult, target: targetNum, win, nonce }),
          ]
        );
        const roundId = roundResult.rows[0].id;

        // 4. 扣钱（资金唯一出入口）
        const { balanceAfter: balanceAfterDebit } = await debit(client, {
          playerId,
          amount: amountStr,
          type: 'limbo_bet',
          idempotencyKey,
          roundId,
        });

        let balanceAfter = balanceAfterDebit;
        if (win) {
          // 5a. 赢：派彩加钱（资金唯一出入口）
          assertPayoutCap('limbo', payout);
          const creditResult = await credit(client, {
            playerId,
            amount: payout,
            type: 'limbo_payout',
            idempotencyKey: `limbo-payout-${roundId}`,
            roundId,
          });
          balanceAfter = creditResult.balanceAfter;
        } else {
          // 5b. 输：本局下注金额全额进入链式分成（佣金唯一入口）
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

        return { finalMult, win, payout, balanceAfter, clientSeed, nonce, serverSeedHash, roundId };
      });

      return res.json({ ...result, idempotent: false });
    } catch (err) {
      // 唯一索引兜底：并发下第二次请求会撞上 bets 的幂等键唯一索引冲突（23505），
      // 事务已被 withTransaction 自动 ROLLBACK，这里回查已提交的旧记录，视为幂等命中
      if (err.code === '23505') {
        const existingAfterConflict = await findLimboBetByIdempotencyKey(idempotencyKey);
        if (existingAfterConflict) {
          const oldResult = existingAfterConflict.result || {};
          return res.json({
            finalMult: oldResult.finalMult,
            win: oldResult.win,
            payout: existingAfterConflict.payout,
            balanceAfter: await getBalance(playerId),
            clientSeed: existingAfterConflict.client_seed,
            nonce: oldResult.nonce,
            serverSeedHash: existingAfterConflict.result_hash,
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
/**
 * 查该玩家当前所有未结算多步局（mines/hilo status='playing'）的潜在赔付总额 + 局数。
 * FOR UPDATE 锁住这些行，防并发 start 各自读到旧快照绕过敞口上限。
 * 锁序：调用方在 claimNonce(player_seeds) 之后、debit(wallets) 之前调用 →
 *       全局固定 player_seeds → rounds → wallets，wallets 永远最后，无环、不死锁。
 * @returns {Promise<{ total:number, count:number }>}
 */
async function computeOpenExposure(client, playerId) {
  const res = await client.query(
    `SELECT bet_amount, game, result FROM rounds
      WHERE player_id = $1 AND game IN ('mines','hilo') AND status = 'playing'
      FOR UPDATE`,
    [playerId]
  );
  let total = 0;
  for (const r of res.rows) {
    const mineCount = r.game === 'mines' ? r.result?.mineCount : undefined;
    total += potentialPayout(r.game, r.bet_amount, mineCount);
  }
  return { total, count: res.rowCount };
}

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
    // clientSeed 不再从请求体收（模型 A：用玩家 active 种子里固定的 client_seed）
    const { amount, mines, idempotencyKey } = req.body || {};

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

    // 风控前置：注额超限直接拒，不进事务、不布雷
    assertBetWithinLimits('mines', amountNum.toFixed(2));

    // 1. 幂等先查：命中则直接返回旧局，不重复扣钱
    const existing = await findMinesBetByIdempotencyKey(idempotencyKey);
    if (existing) {
      return res.json({
        roundId: existing.round_id,
        serverSeedHash: existing.result_hash,
        clientSeed: existing.client_seed,
        nonce: existing.result?.nonce,
        balanceAfter: await getBalance(playerId),
        idempotent: true,
      });
    }

    try {
      const result = await withTransaction(async (client) => {
        // 2. 领取本玩家 active 种子的下一个 nonce（锁序铁律：player_seeds 先于 wallets，防死锁）。
        //    首次下注 lazy 建种子，同事务。serverSeed 明文只内部用于布雷，绝不进响应。
        //    minePositions 只落库，绝不放进本次响应。
        await ensureActiveSeed(client, playerId);
        const { serverSeed, clientSeed, serverSeedHash, nonce } = await claimNonce(client, playerId);
        const minePositions = deriveMines(serverSeed, clientSeed, nonce, minesNum);

        const amountStr = amountNum.toFixed(2);

        // 敞口闸（在 debit 之前，超敞口不扣钱不开局）：锁序 player_seeds→rounds→wallets。
        const { total: openTotal, count: openCount } = await computeOpenExposure(client, playerId);
        assertExposureWithinLimit('mines', openTotal, openCount, potentialPayout('mines', amountStr, minesNum));

        // 3. 建 round：有状态会话，status='playing'，result 里存雷位置/已揭格/雷数/nonce
        const roundResult = await client.query(
          `INSERT INTO rounds (game, player_id, bet_amount, client_seed, server_seed, result_hash, payout, status, result)
           VALUES ('mines', $1, $2::numeric, $3, $4, $5, NULL, 'playing', $6::jsonb)
           RETURNING id`,
          [
            playerId,
            amountStr,
            clientSeed,
            serverSeed,
            serverSeedHash,
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

        // 6. 绝不返回 minePositions / serverSeed 明文；只给 hash + nonce + clientSeed
        return { roundId, serverSeedHash, clientSeed, nonce, balanceAfter };
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
            serverSeedHash: existingAfterConflict.result_hash,
            clientSeed: existingAfterConflict.client_seed,
            nonce: existingAfterConflict.result?.nonce,
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
            serverSeedHash: round.result_hash,
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
          serverSeedHash: round.result_hash,
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
          serverSeedHash: round.result_hash,
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

        // 风控封顶：揭满自动结算这条 credit 同样不得超上限（否则大注揭满是绕过 cap 的后门）
        assertPayoutCap('mines', payout);

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
          serverSeedHash: round.result_hash,
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
          serverSeedHash: round.result_hash,
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

      // 风控封顶：多步滚倍后派彩不得超上限（credit 之前拦，防超封顶提现）
      assertPayoutCap('mines', payout);

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
        serverSeedHash: round.result_hash,
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

/** 按幂等键查询已存在的 hilo 局（跨事务的普通查询，不加锁），只用于 start 的幂等返回 */
async function findHiloBetByIdempotencyKey(idempotencyKey) {
  const result = await query(
    `SELECT b.id AS bet_id, b.round_id, b.player_id,
            r.result, r.result_hash, r.client_seed, r.status
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
      WHERE b.idempotency_key = $1 AND r.game = 'hilo'`,
    [idempotencyKey]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

/** 按 roundId 取一局 hilo，行锁 FOR UPDATE，并校验所属玩家 */
async function lockHiloRound(client, roundId, playerId) {
  const result = await client.query('SELECT * FROM rounds WHERE id = $1 FOR UPDATE', [roundId]);
  if (result.rowCount === 0) {
    throw httpError(404, '该局不存在');
  }
  const round = result.rows[0];
  if (round.game !== 'hilo') {
    throw httpError(400, '该局不是 hilo 游戏');
  }
  if (String(round.player_id) !== String(playerId)) {
    throw httpError(403, '无权访问该局');
  }
  return round;
}

// ------------------------------------------------------------------
// POST /round/hilo/start —— Rating Hi-Lo（评分高低）开局：服务器发第一张明牌 + 建有状态会话
// 说明：牌序不信前端 —— 每一步的牌都由 serverSeed（后端私密）+ clientSeed + nonce
// + step 确定性派生（见 game/hilo.js deriveCard），reveal 前绝不返回给前端。之后的
// guess/skip/cashout 都要对同一个 roundId 行锁（FOR UPDATE）操作，防并发/重复。
// ------------------------------------------------------------------
router.post('/hilo/start', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    // clientSeed 不再从请求体收（模型 A：用玩家 active 种子里固定的 client_seed）
    const { amount, idempotencyKey } = req.body || {};

    const amountNum = Number(amount);

    if (!idempotencyKey) {
      return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
    }
    if (!amountNum || !(amountNum > 0)) {
      return res.status(400).json({ error: '下注金额必须大于 0' });
    }

    // 风控前置：注额超限直接拒，不进事务、不发牌
    assertBetWithinLimits('hilo', amountNum.toFixed(2));

    // 1. 幂等先查：命中则直接返回旧局，不重复扣钱
    const existing = await findHiloBetByIdempotencyKey(idempotencyKey);
    if (existing) {
      return res.json({
        roundId: existing.round_id,
        card: existing.result?.card,
        serverSeedHash: existing.result_hash,
        clientSeed: existing.client_seed,
        nonce: existing.result?.nonce,
        balanceAfter: await getBalance(playerId),
        idempotent: true,
      });
    }

    try {
      const result = await withTransaction(async (client) => {
        // 2. 领取本玩家 active 种子的下一个 nonce（锁序铁律：player_seeds 先于 wallets，防死锁）。
        //    首次下注 lazy 建种子，同事务。serverSeed 明文只内部用于派生，绝不进响应；
        //    后续牌只落库，绝不放进本次响应。
        await ensureActiveSeed(client, playerId);
        const { serverSeed, clientSeed, serverSeedHash, nonce } = await claimNonce(client, playerId);
        const firstCard = deriveCard(serverSeed, clientSeed, nonce, 0);

        const amountStr = amountNum.toFixed(2);

        // 敞口闸（在 debit 之前，超敞口不扣钱不开局）：锁序 player_seeds→rounds→wallets。
        const { total: openTotal, count: openCount } = await computeOpenExposure(client, playerId);
        assertExposureWithinLimit('hilo', openTotal, openCount, potentialPayout('hilo', amountStr));

        // 3. 建 round：有状态会话，status='playing'，result 里存 step/明牌/累乘/skip 次数/历史/nonce
        const roundResult = await client.query(
          `INSERT INTO rounds (game, player_id, bet_amount, client_seed, server_seed, result_hash, payout, status, result)
           VALUES ('hilo', $1, $2::numeric, $3, $4, $5, NULL, 'playing', $6::jsonb)
           RETURNING id`,
          [
            playerId,
            amountStr,
            clientSeed,
            serverSeed,
            serverSeedHash,
            JSON.stringify({
              step: 0,
              card: firstCard,
              cum: 1,
              skips: SKIPS_PER_ROUND,
              history: [],
              nonce,
              status: 'playing',
            }),
          ]
        );
        const roundId = roundResult.rows[0].id;

        // 4. 扣钱（资金唯一出入口）
        const { balanceAfter } = await debit(client, {
          playerId,
          amount: amountStr,
          type: 'hilo_bet',
          idempotencyKey,
          roundId,
        });

        // 5. 建 bet（本局尚未结算，outcome 先记 pending）
        await client.query(
          `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome)
           VALUES ($1, $2, $3::numeric, $4, 'pending')`,
          [roundId, playerId, amountStr, idempotencyKey]
        );

        // 6. 绝不返回 serverSeed 明文 / 后续牌；只给 hash + nonce + clientSeed + 首张明牌
        return { roundId, card: firstCard, serverSeedHash, clientSeed, nonce, balanceAfter };
      });

      return res.json({ ...result, idempotent: false });
    } catch (err) {
      // 唯一索引兜底：并发下第二次请求会撞上 bets 的幂等键唯一索引冲突（23505），
      // 事务已被 withTransaction 自动 ROLLBACK，这里回查已提交的旧记录，视为幂等命中
      if (err.code === '23505') {
        const existingAfterConflict = await findHiloBetByIdempotencyKey(idempotencyKey);
        if (existingAfterConflict) {
          return res.json({
            roundId: existingAfterConflict.round_id,
            card: existingAfterConflict.result?.card,
            serverSeedHash: existingAfterConflict.result_hash,
            clientSeed: existingAfterConflict.client_seed,
            nonce: existingAfterConflict.result?.nonce,
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
// POST /round/hilo/guess —— 猜下一张「高/同 或 低/同」：判定不信前端，服务器用
// deriveCard 派生下一张牌、judge 判定（等于两方向都算赢）。猜对累乘继续（全精度，
// 不提前 round），猜错（bust）终局、全额下注进入链式分成、此刻才 reveal serverSeed。
// ------------------------------------------------------------------
router.post('/hilo/guess', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { roundId, dir } = req.body || {};

    if (!roundId) {
      return res.status(400).json({ error: '参数不完整：roundId 必填' });
    }
    if (!['high', 'low'].includes(dir)) {
      return res.status(400).json({ error: 'dir 必须是 high 或 low' });
    }

    const result = await withTransaction(async (client) => {
      const round = await lockHiloRound(client, roundId, playerId);
      const r = round.result || {};

      // 已终局：bust 幂等返回当前终局状态（不重复分成），cashed 拒绝
      if (round.status !== 'playing') {
        if (round.status === 'bust') {
          return {
            card: r.card,
            correct: false,
            serverSeedHash: round.result_hash,
            clientSeed: round.client_seed,
            nonce: r.nonce,
            roundId: round.id,
            alreadyDone: true,
          };
        }
        throw httpError(400, '该局已兑现结束，无法猜测');
      }

      const nextStep = r.step + 1;
      // 牌序不信前端：下一张牌由 serverSeed + clientSeed + nonce + step 确定性派生
      const next = deriveCard(round.server_seed, round.client_seed, r.nonce, nextStep);
      const correct = judgeHiLo(dir, r.card, next);

      if (correct) {
        // 对：累乘（JS 全精度，别提前 round），落地继续，不 reveal seed
        const mult = stepMult(dir, r.card);
        const newCum = r.cum * mult;
        const newResult = {
          ...r,
          step: nextStep,
          card: next,
          cum: newCum,
          history: [...(r.history || []), { n: next, dir, correct: true }],
          status: 'playing',
        };
        await client.query(`UPDATE rounds SET result = $2::jsonb WHERE id = $1`, [round.id, JSON.stringify(newResult)]);

        return { card: next, correct: true, cum: newCum, stepMult: mult, dir };
      }

      // 错（bust）：终局输，全额下注进入链式分成，此刻才 reveal seed
      const newResult = {
        ...r,
        step: nextStep,
        card: next,
        history: [...(r.history || []), { n: next, dir, correct: false }],
        bustAt: next,
        status: 'bust',
      };
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
        card: next,
        correct: false,
        serverSeedHash: round.result_hash,
        clientSeed: round.client_seed,
        nonce: r.nonce,
        roundId: round.id,
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
// POST /round/hilo/skip —— 换一张明牌：从同一牌序取下一张（step 前进），不结算、
// 累乘不变，限 SKIPS_PER_ROUND 次；不 reveal serverSeed/后续牌。
// ------------------------------------------------------------------
router.post('/hilo/skip', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { roundId } = req.body || {};

    if (!roundId) {
      return res.status(400).json({ error: '参数不完整：roundId 必填' });
    }

    const result = await withTransaction(async (client) => {
      const round = await lockHiloRound(client, roundId, playerId);
      const r = round.result || {};

      if (round.status !== 'playing') {
        throw httpError(400, '该局已结束，无法 skip');
      }
      if (!(Number(r.skips) > 0)) {
        throw httpError(400, 'skip 次数已用完');
      }

      const nextStep = r.step + 1;
      const newCard = deriveCard(round.server_seed, round.client_seed, r.nonce, nextStep);
      const newSkips = r.skips - 1;
      const newResult = {
        ...r,
        step: nextStep,
        card: newCard,
        skips: newSkips,
        history: [...(r.history || []), { n: newCard, dir: 'skip', correct: null }],
        status: 'playing',
      };
      await client.query(`UPDATE rounds SET result = $2::jsonb WHERE id = $1`, [round.id, JSON.stringify(newResult)]);

      return { card: newCard, skipsLeft: newSkips, cum: r.cum };
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
// POST /round/hilo/cashout —— 任意步兑现：payout = round2(bet_amount × cum)，
// cum=1（没猜过就兑现）时 payout=bet，等同退注，允许。
// ------------------------------------------------------------------
router.post('/hilo/cashout', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { roundId } = req.body || {};

    if (!roundId) {
      return res.status(400).json({ error: '参数不完整：roundId 必填' });
    }

    const result = await withTransaction(async (client) => {
      const round = await lockHiloRound(client, roundId, playerId);
      const r = round.result || {};

      if (round.status === 'bust') {
        throw httpError(400, '该局已猜错结束，无法兑现');
      }

      if (round.status === 'cashed') {
        // 已兑现过：幂等返回旧结果，不重复加钱
        return {
          payout: round.payout,
          balanceAfter: await getBalance(playerId),
          cum: r.cum,
          serverSeedHash: round.result_hash,
          clientSeed: round.client_seed,
          nonce: r.nonce,
          roundId: round.id,
          alreadyDone: true,
        };
      }

      // status === 'playing'：正常兑现，SQL numeric 做乘法+round，禁 JS 浮点做金额计算
      const payoutResult = await client.query(
        'SELECT round($1::numeric * $2::numeric, 2) AS payout',
        [round.bet_amount, r.cum]
      );
      const payout = payoutResult.rows[0].payout;

      // 风控封顶：多步滚倍后派彩不得超上限（credit 之前拦，防超封顶提现）
      assertPayoutCap('hilo', payout);

      const { balanceAfter } = await credit(client, {
        playerId,
        amount: payout,
        type: 'hilo_payout',
        idempotencyKey: `hilo-cash-${round.id}`,
        roundId: round.id,
      });

      const newResult = { ...r, status: 'cashed' };
      await client.query(
        `UPDATE rounds SET status = 'cashed', payout = $2::numeric, result = $3::jsonb WHERE id = $1`,
        [round.id, payout, JSON.stringify(newResult)]
      );
      await client.query(`UPDATE bets SET outcome = 'win' WHERE round_id = $1`, [round.id]);

      return {
        payout,
        balanceAfter,
        cum: r.cum,
        serverSeedHash: round.result_hash,
        clientSeed: round.client_seed,
        nonce: r.nonce,
        roundId: round.id,
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

// 局进行中时对外可见的 result 字段【白名单】（防提款机漏洞）：
// 非终局绝不返回任何能推出未开区域的字段，只给"已发生/当前态"。漏一个即是洞，故用白名单不用黑名单。
const PLAYING_RESULT_WHITELIST = {
  // mines：只给已揭格 / 雷数（玩家自选，公开）/ nonce；【剥掉】mines 雷位数组、bustCell 等
  mines: ['revealed', 'mineCount', 'nonce'],
  // hilo：当前明牌 + 已猜历史 + 累乘 / 步数 / 剩余 skip / nonce（后续牌按需 deriveCard 派生，不落库、不可推）
  hilo: ['step', 'card', 'cum', 'skips', 'history', 'nonce', 'status'],
};
const TERMINAL_STATUSES = new Set(['settled', 'cashed', 'bust']);

// 终局（settled/cashed/bust）给全 result（此刻雷位/牌序公开无所谓，正好供验证）；
// 非终局（playing/pending）按游戏白名单只挑安全字段，未知游戏一律不给 result 细节。
function safeResultForView(game, status, result) {
  if (!result) return result;
  if (TERMINAL_STATUSES.has(status)) return result;
  const allow = PLAYING_RESULT_WHITELIST[game];
  if (!allow) return null;
  const out = {};
  for (const k of allow) if (k in result) out[k] = result[k];
  return out;
}

// ------------------------------------------------------------------
// GET /round/:id —— 查询单局详情
// ------------------------------------------------------------------
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    // 模型 A：绝不吐 server_seed 明文（只给 result_hash）。明文要走 /seed/rotate 才 reveal。
    const result = await query(
      `SELECT r.id, r.game, r.player_id, r.bet_amount, r.payout, r.status, r.result,
              r.client_seed, r.result_hash, r.created_at,
              b.id AS bet_id, b.outcome AS bet_outcome, b.idempotency_key
         FROM rounds r
         LEFT JOIN bets b ON b.round_id = r.id
        WHERE r.id = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: '该局不存在' });
    }
    const row = result.rows[0];
    // 进行中的局：剥掉 result 里的未来信息（如 mines 雷位），防玩家读活局作弊
    row.result = safeResultForView(row.game, row.status, row.result);
    return res.json(row);
  } catch (err) {
    return next(err);
  }
});

export default router;
