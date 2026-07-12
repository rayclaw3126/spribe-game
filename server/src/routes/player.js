// 玩家自助只读接口
// 说明：GET /me 返回钱包余额；GET /ledger 资金流水、GET /bets 投注记录（玩家自查账单）。
// 全部纯只读 SELECT，不碰任何资金写路径；playerId 只从 token（req.user.sub）取，绝不收
// query 参数，杜绝越权查他人数据。分页用 keyset cursor（id < cursor），比 OFFSET 稳。
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireType } from '../middleware/auth.js';

const router = Router();

// limit 钳制到 1–50，防一次拉爆；非法/缺省取 20
function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 20;
  return Math.min(50, Math.max(1, n));
}
// cursor：合法正整数才透传（pg 转 bigint），否则 null（首页）
function parseCursor(raw) {
  if (raw == null || raw === '') return null;
  return /^\d+$/.test(String(raw)) ? String(raw) : null;
}

// GET /player/me —— 玩家自己的钱包余额（只读，参数化查询）
router.get('/me', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const result = await query('SELECT balance FROM wallets WHERE player_id = $1', [playerId]);
    const balance = result.rowCount > 0 ? result.rows[0].balance : '0.00';
    return res.json({ balance });
  } catch (err) {
    return next(err);
  }
});

// GET /player/ledger?limit=20&cursor=<id> —— 资金流水（含全 21 款 _bet/_payout + deposit/withdraw）
router.get('/ledger', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;                 // 只从 token 取，不收 query，杜绝越权
    const limit = clampLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);
    const result = await query(
      `SELECT id, type, amount, balance_before, balance_after, round_id, created_at
       FROM ledger
       WHERE player_id = $1 AND ($2::bigint IS NULL OR id < $2)
       ORDER BY id DESC LIMIT $3`,
      [playerId, cursor, limit],
    );
    const items = result.rows;
    const nextCursor = items.length === limit ? items[items.length - 1].id : null;
    return res.json({ items, nextCursor });
  } catch (err) {
    return next(err);
  }
});

// GET /player/bets?limit=20&cursor=<id> —— 投注记录（注单 + 游戏名 + 结果；不返 r.result，最小暴露）
router.get('/bets', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const limit = clampLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);
    const result = await query(
      `SELECT b.id, b.amount, b.outcome, b.created_at, r.game, r.payout
       FROM bets b JOIN rounds r ON b.round_id = r.id
       WHERE b.player_id = $1 AND ($2::bigint IS NULL OR b.id < $2)
       ORDER BY b.id DESC LIMIT $3`,
      [playerId, cursor, limit],
    );
    const items = result.rows;
    const nextCursor = items.length === limit ? items[items.length - 1].id : null;
    return res.json({ items, nextCursor });
  } catch (err) {
    return next(err);
  }
});

export default router;
