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
import { stepMult as goalStepMult, deriveBombRows, TIERS as GOAL_TIERS, COLS as GOAL_COLS } from '../game/goal.js';
import { drawStreak, streakPayout, PATTERNS as STREAK_PATTERNS } from '../game/streakRoll.js';
import { spinRoulette, rouletteWinMult, isValidBetKey } from '../game/miniRoulette.js';
import { makeSeededRng } from '../lib/seededRng.js';
import { getRoomState, findBettingRoomByRoundId } from '../ws/roundHub.js';
import * as speedGridEngine from '../game/speedGrid.js';
import * as numberUpEngine from '../game/numberUp.js';
import * as hatTrickEngine from '../game/hatTrick.js';
import * as goldenBootEngine from '../game/goldenBoot.js';
import * as halfTimeEngine from '../game/halfTime.js';
import * as wuXingEngine from '../game/wuXing.js';
import * as lineUpEngine from '../game/lineUp.js';
import * as derbyDayEngine from '../game/derbyDay.js';
import * as dominoDuelEngine from '../game/dominoDuel.js';
import * as rollingBallEngine from '../game/rollingBall.js';

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

/** 按幂等键查询已存在的 streak 局（跨事务的普通查询，不加锁），带上开奖结果供幂等返回 */
async function findStreakBetByIdempotencyKey(idempotencyKey) {
  const result = await query(
    `SELECT b.id AS bet_id, b.round_id, b.player_id,
            r.result, r.payout, r.server_seed, r.client_seed, r.result_hash
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
      WHERE b.idempotency_key = $1 AND r.game = 'streak'`,
    [idempotencyKey]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

// ------------------------------------------------------------------
// POST /round/streak/play —— Streak Roll（连胜转盘）即时下注 + 服务器开奖（仅玩家）
// 说明：落格不信前端 —— landed 由 serverSeed + clientSeed + nonce + risk 派生，
// mult/payout 后端按 MULTS 表自算，前端传入的任何 landed/mult/payout 一律忽略，
// 只信客户端传的 color（押注色）+ risk（风险档）。原子局，赢额超顶【钳制】不作废。
// ------------------------------------------------------------------
router.post('/streak/play', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { amount, color, risk, idempotencyKey } = req.body || {};
    const amountNum = Number(amount);

    if (!idempotencyKey) {
      return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
    }
    if (!amountNum || !(amountNum > 0)) {
      return res.status(400).json({ error: '下注金额必须大于 0' });
    }
    if (!['B', 'R', 'F'].includes(color)) {
      return res.status(400).json({ error: 'color 必须是 B / R / F' });
    }
    if (!STREAK_PATTERNS[risk]) {
      return res.status(400).json({ error: 'risk 必须是 normal / high' });
    }

    // 风控前置：注额超限直接拒
    assertBetWithinLimits('streak', amountNum.toFixed(2));

    // 1. 幂等先查
    const existing = await findStreakBetByIdempotencyKey(idempotencyKey);
    if (existing) {
      const oldResult = existing.result || {};
      return res.json({
        color: oldResult.color,
        risk: oldResult.risk,
        landed: oldResult.landed,
        idx: oldResult.idx,
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
        // 2. claimNonce（锁 player_seeds）
        await ensureActiveSeed(client, playerId);
        const { serverSeed, clientSeed, serverSeedHash, nonce } = await claimNonce(client, playerId);

        // 落格 + 结算全由后端算，前端只提供 color + risk
        const { idx, landed } = drawStreak(serverSeed, clientSeed, nonce, risk);
        const { win, mult } = streakPayout(color, risk, landed);

        const amountStr = amountNum.toFixed(2);
        let payout = '0.00';
        if (win) {
          // 钳制型 cap（原子局中奖不作废；streak 顶赔 30.40× 远低于 cap，实际零钳制）
          const payoutResult = await client.query(
            'SELECT LEAST(trunc($1::numeric * $2::numeric, 2), $3::numeric) AS payout',
            [amountStr, String(mult), String(maxPayoutFor('streak'))]
          );
          payout = payoutResult.rows[0].payout;
        }

        // 3. 建 round（settled——即时游戏，下注即结算）
        const roundResult = await client.query(
          `INSERT INTO rounds (game, player_id, bet_amount, client_seed, server_seed, result_hash, payout, status, result)
           VALUES ('streak', $1, $2::numeric, $3, $4, $5, $6::numeric, 'settled', $7::jsonb)
           RETURNING id`,
          [
            playerId,
            amountStr,
            clientSeed,
            serverSeed,
            serverSeedHash,
            payout,
            JSON.stringify({ color, risk, landed, idx, mult, nonce }),
          ]
        );
        const roundId = roundResult.rows[0].id;

        // 4. 扣钱
        const { balanceAfter: balanceAfterDebit } = await debit(client, {
          playerId,
          amount: amountStr,
          type: 'streak_bet',
          idempotencyKey,
          roundId,
        });

        let balanceAfter = balanceAfterDebit;
        if (win) {
          const creditResult = await credit(client, {
            playerId,
            amount: payout,
            type: 'streak_payout',
            idempotencyKey: `streak-payout-${roundId}`,
            roundId,
          });
          balanceAfter = creditResult.balanceAfter;
        } else {
          const playerResult = await client.query('SELECT agent_id FROM players WHERE id = $1', [playerId]);
          const agentId = playerResult.rows[0]?.agent_id;
          if (agentId) {
            await distributeLoss(client, { playerId, agentId, roundId, lossAmount: amountStr });
          }
        }

        // 5. 建 bet
        await client.query(
          `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome)
           VALUES ($1, $2, $3::numeric, $4, $5)`,
          [roundId, playerId, amountStr, idempotencyKey, win ? 'win' : 'lose']
        );

        return { color, risk, landed, idx, mult, win, payout, balanceAfter, clientSeed, nonce, serverSeedHash, roundId };
      });

      return res.json({ ...result, idempotent: false });
    } catch (err) {
      if (err.code === '23505') {
        const existingAfterConflict = await findStreakBetByIdempotencyKey(idempotencyKey);
        if (existingAfterConflict) {
          const oldResult = existingAfterConflict.result || {};
          return res.json({
            color: oldResult.color,
            risk: oldResult.risk,
            landed: oldResult.landed,
            idx: oldResult.idx,
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

/** 按幂等键查询已存在的 roulette 局（跨事务的普通查询，不加锁），供幂等返回 */
async function findRouletteBetByIdempotencyKey(idempotencyKey) {
  const result = await query(
    `SELECT b.id AS bet_id, b.round_id, b.player_id,
            r.result, r.payout, r.server_seed, r.client_seed, r.result_hash
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
      WHERE b.idempotency_key = $1 AND r.game = 'roulette'`,
    [idempotencyKey]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

// ------------------------------------------------------------------
// POST /round/roulette/play —— Mini Roulette（12 格轮盘）多注单转 + 服务器开奖（仅玩家）
// 请求体：{ bets: {key: amount, ...}, idempotencyKey }。玩家在多个 key 上各下注，转一次逐 key 结算。
// 落号 n / 每 key mult / payout 全服务端算；客户端只提供 bets 的 {key, amount}。
// ------------------------------------------------------------------
const ROULETTE_MAX_KEYS = 22; // 12 单号 + 6 外围 + 余量，防塞几百 key 撑爆
router.post('/roulette/play', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { bets, idempotencyKey } = req.body || {};

    if (!idempotencyKey) {
      return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
    }
    if (!bets || typeof bets !== 'object' || Array.isArray(bets)) {
      return res.status(400).json({ error: 'bets 必须是 {key: amount} 对象' });
    }
    const entries = Object.entries(bets);
    if (entries.length < 1) {
      return res.status(400).json({ error: 'bets 不能为空' });
    }
    if (entries.length > ROULETTE_MAX_KEYS) {
      return res.status(400).json({ error: `下注项过多（上限 ${ROULETTE_MAX_KEYS}）` });
    }
    // 逐项校验：key 合法 + amount 严格 > 0（防负注额刷钱/绕过总额上限）
    let total = 0;
    for (const [key, amt] of entries) {
      if (!isValidBetKey(key)) {
        return res.status(400).json({ error: `非法下注 key：${key}` });
      }
      const a = Number(amt);
      if (!Number.isFinite(a) || !(a > 0)) {
        return res.status(400).json({ error: `下注金额必须 > 0（key ${key}）` });
      }
      total += a;
    }
    const totalStr = total.toFixed(2);

    // 风控前置：按【服务端算出的总注额】校验（不信客户端传的任何 total）
    assertBetWithinLimits('roulette', totalStr);

    // 1. 幂等先查
    const existing = await findRouletteBetByIdempotencyKey(idempotencyKey);
    if (existing) {
      const oldResult = existing.result || {};
      return res.json({
        n: oldResult.n,
        bets: oldResult.bets,
        perKeyPayout: oldResult.perKeyPayout,
        totalPayout: existing.payout,
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
        // 2. claimNonce（锁 player_seeds）
        await ensureActiveSeed(client, playerId);
        const { serverSeed, clientSeed, serverSeedHash, nonce } = await claimNonce(client, playerId);

        // 落号 + 逐 key 结算全由后端算，前端只提供 bets
        const n = spinRoulette(serverSeed, clientSeed, nonce);
        const perKeyPayout = {};
        let rawTotalPayout = 0;
        for (const [key, amt] of entries) {
          const mult = rouletteWinMult(key, n);
          const p = mult > 0 ? Math.round(Number(amt) * mult * 100) / 100 : 0;
          if (p > 0) { perKeyPayout[key] = p; rawTotalPayout += p; }
        }
        // 钳制型 cap（原子局中奖不作废）；用 SQL numeric 定稿，避免 JS 浮点累加误差
        const capRow = await client.query(
          'SELECT LEAST(round($1::numeric, 2), $2::numeric) AS payout',
          [String(rawTotalPayout), String(maxPayoutFor('roulette'))]
        );
        const totalPayout = capRow.rows[0].payout;
        const win = Number(totalPayout) > 0;

        // 3. 建 round（settled——即时游戏，下注即结算）
        const roundResult = await client.query(
          `INSERT INTO rounds (game, player_id, bet_amount, client_seed, server_seed, result_hash, payout, status, result)
           VALUES ('roulette', $1, $2::numeric, $3, $4, $5, $6::numeric, 'settled', $7::jsonb)
           RETURNING id`,
          [
            playerId,
            totalStr,
            clientSeed,
            serverSeed,
            serverSeedHash,
            totalPayout,
            JSON.stringify({ bets: Object.fromEntries(entries.map(([k, a]) => [k, Number(a)])), n, perKeyPayout, totalPayout, nonce }),
          ]
        );
        const roundId = roundResult.rows[0].id;

        // 4. 扣钱（一次扣总注额）
        const { balanceAfter: balanceAfterDebit } = await debit(client, {
          playerId,
          amount: totalStr,
          type: 'roulette_bet',
          idempotencyKey,
          roundId,
        });

        let balanceAfter = balanceAfterDebit;
        if (win) {
          const creditResult = await credit(client, {
            playerId,
            amount: totalPayout,
            type: 'roulette_payout',
            idempotencyKey: `roulette-payout-${roundId}`,
            roundId,
          });
          balanceAfter = creditResult.balanceAfter;
        } else {
          // 全输：总注额进入链式分成
          const playerResult = await client.query('SELECT agent_id FROM players WHERE id = $1', [playerId]);
          const agentId = playerResult.rows[0]?.agent_id;
          if (agentId) {
            await distributeLoss(client, { playerId, agentId, roundId, lossAmount: totalStr });
          }
        }

        // 5. 建 bet（#S3：追记 selections + 注级三态明细 settle_detail，值全从现成 perKeyPayout 派生，不新算钱）
        const selections = Object.fromEntries(entries.map(([k, a]) => [k, Number(a)]));
        const settleDetail = entries.map(([key]) => {
          const p = perKeyPayout[key] || 0;
          return { key, outcome: p > 0 ? 'hit' : 'lose', payout: p };
        });
        await client.query(
          `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome, selections, settle_detail)
           VALUES ($1, $2, $3::numeric, $4, $5, $6::jsonb, $7::jsonb)`,
          [roundId, playerId, totalStr, idempotencyKey, win ? 'win' : 'lose', JSON.stringify(selections), JSON.stringify(settleDetail)]
        );

        return { n, bets: Object.fromEntries(entries.map(([k, a]) => [k, Number(a)])), perKeyPayout, totalPayout, balanceAfter, clientSeed, nonce, serverSeedHash, roundId };
      });

      return res.json({ ...result, idempotent: false });
    } catch (err) {
      if (err.code === '23505') {
        const existingAfterConflict = await findRouletteBetByIdempotencyKey(idempotencyKey);
        if (existingAfterConflict) {
          const oldResult = existingAfterConflict.result || {};
          return res.json({
            n: oldResult.n,
            bets: oldResult.bets,
            perKeyPayout: oldResult.perKeyPayout,
            totalPayout: existingAfterConflict.payout,
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

// ==================================================================
// 轮次开奖游戏【通用市场结算脚手架】—— 这批 10 个游戏共用。
// 每个游戏注册一个 entry：{ MARKETS, isValidMarketKey, hasPush, spin(rng) }。
// spin(rng) 用注入的 seededRng 开奖，返回 { drawResult, hits:Set<key>, pushes:Set<key> }。
// 结算三态：hit→amount×odds、push→退本金 amount、未中→输。原子局，多注 map。
// ==================================================================
const round2 = (x) => Math.round(x * 100) / 100;

const ROUND_GAME_REGISTRY = {
  speedgrid: {
    MARKETS: speedGridEngine.MARKETS,
    isValidMarketKey: speedGridEngine.isValidMarketKey,
    hasPush: speedGridEngine.HAS_PUSH,
    spin: (rng) => {
      const n = speedGridEngine.drawCar(rng);
      return { drawResult: { n }, hits: speedGridEngine.hitsOf(n), pushes: new Set() };
    },
  },
  numberup: {
    MARKETS: numberUpEngine.MARKETS,
    isValidMarketKey: numberUpEngine.isValidMarketKey,
    hasPush: numberUpEngine.HAS_PUSH,
    spin: numberUpEngine.spin,
  },
  hattrick: {
    MARKETS: hatTrickEngine.MARKETS,
    isValidMarketKey: hatTrickEngine.isValidMarketKey,
    hasPush: hatTrickEngine.HAS_PUSH,
    spin: hatTrickEngine.spin,
  },
  goldenboot: {
    MARKETS: goldenBootEngine.MARKETS,
    isValidMarketKey: goldenBootEngine.isValidMarketKey,
    hasPush: goldenBootEngine.HAS_PUSH,
    spin: goldenBootEngine.spin,
  },
  halftime: {
    MARKETS: halfTimeEngine.MARKETS,
    isValidMarketKey: halfTimeEngine.isValidMarketKey,
    hasPush: halfTimeEngine.HAS_PUSH,
    spin: halfTimeEngine.spin,
  },
  wuxing: {
    MARKETS: wuXingEngine.MARKETS,
    isValidMarketKey: wuXingEngine.isValidMarketKey,
    hasPush: wuXingEngine.HAS_PUSH,
    spin: wuXingEngine.spin,
  },
  lineup: {
    MARKETS: lineUpEngine.MARKETS,
    isValidMarketKey: lineUpEngine.isValidMarketKey,
    hasPush: lineUpEngine.HAS_PUSH,
    spin: lineUpEngine.spin,
  },
  derbyday: {
    MARKETS: derbyDayEngine.MARKETS,
    isValidMarketKey: derbyDayEngine.isValidMarketKey,
    hasPush: derbyDayEngine.HAS_PUSH,
    spin: derbyDayEngine.spin,
  },
  dominoduel: {
    MARKETS: dominoDuelEngine.MARKETS,
    isValidMarketKey: dominoDuelEngine.isValidMarketKey,
    hasPush: dominoDuelEngine.HAS_PUSH,
    spin: dominoDuelEngine.spin,
  },
};

/** 按幂等键查询已存在的某轮次游戏局（跨事务普通查询），供幂等返回 */
async function findRoundGameBet(idempotencyKey, gameName) {
  const result = await query(
    `SELECT b.id AS bet_id, b.round_id, b.player_id,
            r.result, r.payout, r.server_seed, r.client_seed, r.result_hash
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
      WHERE b.idempotency_key = $1 AND r.game = $2`,
    [idempotencyKey, gameName]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

/**
 * 造一个轮次开奖游戏的 handler（参数化引擎）。请求 { bets:{marketKey:amount}, idempotencyKey }。
 * @param {string} gameName - 注册表键（= DB rounds.game = 风控 config key）
 */
function makeRoundGameHandler(gameName) {
  const entry = ROUND_GAME_REGISTRY[gameName];
  const marketCount = Object.keys(entry.MARKETS).length;
  return async (req, res, next) => {
    try {
      const playerId = req.user.sub;
      const { bets, idempotencyKey } = req.body || {};

      if (!idempotencyKey) {
        return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
      }
      if (!bets || typeof bets !== 'object' || Array.isArray(bets)) {
        return res.status(400).json({ error: 'bets 必须是 {marketKey: amount} 对象' });
      }
      const betEntries = Object.entries(bets);
      if (betEntries.length < 1) {
        return res.status(400).json({ error: 'bets 不能为空' });
      }
      if (betEntries.length > marketCount) {
        return res.status(400).json({ error: `下注项过多（上限 ${marketCount}）` });
      }
      // 逐项校验：market key 合法 + amount 严格 > 0（防负注额刷钱/绕过总额上限）
      let total = 0;
      for (const [key, amt] of betEntries) {
        if (!entry.isValidMarketKey(key)) {
          return res.status(400).json({ error: `非法盘口 key：${key}` });
        }
        const a = Number(amt);
        if (!Number.isFinite(a) || !(a > 0)) {
          return res.status(400).json({ error: `下注金额必须 > 0（key ${key}）` });
        }
        total += a;
      }
      const totalStr = total.toFixed(2);

      // 风控前置：按服务端算出的总注额校验
      assertBetWithinLimits(gameName, totalStr);

      // 1. 幂等先查
      const existing = await findRoundGameBet(idempotencyKey, gameName);
      if (existing) {
        const oldResult = existing.result || {};
        return res.json({
          drawResult: oldResult.drawResult,
          bets: oldResult.bets,
          perKeyOutcome: oldResult.perKeyOutcome,
          totalPayout: existing.payout,
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
          // 2. claimNonce（锁 player_seeds）
          await ensureActiveSeed(client, playerId);
          const { serverSeed, clientSeed, serverSeedHash, nonce } = await claimNonce(client, playerId);

          // 开奖 + 逐 key 三态结算全由后端算，前端只提供 bets
          const rng = makeSeededRng(serverSeed, clientSeed, nonce);
          const { drawResult, hits, pushes } = entry.spin(rng);
          const perKeyOutcome = {};
          let rawTotalPayout = 0;
          for (const [key, amt] of betEntries) {
            const a = Number(amt);
            if (hits.has(key)) {
              const p = round2(a * entry.MARKETS[key].odds);
              perKeyOutcome[key] = { outcome: 'hit', payout: p };
              rawTotalPayout += p;
            } else if (entry.hasPush && pushes.has(key)) {
              // push（平局）：退本金，既不算赢也不算输
              perKeyOutcome[key] = { outcome: 'push', payout: a };
              rawTotalPayout += a;
            } else {
              perKeyOutcome[key] = { outcome: 'lose', payout: 0 };
            }
          }
          // 钳制型 cap；SQL numeric 定稿避免 JS 浮点累加误差
          const capRow = await client.query(
            'SELECT LEAST(round($1::numeric, 2), $2::numeric) AS payout',
            [String(rawTotalPayout), String(maxPayoutFor(gameName))]
          );
          const totalPayout = capRow.rows[0].payout;
          const win = Number(totalPayout) > 0;

          // 3. 建 round（settled）
          const betsSnapshot = Object.fromEntries(betEntries.map(([k, a]) => [k, Number(a)]));
          const roundResult = await client.query(
            `INSERT INTO rounds (game, player_id, bet_amount, client_seed, server_seed, result_hash, payout, status, result)
             VALUES ($1, $2, $3::numeric, $4, $5, $6, $7::numeric, 'settled', $8::jsonb)
             RETURNING id`,
            [
              gameName,
              playerId,
              totalStr,
              clientSeed,
              serverSeed,
              serverSeedHash,
              totalPayout,
              JSON.stringify({ bets: betsSnapshot, drawResult, perKeyOutcome, totalPayout, nonce }),
            ]
          );
          const roundId = roundResult.rows[0].id;

          // 4. 扣钱（一次扣总注额）
          const { balanceAfter: balanceAfterDebit } = await debit(client, {
            playerId,
            amount: totalStr,
            type: `${gameName}_bet`,
            idempotencyKey,
            roundId,
          });

          let balanceAfter = balanceAfterDebit;
          if (win) {
            // totalPayout 含中奖派彩 + push 退注，一并入账
            const creditResult = await credit(client, {
              playerId,
              amount: totalPayout,
              type: `${gameName}_payout`,
              idempotencyKey: `${gameName}-payout-${roundId}`,
              roundId,
            });
            balanceAfter = creditResult.balanceAfter;
          } else {
            // 全输（无中无 push）：总注额进入链式分成
            const playerResult = await client.query('SELECT agent_id FROM players WHERE id = $1', [playerId]);
            const agentId = playerResult.rows[0]?.agent_id;
            if (agentId) {
              await distributeLoss(client, { playerId, agentId, roundId, lossAmount: totalStr });
            }
          }

          // 5. 建 bet
          await client.query(
            `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome)
             VALUES ($1, $2, $3::numeric, $4, $5)`,
            [roundId, playerId, totalStr, idempotencyKey, win ? 'win' : 'lose']
          );

          return { drawResult, bets: betsSnapshot, perKeyOutcome, totalPayout, balanceAfter, clientSeed, nonce, serverSeedHash, roundId };
        });

        return res.json({ ...result, idempotent: false });
      } catch (err) {
        if (err.code === '23505') {
          const existingAfterConflict = await findRoundGameBet(idempotencyKey, gameName);
          if (existingAfterConflict) {
            const oldResult = existingAfterConflict.result || {};
            return res.json({
              drawResult: oldResult.drawResult,
              bets: oldResult.bets,
              perKeyOutcome: oldResult.perKeyOutcome,
              totalPayout: existingAfterConflict.payout,
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
  };
}

// ==================================================================
// 排期器接入【通用调度 handler 工厂】（#43 单1 试点 speedgrid，单3 铺 numberup/derbyday/dominoduel）
// —— 不走 per-player makeRoundGameHandler。开奖由 ws/roundHub.js 按房间相位机统一驱动
// （全局期号、全场共享一局），本端点只负责：查 hub 相位（非 betting → 409 round_locked，在 debit 之前）
// → 校验/风控/防负注（照通用 handler 口径）→ debit 扣注 → INSERT bets(round_id=当期共享 round,
// selections 明细, outcome='pending') → 返回受理。结算（逐 key 三态含 push 退本金 + 派彩/分成）延后到
// roundHub 的 drawn 相位统一做，本端点【不结算、不开奖】。未接排期器的轮次款仍走下方 makeRoundGameHandler。
// ==================================================================

/** 按幂等键回查已受理的某调度款下注（供重复请求幂等返回），带回当期期号。 */
async function findScheduledBet(idempotencyKey, gameName) {
  const r = await query(
    `SELECT b.round_id, r.round_no
       FROM bets b JOIN rounds r ON r.id = b.round_id
      WHERE b.idempotency_key = $1 AND r.game = $2`,
    [idempotencyKey, gameName],
  );
  return r.rowCount > 0 ? r.rows[0] : null;
}

/**
 * 造一个排期器接入的下注 handler（参数化引擎）。请求 { bets:{marketKey:amount}, idempotencyKey }。
 * @param {string} gameName - 注册表键（= DB rounds.game = roundHub room key = 风控 config key）
 */
function makeScheduledRoundHandler(gameName) {
  const entry = ROUND_GAME_REGISTRY[gameName];
  const marketCount = Object.keys(entry.MARKETS).length;
  return async (req, res, next) => {
    try {
      const playerId = req.user.sub;
      // #42 多房：roundId 【可选】——不传=该款标准房当期轮（旧客户端/前端零碰期，行为与房化前一致）；
      //   传了=按 roundId 在该款所有房里定位当期 betting 房。
      const { bets, idempotencyKey, roundId: wantRoundId } = req.body || {};

      if (!idempotencyKey) {
        return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
      }
      if (!bets || typeof bets !== 'object' || Array.isArray(bets)) {
        return res.status(400).json({ error: 'bets 必须是 {marketKey: amount} 对象' });
      }
      const betEntries = Object.entries(bets);
      if (betEntries.length < 1) {
        return res.status(400).json({ error: 'bets 不能为空' });
      }
      if (betEntries.length > marketCount) {
        return res.status(400).json({ error: `下注项过多（上限 ${marketCount}）` });
      }
      // 逐项校验：market key 合法 + amount 严格 > 0（防负注额刷钱/绕过总额上限）
      let total = 0;
      for (const [key, amt] of betEntries) {
        if (!entry.isValidMarketKey(key)) {
          return res.status(400).json({ error: `非法盘口 key：${key}` });
        }
        const a = Number(amt);
        if (!Number.isFinite(a) || !(a > 0)) {
          return res.status(400).json({ error: `下注金额必须 > 0（key ${key}）` });
        }
        total += a;
      }
      const totalStr = total.toFixed(2);

      // 风控前置：按服务端算出的总注额校验（RiskError 由全局中间件转 4xx）
      assertBetWithinLimits(gameName, totalStr);

      // 幂等先查：重复请求直接回已受理信息，不重复扣钱。
      const dup = await findScheduledBet(idempotencyKey, gameName);
      if (dup) {
        return res.json({
          roundNo: dup.round_no,
          roundId: dup.round_id,
          accepted: true,
          balanceAfter: await getBalance(playerId),
          idempotent: true,
        });
      }

      // 相位闸（在 debit 之前）：只有当前房间处于 betting 才收注；否则 409 round_locked。
      // #42 多房：roundId 是【可选】的 ——
      //   · 不传（旧客户端/前端零碰期）→ 该款【标准房】的当期轮，与房化前完全一致。
      //   · 传了 → 在该款所有房里找「当期正在 betting 且 roundId 相符」的房。谎报也闸得住：
      //     roundId 是服务端发的，且必须等于某房【此刻】的当期轮，对不上就找不到 → 同一条 409。
      const rs = wantRoundId != null
        ? findBettingRoomByRoundId(gameName, wantRoundId)
        : getRoomState(gameName);
      if (!rs || rs.phase !== 'betting' || !rs.roundId) {
        return res.status(409).json({ error: 'round_locked' });
      }
      const roundId = rs.roundId;
      const roundNo = rs.roundNo;

      // 下注明细快照（{key: 数字注额}）落 bets.selections，供 roundHub 结算时逐 key 三态。
      const selections = Object.fromEntries(betEntries.map(([k, a]) => [k, Number(a)]));

      try {
        const balanceAfter = await withTransaction(async (client) => {
          const { balanceAfter: after } = await debit(client, {
            playerId,
            amount: totalStr,
            type: `${gameName}_bet`,
            idempotencyKey,
            roundId,
          });
          await client.query(
            `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome, selections)
             VALUES ($1, $2, $3::numeric, $4, 'pending', $5::jsonb)`,
            [roundId, playerId, totalStr, idempotencyKey, JSON.stringify(selections)],
          );
          return after;
        });

        return res.json({ roundNo, roundId, accepted: true, balanceAfter, idempotent: false });
      } catch (err) {
        if (err.code === '23505') {
          // 唯一键冲突（并发重复请求）：回查已受理记录按幂等命中返回，不重复扣钱。
          const existing = await findScheduledBet(idempotencyKey, gameName);
          if (existing) {
            return res.json({
              roundNo: existing.round_no,
              roundId: existing.round_id,
              accepted: true,
              balanceAfter: await getBalance(playerId),
              idempotent: true,
            });
          }
        }
        throw err;
      }
    } catch (err) {
      return next(err);
    }
  };
}

// —— 全 9 款轮次已接排期器（roundHub 多房间统一开奖）：单1 speedgrid、单3 批1 numberup/derbyday/dominoduel、
//    单3 批2 hattrick/goldenboot/halftime/wuxing/lineup。RollingBall 连开 3 球仍走下方 bespoke。——
router.post('/speedgrid/play', requireAuth, requireType('player'), makeScheduledRoundHandler('speedgrid'));
router.post('/numberup/play', requireAuth, requireType('player'), makeScheduledRoundHandler('numberup'));
router.post('/derbyday/play', requireAuth, requireType('player'), makeScheduledRoundHandler('derbyday'));
router.post('/dominoduel/play', requireAuth, requireType('player'), makeScheduledRoundHandler('dominoduel'));
router.post('/hattrick/play', requireAuth, requireType('player'), makeScheduledRoundHandler('hattrick'));
router.post('/goldenboot/play', requireAuth, requireType('player'), makeScheduledRoundHandler('goldenboot'));
router.post('/halftime/play', requireAuth, requireType('player'), makeScheduledRoundHandler('halftime'));
router.post('/wuxing/play', requireAuth, requireType('player'), makeScheduledRoundHandler('wuxing'));
router.post('/lineup/play', requireAuth, requireType('player'), makeScheduledRoundHandler('lineup'));

// ==================================================================
// RollingBall（连开 3 球）—— bespoke 多步 handler（不走通用轮次脚手架）
// 方案：B 按步现派（每球只在该球请求到达时才抽，result 只存已开球，未开球不存→无未来泄露）
//   + 单端点线程 roundId（ballIndex 服务端从 revealed.length 定序，客户端传的一律不信）
//   + 每球 claimNonce + drawBall 按步抽 + 服务端 oddsFor 锁 odds（前端 odds 仅显示）
//   + 逐球即扣即结（无跨球骑留 → 敞口=0，不入 computeOpenExposure）+ 每球幂等 + cap 钳制。
// ==================================================================
const RB_MARKET_MAX = 93;   // 合法键上限：6 组 + 3 行 + 5 列 + 4 组合 + 75 单号

/** 按幂等键查询已存在的某球 rollingball 记录（跨事务普通查询），供幂等返回 */
async function findRollingBallBet(idempotencyKey) {
  const result = await query(
    `SELECT b.round_id, r.result, r.result_hash, r.client_seed
       FROM bets b JOIN rounds r ON r.id = b.round_id
      WHERE b.idempotency_key = $1 AND r.game = 'rollingball'`,
    [idempotencyKey]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

/** 从某球记录拼幂等响应 */
function rbBallResponse(row, idempotencyKey, balanceAfter) {
  const balls = row.result?.balls || [];
  const ball = balls.find((b) => b.idempotencyKey === idempotencyKey);
  if (!ball) return null;
  const revealed = (row.result?.revealed || []).slice(0, ball.idx + 1);
  const settled = row.result?.status === 'settled';
  return {
    roundId: row.round_id, ballIndex: ball.idx, ball: ball.ball,
    perKeyOutcome: ball.perKeyOutcome, ballPayout: ball.ballPayout,
    revealed, nextBall: settled ? null : ball.idx + 1, status: row.result?.status,
    balanceAfter, clientSeed: row.client_seed, nonce: ball.nonce, serverSeedHash: row.result_hash,
    idempotent: true,
  };
}

router.post('/rollingball/play', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { roundId, bets, idempotencyKey } = req.body || {};

    if (!idempotencyKey) return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
    if (!bets || typeof bets !== 'object' || Array.isArray(bets)) return res.status(400).json({ error: 'bets 必须是 {key: amount} 对象' });
    const betEntries = Object.entries(bets);
    if (betEntries.length < 1) return res.status(400).json({ error: '每球至少下 1 注' });   // 每球≥1注
    if (betEntries.length > RB_MARKET_MAX) return res.status(400).json({ error: `下注项过多（上限 ${RB_MARKET_MAX}）` });

    // 静态校验：key 合法 + amount 严格 >0（防负注/绕限）；「已开号/c_k=0」需 revealed，进事务再判。
    let total = 0;
    for (const [key, amt] of betEntries) {
      if (!rollingBallEngine.isValidKey(key)) return res.status(400).json({ error: `非法盘口 key：${key}` });
      const a = Number(amt);
      if (!Number.isFinite(a) || !(a > 0)) return res.status(400).json({ error: `下注金额必须 > 0（key ${key}）` });
      total += a;
    }
    const totalStr = total.toFixed(2);
    assertBetWithinLimits('rollingball', totalStr);   // 每球独立风控（敞口=0，无需 exposure gate）

    // 幂等先查（每球独立 idempotencyKey）
    const existing = await findRollingBallBet(idempotencyKey);
    if (existing) {
      const resp = rbBallResponse(existing, idempotencyKey, await getBalance(playerId));
      if (resp) return res.json(resp);
    }

    try {
      const out = await withTransaction(async (client) => {
        await ensureActiveSeed(client, playerId);

        // ---- 定序：新局 ballIdx=0；续球从 revealed.length 定序（客户端 ballIndex 不信，仅校验一致）----
        let revealed, balls, ballIdx, round = null;
        if (roundId == null) {
          revealed = []; balls = []; ballIdx = 0;
        } else {
          const r = await client.query('SELECT * FROM rounds WHERE id = $1 FOR UPDATE', [roundId]);
          if (r.rowCount === 0) throw httpError(404, '该局不存在');
          round = r.rows[0];
          if (round.game !== 'rollingball') throw httpError(400, '该局不是 rollingball 游戏');
          if (String(round.player_id) !== String(playerId)) throw httpError(403, '无权访问该局');
          if (round.status !== 'playing') throw httpError(400, '该局已结束');
          revealed = round.result.revealed || [];
          balls = round.result.balls || [];
          ballIdx = revealed.length;   // 服务端定序
          if (ballIdx > 2) throw httpError(400, '本局 3 球已开满');
        }
        // 客户端若传 ballIndex，必须与服务端定序一致（防跳球）
        if (req.body.ballIndex != null && Number(req.body.ballIndex) !== ballIdx) {
          throw httpError(400, `ballIndex 定序错误（应为 ${ballIdx}，防跳球）`);
        }

        // ---- claimNonce（每球一个，一局 N/N+1/N+2）----
        const { serverSeed, clientSeed, serverSeedHash, nonce } = await claimNonce(client, playerId);

        // ---- 按步现派：从剩余池抽本球（未开球不预抽）----
        const remaining = rollingBallEngine.remainingPool(revealed);
        const rng = makeSeededRng(serverSeed, clientSeed, nonce);
        const ball = rollingBallEngine.drawBall(remaining, rng);

        // ---- 服务端算 odds 锁定 + 逐 key 结算（前端 odds 一律不信）----
        const perKeyOutcome = {}; const betsRecord = {}; let rawPayout = 0;
        for (const [key, amt] of betEntries) {
          const a = Number(amt);
          const odds = rollingBallEngine.oddsFor(key, ballIdx, revealed);
          if (odds == null) throw httpError(400, `盘口不可押（已开号/号池耗尽）：${key}`);   // 无放回拒
          betsRecord[key] = { stake: a, odds };
          if (rollingBallEngine.hitOf(key, ball)) {
            const p = round2(a * odds);
            perKeyOutcome[key] = { outcome: 'hit', payout: p };
            rawPayout += p;
          } else {
            perKeyOutcome[key] = { outcome: 'lose', payout: 0 };
          }
        }
        // 钳制型 cap（SQL numeric 定稿，避免 JS 浮点累加误差）
        const capRow = await client.query(
          'SELECT LEAST(round($1::numeric, 2), $2::numeric) AS payout',
          [String(rawPayout), String(maxPayoutFor('rollingball'))]
        );
        const ballPayout = capRow.rows[0].payout;
        const win = Number(ballPayout) > 0;

        const newRevealed = [...revealed, ball];
        const status = newRevealed.length >= 3 ? 'settled' : 'playing';
        const ballEntry = { idx: ballIdx, ball, nonce, idempotencyKey, bets: betsRecord, perKeyOutcome, ballPayout };
        const newResult = { revealed: newRevealed, balls: [...balls, ballEntry], status };

        // ---- 建/更新 round（result 只存已开球）----
        let rid;
        if (roundId == null) {
          const rr = await client.query(
            `INSERT INTO rounds (game, player_id, bet_amount, client_seed, server_seed, result_hash, payout, status, result)
             VALUES ('rollingball', $1, $2::numeric, $3, $4, $5, $6::numeric, $7, $8::jsonb)
             RETURNING id`,
            [playerId, totalStr, clientSeed, serverSeed, serverSeedHash, ballPayout, status, JSON.stringify(newResult)]
          );
          rid = rr.rows[0].id;
        } else {
          rid = round.id;
          await client.query(
            `UPDATE rounds SET bet_amount = bet_amount + $1::numeric, payout = COALESCE(payout, 0) + $2::numeric, status = $3, result = $4::jsonb WHERE id = $5`,
            [totalStr, ballPayout, status, JSON.stringify(newResult), rid]
          );
        }

        // ---- 逐球即扣即结（本球扣本球注、派本球赢；无跨球骑留 → 敞口=0）----
        const { balanceAfter: afterDebit } = await debit(client, {
          playerId, amount: totalStr, type: 'rollingball_bet', idempotencyKey, roundId: rid,
        });
        let balanceAfter = afterDebit;
        if (win) {
          const cr = await credit(client, {
            playerId, amount: ballPayout, type: 'rollingball_payout',
            idempotencyKey: `rollingball-payout-${rid}-${ballIdx}`, roundId: rid,
          });
          balanceAfter = cr.balanceAfter;
        } else {
          const pr = await client.query('SELECT agent_id FROM players WHERE id = $1', [playerId]);
          const agentId = pr.rows[0]?.agent_id;
          if (agentId) await distributeLoss(client, { playerId, agentId, roundId: rid, lossAmount: totalStr });
        }
        // 每球一条 bet（idempotency_key = 本球键）
        // #S3：追记本球 selections + 注级三态明细 settle_detail（值全从现成 perKeyOutcome 派生，不新算钱）
        const selections = Object.fromEntries(betEntries.map(([k, a]) => [k, Number(a)]));
        const settleDetail = betEntries.map(([key]) => {
          const o = perKeyOutcome[key];
          return { key, outcome: o.outcome, payout: o.payout };
        });
        await client.query(
          `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome, selections, settle_detail)
           VALUES ($1, $2, $3::numeric, $4, $5, $6::jsonb, $7::jsonb)`,
          [rid, playerId, totalStr, idempotencyKey, win ? 'win' : 'lose', JSON.stringify(selections), JSON.stringify(settleDetail)]
        );

        return {
          roundId: rid, ballIndex: ballIdx, ball, perKeyOutcome, ballPayout,
          revealed: newRevealed, nextBall: status === 'settled' ? null : newRevealed.length, status,
          balanceAfter, clientSeed, nonce, serverSeedHash,
        };
      });
      return res.json({ ...out, idempotent: false });
    } catch (err) {
      if (err.code === '23505') {
        const after = await findRollingBallBet(idempotencyKey);
        if (after) { const resp = rbBallResponse(after, idempotencyKey, await getBalance(playerId)); if (resp) return res.json(resp); }
      }
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      throw err;
    }
  } catch (err) {
    return next(err);
  }
});

// ==================================================================
// POST /round/rollingball/bet —— #公期化 单1b：滚球【公期局】三窗按球下注（仅玩家）
// ==================================================================
//
// 与上面老 bespoke /rollingball/play 的关系：**两条路，互不相干，老路一字未动**。
//   · 老 /play = per-player 局（玩家自己的一局三球、逐球现派逐球即结、裸 key、敞口 0）；
//   · 新 /bet  = 全服公期局（roundHub 六段相位机开的那一局，全场共享 roundId、复合 key
//     `b1:/b2:/b3:`、注挂 pending 由 settle 段统一结算）。本端点【不开奖、不结算】。
//
// 钱层骨架机械照抄 makeScheduledRoundHandler（那个共享工厂本体零碰，只复用它的只读助手
//   findScheduledBet/getBalance）：idempotencyKey 必填 → bets 对象/条目数/每 amount 严格 >0
//   → 服务端 Σ 过 assertBetWithinLimits → 幂等先查 → 相位闸（debit 之前）→ 事务内
//   debit + INSERT bets(selections, outcome='pending') → 返 balanceAfter；23505 回幂等。
//
// 三条本单新逻辑（其余全是抄的）：
//   a) 相位闸：读 getRoomState 的 segMode/phase/betsLocked/revealed（裁定①双向自证，见下）
//   b) 三窗按球限盘：bet_k 窗【只】收 `b{k}:` 前缀的键，跨窗键一律 400
//   c) 白名单全部引擎派生：parseBallKey 内建 isValidKey 校验裸键；再过
//      oddsFor(marketKey, ballIdx, revealed) —— 返 null 即「已开号 / c_k=0」死键，拒。
//      禁在本文件手抄任何键表/赔率公式。
//
// ⚠ 敞口口径（裁定②，明示不治）：老 per-player 是「每球一局、每球独立风控、敞口 0」；公期局
//   三窗注挂【同一个 roundId】，同一玩家单局在飞注额可达 3×maxBet。本单不加局级敞口闸，
//   与已接排期器的 16 房同构，靠注行级 maxPayout cap 兜底。
const RB_BET_MAX_KEYS = rollingBallEngine.ALL_MARKET_KEYS.length;   // 裁定③：引擎自算（93），禁手抄

router.post('/rollingball/bet', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { bets, idempotencyKey } = req.body || {};

    // —— 静态入参校验（照 makeScheduledRoundHandler 口径，逐条对应）——
    if (!idempotencyKey) return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
    if (!bets || typeof bets !== 'object' || Array.isArray(bets)) {
      return res.status(400).json({ error: 'bets 必须是 {ballKey: amount} 对象' });
    }
    const betEntries = Object.entries(bets);
    if (betEntries.length < 1) return res.status(400).json({ error: 'bets 不能为空' });
    if (betEntries.length > RB_BET_MAX_KEYS) {
      return res.status(400).json({ error: `下注项过多（上限 ${RB_BET_MAX_KEYS}）` });
    }

    // —— 相位闸（在 debit 之前；裁定①双向自证）——
    // 窗号派生源 = revealed.length（已开球数 == 下一颗待开球的 ballIdx，和 oddsFor 第二参是
    //   同一个量），不是 segIdx/2 —— 后者等于在本文件手抄「段表是 bet,draw,bet,draw,bet,draw」
    //   这个布局。再用 phase === `bet{ballIdx+1}` 做第二条独立派生互证：两者不一致（相位机正
    //   处于 draw/settle 段、或段表被改过）一律 409，绝不落到「按错误的球收注」。
    const rs = getRoomState('rollingball');
    if (!rs || rs.segMode !== 'triple' || !rs.roundId) {
      return res.status(409).json({ error: 'round_locked' });
    }
    const ballIdx = Array.isArray(rs.revealed) ? rs.revealed.length : -1;
    if (ballIdx < 0 || ballIdx > 2 || rs.phase !== `bet${ballIdx + 1}`) {
      return res.status(409).json({ error: 'round_locked' });
    }
    // 锁帧缓冲期（bet 窗关后 lockedMs 到开球之间）：窗已关，绝不能再收注——收了就是对着
    // 即将开出的球下注。同样拒在 debit 之前。
    if (rs.betsLocked) return res.status(409).json({ error: 'round_locked' });

    const revealed = rs.revealed;
    const wantPrefix = ballIdx + 1;   // 本窗只收 b{wantPrefix}: 前缀

    // —— 逐键校验：跨窗拒 / 假键拒 / 死键拒 / 负注拒（全部在 debit 之前）——
    let total = 0;
    const oddsSnapshot = {};
    for (const [key, amt] of betEntries) {
      const parsed = rollingBallEngine.parseBallKey(key);   // 内建裸键 isValidKey 校验
      if (!parsed) return res.status(400).json({ error: `非法盘口 key：${key}（公期局须用 b1:/b2:/b3: 前缀）` });
      if (parsed.ballIdx !== ballIdx) {
        return res.status(400).json({
          error: `本窗只收第 ${wantPrefix} 球盘口（b${wantPrefix}:），该键属第 ${parsed.ballIdx + 1} 球：${key}`,
        });
      }
      // 死键：已开号（无放回）/ 组合键剩余计数 c_k=0 —— 引擎说了算，本文件不判
      const odds = rollingBallEngine.oddsFor(parsed.marketKey, ballIdx, revealed);
      if (odds == null) return res.status(400).json({ error: `盘口不可押（已开号/号池耗尽）：${key}` });
      const a = Number(amt);
      if (!Number.isFinite(a) || !(a > 0)) return res.status(400).json({ error: `下注金额必须 > 0（key ${key}）` });
      oddsSnapshot[key] = odds;
      total += a;
    }
    const totalStr = total.toFixed(2);

    // 风控前置：按服务端算出的总额校验（RiskError 由全局中间件转 4xx）
    assertBetWithinLimits('rollingball', totalStr);

    // 幂等先查：重复请求直接回已受理信息，不重复扣钱。
    const dup = await findScheduledBet(idempotencyKey, 'rollingball');
    if (dup) {
      return res.json({
        roundNo: dup.round_no,
        roundId: dup.round_id,
        accepted: true,
        balanceAfter: await getBalance(playerId),
        idempotent: true,
      });
    }

    const roundId = rs.roundId;
    const roundNo = rs.roundNo;
    const selections = Object.fromEntries(betEntries.map(([k, a]) => [k, Number(a)]));

    try {
      const balanceAfter = await withTransaction(async (client) => {
        const { balanceAfter: after } = await debit(client, {
          playerId,
          amount: totalStr,
          type: 'rollingball_bet',
          idempotencyKey,
          roundId,
        });
        await client.query(
          `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome, selections)
           VALUES ($1, $2, $3::numeric, $4, 'pending', $5::jsonb)`,
          [roundId, playerId, totalStr, idempotencyKey, JSON.stringify(selections)],
        );
        return after;
      });

      // odds 快照【仅供前端显示】：结算一律以 settle 段 hitsForBalls 现算的 oddsByKey 为准
      //   （两者同一个 oddsFor(marketKey, ballIdx, 该球开出前已开号)，本窗内恒等——本窗未开球，
      //   revealed 不会再变；故这份快照与结算值天然一致，但权威仍在结算侧）。
      return res.json({
        roundNo, roundId, accepted: true, balanceAfter, idempotent: false,
        ballIndex: ballIdx, phase: rs.phase, odds: oddsSnapshot,
      });
    } catch (err) {
      if (err.code === '23505') {
        // 唯一键冲突（并发重复请求）：回查已受理记录按幂等命中返回，不重复扣钱。
        const existing = await findScheduledBet(idempotencyKey, 'rollingball');
        if (existing) {
          return res.json({
            roundNo: existing.round_no,
            roundId: existing.round_id,
            accepted: true,
            balanceAfter: await getBalance(playerId),
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
        // 派彩钳制（LEAST，非拒绝）：即时局打出 red/16 大奖若超 cap，钳到 maxPayout 落袋，
        // 而非 assertPayoutCap 把整局 rollback（那会让本该中奖变成下注报错）。落库/ledger 用钳后值。
        const payoutResult = await client.query(
          'SELECT LEAST(trunc($1::numeric * $2::numeric, 2), $3::numeric) AS payout',
          [amountStr, String(mult), String(maxPayoutFor('plinko'))]
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
          // 5a. 派彩加钱（资金唯一出入口）。payout 已在算式里 LEAST 钳到 cap，无需再拒绝。
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
        // 派彩钳制（LEAST，非拒绝）：target 上限 MAX_MULT=1e6，高 target 中奖时 bet×target 可远超 cap，
        // 钳到 maxPayout 落袋而非 assertPayoutCap 抛错 rollback（那会让高 target 中奖反被拒、永远收不到）。同 mines/hilo 口径。
        let payout = '0.00';
        if (win) {
          const payoutResult = await client.query(
            'SELECT LEAST(trunc($1::numeric * $2::numeric, 2), $3::numeric) AS payout',
            [amountStr, targetNum, String(maxPayoutFor('limbo'))]
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
          // 5a. 赢：派彩加钱（资金唯一出入口）。payout 已在算式里 LEAST 钳到 cap，无需再拒绝。
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
      WHERE player_id = $1 AND game IN ('mines','hilo','goal') AND status = 'playing'
      FOR UPDATE`,
    [playerId]
  );
  let total = 0;
  for (const r of res.rows) {
    // extra：mines 取 mineCount、goal 取 tier；hilo 不需要（走 exposureMult）
    let extra;
    if (r.game === 'mines') extra = r.result?.mineCount;
    else if (r.game === 'goal') extra = r.result?.tier;
    total += potentialPayout(r.game, r.bet_amount, extra);
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
        // 派彩钳制（LEAST，非拒绝）：满清倍数中段爆炸（mines13 3.6M×），任何注都超 cap，
        // 钳到 maxPayout 落袋而非 rollback（否则玩家揭满/滚倍到大奖反而兑不出）。落库/ledger 用钳后值。
        const payoutResult = await client.query(
          'SELECT LEAST(round($1::numeric * $2::numeric, 2), $3::numeric) AS payout',
          [round.bet_amount, String(mult), String(maxPayoutFor('mines'))]
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

      // 派彩钳制（LEAST，非拒绝）：多步滚倍后 payout 超 cap 钳到 maxPayout 落袋，同揭满口径，
      // 而非 rollback 让玩家兑不出大奖。落库/ledger 用钳后值。
      const payoutResult = await client.query(
        'SELECT LEAST(round($1::numeric * $2::numeric, 2), $3::numeric) AS payout',
        [round.bet_amount, String(mult), String(maxPayoutFor('mines'))]
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
      // 派彩钳制（LEAST，非拒绝）：cum 理论无界，多步滚倍超 cap 钳到 maxPayout 落袋，
      // 而非 assertPayoutCap 抛错 rollback（那会让局锁死 playing、合法赢额兑不出）。同 mines 口径，
      // 落库/ledger 用钳后值。
      const payoutResult = await client.query(
        'SELECT LEAST(round($1::numeric * $2::numeric, 2), $3::numeric) AS payout',
        [round.bet_amount, r.cum, String(maxPayoutFor('hilo'))]
      );
      const payout = payoutResult.rows[0].payout;

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

// ==================================================================
// Goal（射门闯关）—— 多步局：7 列逐列避雷累乘。差异于 mines：雷【按列现派】
// （result 永不落未来列雷位），派彩用【钳制】型 cap（不作废熬过多列的赢局）。
// ==================================================================

/** 按幂等键查询已存在的 goal 局（跨事务的普通查询，不加锁），供 start 幂等返回 */
async function findGoalBetByIdempotencyKey(idempotencyKey) {
  const result = await query(
    `SELECT b.id AS bet_id, b.round_id, b.player_id,
            r.result, r.result_hash, r.client_seed, r.status
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
      WHERE b.idempotency_key = $1 AND r.game = 'goal'`,
    [idempotencyKey]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

/** 按 roundId 取一局 goal，行锁 FOR UPDATE，并校验所属玩家 */
async function lockGoalRound(client, roundId, playerId) {
  const result = await client.query('SELECT * FROM rounds WHERE id = $1 FOR UPDATE', [roundId]);
  if (result.rowCount === 0) throw httpError(404, '该局不存在');
  const round = result.rows[0];
  if (round.game !== 'goal') throw httpError(400, '该局不是 goal 游戏');
  if (String(round.player_id) !== String(playerId)) throw httpError(403, '无权访问该局');
  return round;
}

// ------------------------------------------------------------------
// POST /round/goal/start —— 开局：选 tier（每列雷数，局中锁），建有状态会话
// 说明：不派任何雷（按列现派，result 里没有未来雷位）。serverSeed 只落库，reveal 前绝不返回。
// ------------------------------------------------------------------
router.post('/goal/start', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { amount, tier, idempotencyKey } = req.body || {};
    const amountNum = Number(amount);

    if (!idempotencyKey) {
      return res.status(400).json({ error: '参数不完整：idempotencyKey 必填' });
    }
    if (!amountNum || !(amountNum > 0)) {
      return res.status(400).json({ error: '下注金额必须大于 0' });
    }
    if (!GOAL_TIERS[tier]) {
      return res.status(400).json({ error: 'tier 必须是 sm / md / lg' });
    }

    // 风控前置：注额超限直接拒
    assertBetWithinLimits('goal', amountNum.toFixed(2));

    // 1. 幂等先查
    const existing = await findGoalBetByIdempotencyKey(idempotencyKey);
    if (existing) {
      return res.json({
        roundId: existing.round_id,
        serverSeedHash: existing.result_hash,
        clientSeed: existing.client_seed,
        nonce: existing.result?.nonce,
        tier: existing.result?.tier,
        balanceAfter: await getBalance(playerId),
        idempotent: true,
      });
    }

    try {
      const result = await withTransaction(async (client) => {
        // 2. claimNonce（锁 player_seeds）
        await ensureActiveSeed(client, playerId);
        const { serverSeed, clientSeed, serverSeedHash, nonce } = await claimNonce(client, playerId);

        const amountStr = amountNum.toFixed(2);

        // 敞口闸（debit 前）：goal 潜在 = min(bet×stepMult(tier)^7, cap)。锁序 player_seeds→rounds→wallets。
        const { total: openTotal, count: openCount } = await computeOpenExposure(client, playerId);
        assertExposureWithinLimit('goal', openTotal, openCount, potentialPayout('goal', amountStr, tier));

        // 3. 建 round：status='playing'，result 存 tier/picks/cum/step/nonce（无任何雷位）
        const roundResult = await client.query(
          `INSERT INTO rounds (game, player_id, bet_amount, client_seed, server_seed, result_hash, payout, status, result)
           VALUES ('goal', $1, $2::numeric, $3, $4, $5, NULL, 'playing', $6::jsonb)
           RETURNING id`,
          [
            playerId,
            amountStr,
            clientSeed,
            serverSeed,
            serverSeedHash,
            JSON.stringify({ tier, picks: [], cum: 1, step: 0, nonce, status: 'playing' }),
          ]
        );
        const roundId = roundResult.rows[0].id;

        // 4. 扣钱
        const { balanceAfter } = await debit(client, {
          playerId,
          amount: amountStr,
          type: 'goal_bet',
          idempotencyKey,
          roundId,
        });

        // 5. 建 bet（未结算，pending）
        await client.query(
          `INSERT INTO bets (round_id, player_id, amount, idempotency_key, outcome)
           VALUES ($1, $2, $3::numeric, $4, 'pending')`,
          [roundId, playerId, amountStr, idempotencyKey]
        );

        return { roundId, serverSeedHash, clientSeed, nonce, tier, balanceAfter };
      });

      return res.json({ ...result, idempotent: false });
    } catch (err) {
      if (err.code === '23505') {
        const existingAfterConflict = await findGoalBetByIdempotencyKey(idempotencyKey);
        if (existingAfterConflict) {
          return res.json({
            roundId: existingAfterConflict.round_id,
            serverSeedHash: existingAfterConflict.result_hash,
            clientSeed: existingAfterConflict.client_seed,
            nonce: existingAfterConflict.result?.nonce,
            tier: existingAfterConflict.result?.tier,
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
// POST /round/goal/pick —— 推进一列：服务器【按列现派】本列雷行，避雷则累乘、踩雷终局。
// 说明：每次对该 roundId 行锁；tier 从 round.result 读（不收客户端，天然锁）；走满 7 列自动结算（钳制 cap）。
// ------------------------------------------------------------------
router.post('/goal/pick', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { roundId, row } = req.body || {};
    const rowNum = Number(row);

    if (!roundId) {
      return res.status(400).json({ error: '参数不完整：roundId 必填' });
    }
    if (!Number.isInteger(rowNum) || rowNum < 0 || rowNum >= 4) {
      return res.status(400).json({ error: 'row 必须是 0–3 的整数' });
    }

    const result = await withTransaction(async (client) => {
      const round = await lockGoalRound(client, roundId, playerId);
      const r = round.result || {};

      // 已终局：bust 幂等返回，cashed 拒绝
      if (round.status !== 'playing') {
        if (round.status === 'bust') {
          return { safe: false, col: r.bustCol, bombs: r.bombs, cum: r.cum, serverSeedHash: round.result_hash, clientSeed: round.client_seed, nonce: r.nonce, roundId: round.id, alreadyDone: true };
        }
        throw httpError(400, '该局已结束，无法继续');
      }

      const tier = r.tier;
      const bombs = GOAL_TIERS[tier].bombs;
      const step = r.step;
      // 按列现派：本列雷行（tier 从 result 读，客户端改不了）
      const bombSet = deriveBombRows(round.server_seed, round.client_seed, r.nonce, step, bombs);

      if (bombSet.has(rowNum)) {
        // 踩雷终局：reveal 本列雷、全额下注进入链式分成
        const newResult = { ...r, picks: [...(r.picks || []), rowNum], bustCol: step, bustRow: rowNum, bombs: [...bombSet], status: 'bust' };
        await client.query(`UPDATE rounds SET status = 'bust', result = $2::jsonb, payout = '0.00' WHERE id = $1`, [round.id, JSON.stringify(newResult)]);
        await client.query(`UPDATE bets SET outcome = 'lose' WHERE round_id = $1`, [round.id]);
        const playerResult = await client.query('SELECT agent_id FROM players WHERE id = $1', [playerId]);
        const agentId = playerResult.rows[0]?.agent_id;
        if (agentId) {
          await distributeLoss(client, { playerId, agentId, roundId: round.id, lossAmount: round.bet_amount });
        }
        return { safe: false, col: step, bombs: [...bombSet], bustRow: rowNum, cum: r.cum, serverSeedHash: round.result_hash, clientSeed: round.client_seed, nonce: r.nonce, roundId: round.id };
      }

      // 安全：累乘、推进
      const newStep = step + 1;
      const newCum = r.cum * goalStepMult(tier);
      const newPicks = [...(r.picks || []), rowNum];
      // 单V3b：已走列的雷行追加落库，供本地重算比对（cashed 局原本一列雷行都没有 → 无验证靶）。
      // 不变量：【未来列】雷行永不落库（本列此刻已走完，属"过去"，无提款机价值；各列熵独立，
      //   知道前面列推不出后面列）。活局期由 safeResultForView 的 goal 白名单剥除本字段
      //   —— 白名单【禁】加 bombRows，那是本补落安全的前提。
      const newBombRows = [...(r.bombRows || []), [...bombSet]];

      if (newStep >= GOAL_COLS) {
        // 走满 7 列自动结算（钳制 cap——别漏！照 mines 揭满后门教训）
        const payoutResult = await client.query(
          'SELECT LEAST(round($1::numeric * $2::numeric, 2), $3::numeric) AS payout',
          [round.bet_amount, String(newCum), String(maxPayoutFor('goal'))]
        );
        const payout = payoutResult.rows[0].payout;
        const { balanceAfter } = await credit(client, {
          playerId,
          amount: payout,
          type: 'goal_payout',
          idempotencyKey: `goal-cash-${round.id}`,
          roundId: round.id,
        });
        const newResult = { ...r, picks: newPicks, cum: newCum, step: newStep, bombRows: newBombRows, status: 'cashed' };
        await client.query(`UPDATE rounds SET status = 'cashed', result = $2::jsonb, payout = $3::numeric WHERE id = $1`, [round.id, JSON.stringify(newResult), payout]);
        await client.query(`UPDATE bets SET outcome = 'win' WHERE round_id = $1`, [round.id]);
        return { safe: true, cleared: true, col: step, mult: newCum, cum: newCum, payout, balanceAfter, serverSeedHash: round.result_hash, clientSeed: round.client_seed, nonce: r.nonce, roundId: round.id };
      }

      // 未走满：只落地进度（本列雷行随 bombRows 落库，但活局期被白名单剥除，前端看不到）
      const newResult = { ...r, picks: newPicks, cum: newCum, step: newStep, bombRows: newBombRows };
      await client.query(`UPDATE rounds SET result = $2::jsonb WHERE id = $1`, [round.id, JSON.stringify(newResult)]);
      return { safe: true, cleared: false, col: step, mult: newCum, cum: newCum, step: newStep };
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
// POST /round/goal/cashout —— 任意列兑现：payout = 钳制(bet × cum, cap)
// ------------------------------------------------------------------
router.post('/goal/cashout', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const { roundId } = req.body || {};
    if (!roundId) {
      return res.status(400).json({ error: '参数不完整：roundId 必填' });
    }

    const result = await withTransaction(async (client) => {
      const round = await lockGoalRound(client, roundId, playerId);
      const r = round.result || {};

      if (round.status === 'bust') {
        throw httpError(400, '该局已踩雷结束，无法兑现');
      }
      if (round.status === 'cashed') {
        return { payout: round.payout, balanceAfter: await getBalance(playerId), cum: r.cum, serverSeedHash: round.result_hash, clientSeed: round.client_seed, nonce: r.nonce, roundId: round.id, alreadyDone: true };
      }

      // status === 'playing'：钳制型 cap（不作废赢局）
      const payoutResult = await client.query(
        'SELECT LEAST(round($1::numeric * $2::numeric, 2), $3::numeric) AS payout',
        [round.bet_amount, String(r.cum), String(maxPayoutFor('goal'))]
      );
      const payout = payoutResult.rows[0].payout;
      const { balanceAfter } = await credit(client, {
        playerId,
        amount: payout,
        type: 'goal_payout',
        idempotencyKey: `goal-cash-${round.id}`,
        roundId: round.id,
      });
      const newResult = { ...r, status: 'cashed' };
      await client.query(`UPDATE rounds SET status = 'cashed', payout = $2::numeric, result = $3::jsonb WHERE id = $1`, [round.id, payout, JSON.stringify(newResult)]);
      await client.query(`UPDATE bets SET outcome = 'win' WHERE round_id = $1`, [round.id]);

      return { payout, balanceAfter, cum: r.cum, serverSeedHash: round.result_hash, clientSeed: round.client_seed, nonce: r.nonce, roundId: round.id };
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
  // goal：tier(公开)/已过列选行/累乘/步数/nonce（雷行按列现派、result 本就无未来雷位；白名单为纵深防御）
  goal: ['tier', 'picks', 'cum', 'step', 'nonce', 'status'],
  // rollingball：已开球 + 逐球结算（按步现派，result 本就无未开球）；白名单为纵深防御
  rollingball: ['revealed', 'balls', 'status'],
};
const TERMINAL_STATUSES = new Set(['settled', 'cashed', 'bust']);

// 终局（settled/cashed/bust）给全 result（此刻雷位/牌序公开无所谓，正好供验证）；
// 非终局（playing/pending）按游戏白名单只挑安全字段，未知游戏一律不给 result 细节。
function safeResultForView(game, status, result) {
  if (!result) return result;
  if (TERMINAL_STATUSES.has(status)) return result;
  // #公期化 单1a 闸2：全服公期局（result.v===2，滚球六段制）非终局【整个 result 字段都不返】。
  //   为什么比白名单更狠：公期局是全场共享的一局，任何一个玩家提前多知道半颗球都是全场性事故；
  //   库里 result 本就只含已开球（roundHub persistRevealed 逐球落，裁定②），这层是纵深防御第二道。
  //   ⚠ 只掐 v===2 的公期局：老 per-player 滚球局（无 v 字段，status='playing'）照走下面的白名单，
  //     进行中局面照常显示，零回归；终局验公平走上面 TERMINAL_STATUSES 全返，也照旧。
  if (result.v === 2) return null;
  const allow = PLAYING_RESULT_WHITELIST[game];
  if (!allow) return null;
  const out = {};
  for (const k of allow) if (k in result) out[k] = result[k];
  return out;
}

// ------------------------------------------------------------------
// GET /round/history/:game —— 9 款轮次彩「开奖历史」（公开开奖结果，供顶栏历史抽屉）
// requireAuth（登录即可，不限 type）；game 白名单防注入/枚举其它款。
// 只出 settled 且 round_no 非空的局；keyset cursor（id < cursor）+ limit(1–50，默认 20)。
// 返 {id, roundNo, drawResult, serverSeedHash, clientSeed, serverSeed, nonce, createdAt}
// —— settled 即已揭晓，serverSeed 明文可出（供行内 commit-reveal 验证）；nonce 未落库返 null。
// 严禁带任何注单/资金字段（bet_amount / payout / player_id 一律不出）。
// 两段路径，不与下方单段 /:id 冲突；置于其前更稳。
// ------------------------------------------------------------------
const HISTORY_GAMES = new Set([
  'speedgrid', 'numberup', 'derbyday', 'dominoduel', 'hattrick',
  'goldenboot', 'halftime', 'wuxing', 'lineup',
]);
// #42 多房：?room=<房段> 可选。
//   · 不传 → 该款【标准房】单流（COALESCE(room,'30s') = '30s'）——旧前端零碰，行为与房化前一致。
//   · 传了 → 该房单流。
//   ⚠ 两房永不混流：本端点是右栏近期开奖 / HistoryDrawer / 多桌珠盘路的【单一数据源】
//     （GameSideRail 注明），混流 = 路珠错乱，是房化最硬的连带面（D 段 g 表唯一的外部硬骨头）。
//   ⚠ COALESCE 归一不可省：老局 room IS NULL（房化前落的），裸 `room = '30s'` 会把它们全漏掉，
//     右栏一上线就空一半。
const DEFAULT_ROOM = '30s';
router.get('/history/:game', requireAuth, async (req, res, next) => {
  try {
    const { game } = req.params;
    if (!HISTORY_GAMES.has(game)) {
      return res.status(400).json({ error: '该游戏不支持开奖历史' });
    }
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 20;
    const cursor = /^\d+$/.test(String(req.query.cursor ?? '')) ? String(req.query.cursor) : null;
    // room 参：只收短标识（防注入 + 防拿它当任意过滤器）；缺省=标准房
    const rawRoom = String(req.query.room ?? '').trim();
    const room = /^[a-z0-9]{1,8}$/.test(rawRoom) ? rawRoom : DEFAULT_ROOM;
    const result = await query(
      `SELECT id, round_no, result, result_hash, client_seed, server_seed, created_at
         FROM rounds
        WHERE game = $1 AND status = 'settled' AND round_no IS NOT NULL
          AND COALESCE(room, $4) = $5
          AND ($2::bigint IS NULL OR id < $2)
        ORDER BY id DESC LIMIT $3`,
      // $4 = 默认房【常量】，$5 = 请求的房。
      // ⚠ 两者必须分开传：写成 COALESCE(room,$4)=$4 的话，room IS NULL 时 COALESCE 返回 $4、
      //   恒等于 $4 → 老局匹配【任何】房，?room=15s 会把老局全捞进来 —— 正是要防的混流。
      [game, cursor, limit, DEFAULT_ROOM, room],
    );
    // settled 局 = 已揭晓，可出 server_seed 明文（照 GET /:id 的 settled 白名单口径）+ 承诺/公开种子，
    // 供前端行内 commit-reveal 验证（sha256(serverSeed)==serverSeedHash）。禁出任何注单/资金字段。
    // 单V1：nonce 现随 result JSONB 落库（roundHub reveal），此处直读透出；
    // 公平链升级前的老局 result 无 nonce 字段 → ?? null（前端显「该局早于公平链升级」）。
    const items = result.rows.map((r) => ({
      id: r.id,
      roundNo: r.round_no,
      drawResult: r.result?.drawResult ?? null,
      serverSeedHash: r.result_hash,
      clientSeed: r.client_seed,
      serverSeed: r.server_seed,
      nonce: r.result?.nonce ?? null,
      createdAt: r.created_at,
    }));
    const nextCursor = items.length === limit ? items[items.length - 1].id : null;
    return res.json({ items, nextCursor });
  } catch (err) {
    return next(err);
  }
});

// ------------------------------------------------------------------
// GET /round/:id —— 查询单局详情
// ------------------------------------------------------------------
// 归属校验（单V3b）：只给【本人】的局。原先 WHERE 只按 id 查，任何登录玩家都能拉任意人的局
//   —— 终态局给全 result（雷位/牌序全在里面），等于随便翻别人的账。
//   他人局/不存在一律回同一句 404（不区分，防按 id 枚举探测他人局是否存在）。
//   agent 类 token 也走本分支：其 sub 是 agent_id，与 rounds.player_id 天然对不上 → 一律 404，
//   代理要看局请走 /agent/* 报表路径，不从玩家局详情端点绕。
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const playerId = req.user.sub;
    // 模型 A：绝不吐 server_seed 明文（只给 result_hash）。明文要走 /seed/rotate 才 reveal。
    const result = await query(
      `SELECT r.id, r.game, r.player_id, r.bet_amount, r.payout, r.status, r.result,
              r.client_seed, r.result_hash, r.created_at,
              b.id AS bet_id, b.outcome AS bet_outcome, b.idempotency_key
         FROM rounds r
         LEFT JOIN bets b ON b.round_id = r.id
        WHERE r.id = $1 AND r.player_id = $2`,
      [id, playerId]
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
