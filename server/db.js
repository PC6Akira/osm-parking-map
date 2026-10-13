/**
 * 数据库连接池（node-postgres Pool）
 * 连接参数来自 .env（详见 .env.example）
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'parking_db',
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] 空闲连接异常：', err.message);
});

module.exports = {
  /** 执行一次查询 */
  query: (text, params) => pool.query(text, params),
  pool,
};
