/**
 * 基于 OpenStreetMap 的停车场车位地图管理系统 —— 服务入口
 * 专业课程设计II 题目2
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();

app.use(cors());
app.use(express.json());
// 静态资源：前端页面
app.use(express.static(path.join(__dirname, '..', 'public')));

/** 健康检查：数据库不可用也不影响静态页访问 */
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'up' });
  } catch (err) {
    res.json({ status: 'ok', db: 'down', error: err.message });
  }
});

// 认证路由（注册 / 登录 / 当前用户）
app.use('/api/auth', require('./routes/auth'));

// 业务路由
app.use('/api/lots', require('./routes/lots'));
app.use('/api/spaces', require('./routes/spaces'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/route', require('./routes/route'));

// 未匹配的 API 返回 404
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

// 统一错误处理
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`服务已启动: http://localhost:${PORT}`);
  console.log(`用户端:     http://localhost:${PORT}/index.html`);
  console.log(`管理端:     http://localhost:${PORT}/admin.html`);
});
