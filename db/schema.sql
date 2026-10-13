-- =============================================================
--  基于 OpenStreetMap 的停车场车位地图管理系统  —— 数据库结构
--  专业课程设计II  题目2
--  依赖：PostgreSQL 17 + PostGIS 3.x
--  用法：先创建数据库 parking_db，再在本库中执行本脚本
--        CREATE DATABASE parking_db;
--        \c parking_db
--        \i db/schema.sql
-- =============================================================

-- 启用 PostGIS 扩展（需超级用户权限）
CREATE EXTENSION IF NOT EXISTS postgis;

-- 按依赖关系逆序删除，便于重复执行
DROP TABLE IF EXISTS rental;
DROP TABLE IF EXISTS parking_space;
DROP TABLE IF EXISTS parking_lot;
DROP TABLE IF EXISTS app_user;

-- -------------------------------------------------------------
-- 0. 用户表（登录认证 / 角色区分）
--    role: admin 管理员 / user 普通用户；密码存 bcrypt 哈希
-- -------------------------------------------------------------
CREATE TABLE app_user (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,               -- 登录名
    password_hash VARCHAR(100) NOT NULL,                      -- bcrypt 哈希
    role          VARCHAR(10)  NOT NULL DEFAULT 'user'
                  CHECK (role IN ('admin','user')),
    real_name     VARCHAR(50),                                -- 真实姓名（租用记录用）
    created_at    TIMESTAMPTZ  DEFAULT now()
);
COMMENT ON TABLE  app_user IS '用户（管理员/普通用户）';
COMMENT ON COLUMN app_user.role IS 'admin 管理员 / user 普通用户';

-- -------------------------------------------------------------
-- 1. 停车场 / 停车区域表
--    用面(Polygon)表示停车场边界，SRID=4326（WGS84 经纬度）
-- -------------------------------------------------------------
CREATE TABLE parking_lot (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,                       -- 停车场名称
    address     VARCHAR(200),                                 -- 地址
    capacity    INTEGER       DEFAULT 0,                      -- 车位数（冗余统计）
    geom        geometry(Polygon, 4326) NOT NULL,             -- 空间范围
    created_at  TIMESTAMPTZ   DEFAULT now()
);
COMMENT ON TABLE  parking_lot IS '停车场（区域）';
COMMENT ON COLUMN parking_lot.geom IS '停车场边界，WGS84 经纬度';

-- -------------------------------------------------------------
-- 2. 车位表
--    status 用 CHECK 约束限定取值，code 为区域内车位标识
-- -------------------------------------------------------------
CREATE TABLE parking_space (
    id             SERIAL PRIMARY KEY,
    lot_id         INTEGER      NOT NULL
                   REFERENCES parking_lot(id) ON DELETE CASCADE, -- 所属停车场
    code           VARCHAR(30)  NOT NULL,                     -- 车位标识（如 A-01）
    geom           geometry(Point, 4326) NOT NULL,            -- 车位位置
    status         VARCHAR(10)  NOT NULL DEFAULT 'free'
                   CHECK (status IN ('free','occupied','reserved','disabled')),
    price_per_hour NUMERIC(6,2) DEFAULT 0,                    -- 每小时价格（元）
    vehicle_type   VARCHAR(20)  DEFAULT '小型车',
    updated_at     TIMESTAMPTZ  DEFAULT now(),
    UNIQUE (lot_id, code)                                     -- 同一场内标识唯一
);
COMMENT ON TABLE  parking_space IS '车位';
COMMENT ON COLUMN parking_space.status IS 'free 空闲 / occupied 占用 / reserved 已预约 / disabled 停用';

-- -------------------------------------------------------------
-- 3. 租用记录表
--    记录车位的租用历史，用于体现“租用状态”与使用统计
-- -------------------------------------------------------------
CREATE TABLE rental (
    id          SERIAL PRIMARY KEY,
    space_id    INTEGER     NOT NULL
                REFERENCES parking_space(id) ON DELETE CASCADE,
    user_id     INTEGER
                REFERENCES app_user(id) ON DELETE SET NULL,   -- 关联登录用户
    renter_name VARCHAR(50),                                  -- 租用人（冗余）
    start_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_time    TIMESTAMPTZ,
    status      VARCHAR(12) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','finished','cancelled')),
    created_at  TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE rental IS '车位租用记录';

-- -------------------------------------------------------------
-- 4. 索引：空间列使用 GIST，支撑 KNN(<->) 与 ST_DWithin 快速检索
-- -------------------------------------------------------------
CREATE INDEX idx_lot_geom     ON parking_lot   USING GIST (geom);
CREATE INDEX idx_space_geom   ON parking_space USING GIST (geom);
CREATE INDEX idx_space_status ON parking_space (status);
CREATE INDEX idx_space_lot    ON parking_space (lot_id);
CREATE INDEX idx_rental_space ON rental (space_id);
