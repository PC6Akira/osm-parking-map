-- =============================================================
--  示例数据：南京邮电大学仙林校区周边停车场与车位
--  专业课程设计II  题目2
--  用法：\i db/seed.sql   （在 parking_db 中执行）
-- =============================================================

-- 清空旧数据
TRUNCATE rental, parking_space, parking_lot RESTART IDENTITY CASCADE;

-- -------------------------------------------------------------
-- 停车场（多边形边界，WGS84）
-- WKT 中坐标顺序为 经度 纬度（lng lat）
-- -------------------------------------------------------------
INSERT INTO parking_lot (name, address, geom) VALUES
('图书馆地下停车场', '南京市栖霞区文苑路9号 图书馆',
 ST_GeomFromText('POLYGON((118.93700 32.11700, 118.94000 32.11700, 118.94000 32.11850, 118.93700 32.11850, 118.93700 32.11700))', 4326)),
('教学楼南侧停车区', '南京市栖霞区文苑路9号 教一楼',
 ST_GeomFromText('POLYGON((118.94000 32.11750, 118.94250 32.11750, 118.94250 32.11900, 118.94000 32.11900, 118.94000 32.11750))', 4326)),
('体育馆西侧停车场', '南京市栖霞区文苑路9号 体育馆',
 ST_GeomFromText('POLYGON((118.93500 32.11600, 118.93700 32.11600, 118.93700 32.11750, 118.93500 32.11750, 118.93500 32.11600))', 4326));

-- -------------------------------------------------------------
-- 车位：按栅格在停车场内生成，状态循环出现以便演示搜索/筛选
-- -------------------------------------------------------------
-- 停车场1：4 列 × 3 行 = 12 个车位，标识 A-01..A-12
INSERT INTO parking_space (lot_id, code, geom, status, price_per_hour)
SELECT 1,
       'A-' || lpad(n::text, 2, '0'),
       ST_SetSRID(ST_MakePoint(
           118.93738 + ((n - 1) % 4) * 0.00075,
           32.11730 + ((n - 1) / 4) * 0.00055), 4326),
       (ARRAY['free','free','occupied','reserved','free','disabled'])[((n - 1) % 6) + 1],
       3.00
FROM generate_series(1, 12) AS n;

-- 停车场2：4 列 × 3 行 = 12 个车位，标识 B-01..B-12
INSERT INTO parking_space (lot_id, code, geom, status, price_per_hour)
SELECT 2,
       'B-' || lpad(n::text, 2, '0'),
       ST_SetSRID(ST_MakePoint(
           118.94050 + ((n - 1) % 4) * 0.00060,
           32.11780 + ((n - 1) / 4) * 0.00055), 4326),
       (ARRAY['free','occupied','free','free','reserved','free'])[((n - 1) % 6) + 1],
       2.50
FROM generate_series(1, 12) AS n;

-- 停车场3：3 列 × 3 行 = 9 个车位，标识 C-01..C-09
INSERT INTO parking_space (lot_id, code, geom, status, price_per_hour)
SELECT 3,
       'C-' || lpad(n::text, 2, '0'),
       ST_SetSRID(ST_MakePoint(
           118.93540 + ((n - 1) % 3) * 0.00060,
           32.11630 + ((n - 1) / 3) * 0.00055), 4326),
       (ARRAY['free','free','reserved','free','occupied','disabled'])[((n - 1) % 6) + 1],
       2.00
FROM generate_series(1, 9) AS n;

-- -------------------------------------------------------------
-- 租用记录示例：为部分“占用/预约”车位补一条进行中的租用记录
-- -------------------------------------------------------------
INSERT INTO rental (space_id, renter_name, start_time, end_time, status)
SELECT s.id, '张同学',
       now() - interval '1 hour', now() + interval '2 hour', 'active'
FROM parking_space s
WHERE s.status = 'occupied'
LIMIT 3;

-- 已结束的历史记录
INSERT INTO rental (space_id, renter_name, start_time, end_time, status)
SELECT s.id, '李同学',
       now() - interval '2 day', now() - interval '2 day' + interval '3 hour', 'finished'
FROM parking_space s
WHERE s.status = 'free'
LIMIT 2;

-- -------------------------------------------------------------
-- 回填停车场容量（车位数）
-- -------------------------------------------------------------
UPDATE parking_lot l
SET capacity = (SELECT count(*) FROM parking_space s WHERE s.lot_id = l.id);

-- 校验
SELECT l.id, l.name, l.capacity,
       count(s.id) AS spaces,
       count(s.id) FILTER (WHERE s.status = 'free') AS free_spaces
FROM parking_lot l
LEFT JOIN parking_space s ON s.lot_id = l.id
GROUP BY l.id, l.name, l.capacity
ORDER BY l.id;
