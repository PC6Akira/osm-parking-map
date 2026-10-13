/**
 * 认证接口：注册 / 登录 / 当前用户
 *  - 注册仅开放普通用户（role 固定 user），管理员由初始化脚本预置
 *  - 登录：管理员需额外校验 ADMIN_SECRET；按用户名做失败限流
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 登录失败限流（内存 Map，单进程课程项目足够）
const MAX_FAILURES = 5;     // 连续失败次数阈值
const LOCK_SECONDS = 60;    // 锁定时长（秒）
const failures = new Map(); // username -> { count, lockedUntil }

function lockedSeconds(username) {
  const rec = failures.get(username);
  if (rec && rec.lockedUntil > Date.now()) {
    return Math.ceil((rec.lockedUntil - Date.now()) / 1000);
  }
  return 0;
}

function recordFailure(username) {
  const rec = failures.get(username) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_FAILURES) {
    rec.lockedUntil = Date.now() + LOCK_SECONDS * 1000;
    rec.count = 0;
  }
  failures.set(username, rec);
}

function recordSuccess(username) {
  failures.delete(username);
}

function sign(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, real_name: user.real_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
}

/** 注册：仅普通用户（管理员不开放注册） */
router.post('/register', async (req, res, next) => {
  try {
    const { username, password, real_name } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '用户名与密码为必填项' });
    if (String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });

    const hash = await bcrypt.hash(String(password), 10);
    const { rows } = await db.query(
      `INSERT INTO app_user (username, password_hash, role, real_name)
       VALUES ($1, $2, 'user', $3)
       RETURNING id, username, role, real_name`,
      [username, hash, real_name || null],
    );
    const user = rows[0];
    res.status(201).json({ token: sign(user), user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '用户名已存在' });
    next(err);
  }
});

/** 登录 */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password, admin_key } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '用户名与密码为必填项' });

    const locked = lockedSeconds(username);
    if (locked) return res.status(429).json({ error: `失败次数过多，请 ${locked} 秒后重试` });

    const { rows } = await db.query(
      'SELECT id, username, password_hash, role, real_name FROM app_user WHERE username = $1',
      [username],
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
      recordFailure(username);
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 管理员额外密钥
    if (user.role === 'admin' && admin_key !== process.env.ADMIN_SECRET) {
      recordFailure(username);
      return res.status(401).json({ error: '管理员密钥错误' });
    }

    recordSuccess(username);
    const { password_hash, ...safeUser } = user;
    res.json({ token: sign(safeUser), user: safeUser });
  } catch (err) { next(err); }
});

/** 当前登录用户 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, username, role, real_name FROM app_user WHERE id = $1',
      [req.user.id],
    );
    if (!rows.length) return res.status(401).json({ error: '用户不存在' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
