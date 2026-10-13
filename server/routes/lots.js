/**
 * 停车场（区域）接口
 * 数据管理：停车场的增、删、改、查（空间数据用 PostGIS 存储/输出）
 */
const express = require('express');
const db = require('../db');
const { featureCollection, feature } = require('../geo');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const SELECT_LOT = `
  SELECT l.id, l.name, l.address, l.capacity, l.created_at,
         ST_AsGeoJSON(l.geom)::json AS geometry,
         (SELECT count(*) FROM parking_space s WHERE s.lot_id = l.id) AS space_count,
         (SELECT count(*) FROM parking_space s
            WHERE s.lot_id = l.id AND s.status = 'free') AS free_count
  FROM parking_lot l`;

/** 查询全部停车场（GeoJSON） */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(`${SELECT_LOT} ORDER BY l.id`);
    res.json(featureCollection(rows));
  } catch (err) { next(err); }
});

/** 查询单个停车场 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(`${SELECT_LOT} WHERE l.id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '停车场不存在' });
    res.json(feature(rows[0]));
  } catch (err) { next(err); }
});

/** 新增停车场：body = { name, address, capacity, geometry(GeoJSON Polygon) } */
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, address, capacity, geometry } = req.body;
    if (!name || !geometry) return res.status(400).json({ error: 'name 与 geometry 为必填项' });
    const { rows } = await db.query(
      `INSERT INTO parking_lot (name, address, capacity, geom)
       VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))
       RETURNING id, name, address, capacity,
                 ST_AsGeoJSON(geom)::json AS geometry`,
      [name, address || null, Number(capacity) || 0, JSON.stringify(geometry)],
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

/** 修改停车场 */
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, address, capacity, geometry } = req.body;
    const { rows } = await db.query(
      `UPDATE parking_lot SET
         name     = COALESCE($2, name),
         address  = COALESCE($3, address),
         capacity = COALESCE($4, capacity),
         geom     = COALESCE(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), geom)
       WHERE id = $1
       RETURNING id, name, address, capacity,
                 ST_AsGeoJSON(geom)::json AS geometry`,
      [req.params.id, name ?? null, address ?? null,
        capacity === undefined ? null : Number(capacity),
        geometry ? JSON.stringify(geometry) : null],
    );
    if (!rows.length) return res.status(404).json({ error: '停车场不存在' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/** 删除停车场（级联删除其车位与租用记录） */
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await db.query('DELETE FROM parking_lot WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: '停车场不存在' });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
