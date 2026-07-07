// 玩家自助只读接口
// 说明：目前只提供 GET /me，返回玩家自己的钱包余额，供前端即时游戏（Dice/Aviator）
// 刷新页面后恢复 serverBalance 初值（登录接口只在「输密码登录」那一刻返 balance，
// 刷新时不走登录，所以需要这个只读查询兜底）。纯只读，不涉及任何资金写操作。
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireType } from '../middleware/auth.js';

const router = Router();

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

export default router;
