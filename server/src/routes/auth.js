// 登录路由
// 说明：agent（代理商）和 player（玩家）共用同一个登录接口，通过 body.type 区分查哪张表。
// 密码用 bcrypt 校验，成功后签发 JWT；失败统一返回同一句提示，不泄露「用户名不存在」还是
// 「密码错误」，避免被用来枚举账号。
// 严禁在任何 console.log / 错误信息里输出明文密码或 token。
import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';

const router = Router();

const TABLE_BY_TYPE = {
  agent: 'agents',
  player: 'players',
};

router.post('/login', async (req, res, next) => {
  try {
    const { username, password, type } = req.body || {};

    if (!username || !password || !TABLE_BY_TYPE[type]) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const table = TABLE_BY_TYPE[type];
    // 参数化查询，防止 SQL 注入
    const result = await query(
      `SELECT id, username, password_hash FROM ${table} WHERE username = $1`,
      [username]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const account = result.rows[0];
    const passwordOk = await bcrypt.compare(password, account.password_hash);

    if (!passwordOk) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = jwt.sign(
      { sub: account.id, type, username: account.username },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    // 登录成功审计（只记类型和用户名，绝不记密码/token）
    // agent 登录时 actor_agent 记自己；player 登录时 audit_log 没有对应的「玩家操作者」列，
    // 这里统一记 actor_agent=NULL，在 detail 里说明具体是谁登录。
    const actorAgentId = type === 'agent' ? account.id : null;
    await query(
      `INSERT INTO audit_log (actor_agent, action, detail)
       VALUES ($1, 'login', $2::jsonb)`,
      [actorAgentId, JSON.stringify({ type, username: account.username })]
    );

    return res.json({ token, type, id: account.id, username: account.username });
  } catch (err) {
    return next(err);
  }
});

export default router;
