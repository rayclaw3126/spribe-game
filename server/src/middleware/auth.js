// 鉴权中间件
// 说明：解析 `Authorization: Bearer <token>`，用 JWT_SECRET 校验签名，
// 校验通过后把 payload（sub/type/username）挂到 req.user 上供后续路由使用。
// 严禁在任何日志里打印 token 原文或密码。
import jwt from 'jsonwebtoken';

/**
 * 通用鉴权：要求请求携带有效的 JWT。
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: '缺少或无效的登录凭证' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // payload 结构：{ sub, type, username, iat, exp }
    req.user = payload;
    return next();
  } catch (err) {
    // 不打印 token 本身，只记录校验失败这一事实
    return res.status(401).json({ error: '登录凭证无效或已过期' });
  }
}

/**
 * 角色校验中间件工厂：要求 req.user.type 必须等于指定类型（'agent' | 'player'）。
 * 必须放在 requireAuth 之后使用。
 */
export function requireType(type) {
  return (req, res, next) => {
    if (!req.user || req.user.type !== type) {
      return res.status(401).json({ error: '当前身份无权访问该接口' });
    }
    return next();
  };
}
