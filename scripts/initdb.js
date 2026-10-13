/**
 * 数据库一键初始化脚本
 *   1) 若不存在则创建数据库 parking_db
 *   2) 执行 db/schema.sql（建表 + PostGIS 扩展 + 索引）
 *   3) 执行 db/seed.sql（示例数据）
 *   4) 预置管理员账号 admin（密码 bcrypt 哈希，默认 admin123）
 *
 * 用法： node scripts/initdb.js
 * 依赖： .env 中的 PGHOST/PGPORT/PGUSER/PGPASSWORD 配置正确
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DB_NAME = process.env.PGDATABASE || 'parking_db';

async function withClient(database, fn) {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function main() {
  // 1) 连接到系统库 postgres，按需创建目标数据库
  await withClient('postgres', async (client) => {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
    if (rows.length === 0) {
      // 数据库名无法参数化，此处为受控常量
      await client.query(`CREATE DATABASE ${DB_NAME}`);
      console.log(`已创建数据库 ${DB_NAME}`);
    } else {
      console.log(`数据库 ${DB_NAME} 已存在`);
    }
  });

  // 2)+3) 连接目标库，执行 schema 与 seed
  await withClient(DB_NAME, async (client) => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    const seed = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
    console.log('执行 db/schema.sql ...');
    await client.query(schema);
    console.log('执行 db/seed.sql ...');
    const res = await client.query(seed);
    // seed 末尾的校验查询会返回结果
    const last = Array.isArray(res) ? res[res.length - 1] : res;
    if (last && last.rows) {
      console.table(last.rows);
    }

    // 预置管理员账号（密码从 ADMIN_PASSWORD 读取，默认 admin123）
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminHash = await bcrypt.hash(adminPassword, 10);
    await client.query(
      `INSERT INTO app_user (username, password_hash, role, real_name)
       VALUES ('admin', $1, 'admin', '系统管理员')`,
      [adminHash],
    );
    console.log('已预置管理员账号 admin'
      + (adminPassword === 'admin123' ? '（密码 admin123，默认值，请及时修改）' : '（密码来自 ADMIN_PASSWORD）'));

    console.log('数据库初始化完成。');
  });
}

main().catch((err) => {
  console.error('初始化失败：', err.message);
  console.error('请确认 PostgreSQL 已启动、PostGIS 已通过 StackBuilder 安装，且 .env 配置正确。');
  process.exit(1);
});
