/**
 * 鉴权中间件
 *  - requireAuth：校验 Authorization: Bearer <token>，通过后挂载 req.user
 *  - requireAdmin：在 requireAuth 基础上要求 role === 'admin'
 */
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录，请先登录' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: '登录已过期或无效，请重新登录' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
