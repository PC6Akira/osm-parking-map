/**
 * 车位接口
 *  - 数据管理：车位增删改查（空间点为 PostGIS geometry(Point,4326)）
 *  - 车位搜索：视口(bbox)过滤、按状态/关键字过滤、附近空闲车位(按距离)
 *  - 租用/释放：改变车位状态并写入 rental 记录
 */
const express = require('express');
const db = require('../db');
const { featureCollection, feature } = require('../geo');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const SELECT_SPACE = `
  SELECT s.id, s.lot_id, s.code, s.status, s.price_per_hour, s.vehicle_type,
         s.updated_at, l.name AS lot_name,
         ST_AsGeoJSON(s.geom)::json AS geometry
  FROM parking_space s
  JOIN parking_lot l ON l.id = s.lot_id`;

/**
 * 车位搜索
 * query: bbox=minx,miny,maxx,maxy | status=free | lot_id=1 | q=关键字
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { bbox, status, lot_id, q } = req.query;
    const where = [];
    const params = [];

    if (bbox) {
      const nums = bbox.split(',').map(Number);
      if (nums.length === 4 && nums.every((n) => !Number.isNaN(n))) {
        params.push(...nums);
        const n = params.length;
        // 视口过滤：用 && 走 GIST 索引
        where.push(`s.geom && ST_MakeEnvelope($${n - 3}, $${n - 2}, $${n - 1}, $${n}, 4326)`);
      }
    }
    if (status) { params.push(status); where.push(`s.status = $${params.length}`); }
    if (lot_id) { params.push(Number(lot_id)); where.push(`s.lot_id = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(s.code ILIKE $${params.length} OR l.name ILIKE $${params.length})`);
    }

    const sql = `${SELECT_SPACE}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY s.lot_id, s.code`;
    const { rows } = await db.query(sql, params);
    res.json(featureCollection(rows));
  } catch (err) { next(err); }
});

/**
 * 车位搜索（附近空闲车位）
 * query: lat, lng, radius(米,默认1000), status(可选), limit(默认20)
 * 用 ST_DWithin 做半径过滤（地理距离，单位米），用 KNN(<->) 排序命中 GIST 索引
 */
router.get('/nearby', requireAuth, async (req, res, next) => {
  try {
    const lng = Number(req.query.lng);
    const lat = Number(req.query.lat);
    if (Number.isNaN(lng) || Number.isNaN(lat)) {
      return res.status(400).json({ error: 'lat 与 lng 为必填项' });
    }
    const radius = Number(req.query.radius) || 1000;
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const params = [lng, lat, radius];
    let extra = '';
    if (req.query.status) { params.push(req.query.status); extra = `AND s.status = $${params.length}`; }
    params.push(limit);

    const sql = `
      SELECT s.id, s.code, s.status, s.price_per_hour, s.vehicle_type,
             l.name AS lot_name,
             round(ST_Distance(s.geom::geography,
                   ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)::numeric, 1) AS distance_m,
             ST_AsGeoJSON(s.geom)::json AS geometry
      FROM parking_space s
      JOIN parking_lot l ON l.id = s.lot_id
      WHERE ST_DWithin(s.geom::geography,
                       ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
      ${extra}
      ORDER BY s.geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
      LIMIT $${params.length}`;
    const { rows } = await db.query(sql, params);
    res.json(featureCollection(rows));
  } catch (err) { next(err); }
});

/** 查询单个车位 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(`${SELECT_SPACE} WHERE s.id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '车位不存在' });
    res.json(feature(rows[0]));
  } catch (err) { next(err); }
});

/** 新增车位：body = { lot_id, code, status, price_per_hour, vehicle_type, geometry(Point) } */
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { lot_id, code, status, price_per_hour, vehicle_type, geometry } = req.body;
    if (!lot_id || !code || !geometry) {
      return res.status(400).json({ error: 'lot_id、code、geometry 为必填项' });
    }
    const { rows } = await db.query(
      `INSERT INTO parking_space (lot_id, code, geom, status, price_per_hour, vehicle_type)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4, $5, $6)
       RETURNING id, lot_id, code, status, price_per_hour, vehicle_type,
                 ST_AsGeoJSON(geom)::json AS geometry`,
      [lot_id, code, JSON.stringify(geometry), status || 'free',
        Number(price_per_hour) || 0, vehicle_type || '小型车'],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '该停车场下车位标识已存在' });
    next(err);
  }
});

/** 修改车位 */
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { code, status, price_per_hour, vehicle_type, lot_id, geometry } = req.body;
    const { rows } = await db.query(
      `UPDATE parking_space SET
         code           = COALESCE($2, code),
         status         = COALESCE($3, status),
         price_per_hour = COALESCE($4, price_per_hour),
         vehicle_type   = COALESCE($5, vehicle_type),
         lot_id         = COALESCE($6, lot_id),
         geom           = COALESCE(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), geom),
         updated_at     = now()
       WHERE id = $1
       RETURNING id, lot_id, code, status, price_per_hour, vehicle_type,
                 ST_AsGeoJSON(geom)::json AS geometry`,
      [req.params.id, code ?? null, status ?? null,
        price_per_hour === undefined ? null : Number(price_per_hour),
        vehicle_type ?? null,
        lot_id === undefined ? null : Number(lot_id),
        geometry ? JSON.stringify(geometry) : null],
    );
    if (!rows.length) return res.status(404).json({ error: '车位不存在' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/** 删除车位 */
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await db.query('DELETE FROM parking_space WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: '车位不存在' });
    res.status(204).end();
  } catch (err) { next(err); }
});

/**
 * 租用车位：把状态置为 occupied，并写入一条进行中的租用记录
 * 需登录；租用人取自当前登录用户
 */
router.post('/:id/rent', requireAuth, async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT status FROM parking_space WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: '车位不存在' }); }
    if (cur.rows[0].status !== 'free') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '该车位当前不可租用' });
    }
    await client.query(
      `INSERT INTO rental (space_id, user_id, renter_name, status)
       VALUES ($1, $2, $3, 'active')`,
      [req.params.id, req.user.id, req.user.real_name || req.user.username],
    );
    const { rows } = await client.query(
      `UPDATE parking_space SET status = 'occupied', updated_at = now()
       WHERE id = $1
       RETURNING id, lot_id, code, status, price_per_hour, vehicle_type,
                 ST_AsGeoJSON(geom)::json AS geometry`,
      [req.params.id],
    );
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/** 释放车位：状态置为 free，并结束进行中的租用记录 */
router.post('/:id/release', requireAuth, async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE rental SET status = 'finished', end_time = now()
       WHERE space_id = $1 AND status = 'active'`,
      [req.params.id],
    );
    const { rows } = await client.query(
      `UPDATE parking_space SET status = 'free', updated_at = now()
       WHERE id = $1
       RETURNING id, lot_id, code, status, price_per_hour, vehicle_type,
                 ST_AsGeoJSON(geom)::json AS geometry`,
      [req.params.id],
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: '车位不存在' }); }
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
