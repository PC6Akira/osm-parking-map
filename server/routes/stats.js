/**
 * 统计接口：各状态车位数量，用于首页数据面板
 */
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        (SELECT count(*) FROM parking_lot)                                    AS lots,
        (SELECT count(*) FROM parking_space)                                  AS spaces,
        (SELECT count(*) FROM parking_space WHERE status = 'free')            AS free,
        (SELECT count(*) FROM parking_space WHERE status = 'occupied')        AS occupied,
        (SELECT count(*) FROM parking_space WHERE status = 'reserved')        AS reserved,
        (SELECT count(*) FROM parking_space WHERE status = 'disabled')        AS disabled,
        (SELECT count(*) FROM rental WHERE status = 'active')                 AS active_rentals`);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
