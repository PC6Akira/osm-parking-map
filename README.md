# 基于 OpenStreetMap 的停车场车位地图管理系统

专业课程设计II · 题目2

使用 PostgreSQL + PostGIS 存储车位地理空间数据，Node.js + Express 提供 REST 接口，
Leaflet 加载 OpenStreetMap 瓦片实现车位展示、搜索与导航。

---

## 一、功能概览

| 模块 | 说明 |
|---|---|
| 数据管理 | 停车场（面）/ 车位（点）的增、删、改、查，空间数据由 PostGIS 存储并建 GIST 索引 |
| 地图展示 | Leaflet + OSM 瓦片；停车场画面、车位点按状态着色（空闲/占用/预约/停用） |
| 车位搜索 | 按状态、停车场、关键字过滤；"附近空闲车位"按地理距离（米）排序 |
| 车位导航 | 浏览器定位 → 目标车位；服务端经 OSRM 计算驾车路线，失败时降级直线估算 |

## 二、目录结构

```
OSMParking/
├─ package.json
├─ .env.example          配置样例（复制为 .env 后修改）
├─ db/
│  ├─ schema.sql         建表 + PostGIS 扩展 + 索引
│  └─ seed.sql           示例数据（南邮仙林校区周边）
├─ scripts/initdb.js     一键建库 + 建表 + 灌数据
├─ server/
│  ├─ index.js           Express 入口
│  ├─ db.js              连接池
│  ├─ geo.js             GeoJSON 工具
│  └─ routes/            lots / spaces / stats / route 接口
└─ public/
   ├─ index.html         用户端（地图 / 搜索 / 导航）
   ├─ admin.html         管理端（数据管理）
   ├─ css/style.css
   └─ js/  api.js  map.js  admin.js
```

## 三、环境要求

- Node.js ≥ 18（本项目在 v22 下开发）
- PostgreSQL 17 + PostGIS 3.x
- 现代浏览器（Chrome / Edge / Firefox）

## 四、安装 PostgreSQL + PostGIS

### Windows（EDB 安装包 + StackBuilder）

1. 到 <https://www.postgresql.org/download/windows/> 下载 **EDB 交互式安装包**，
   选择 **PostgreSQL 17**。安装过程中设置 `postgres` 超级用户密码并牢记。
2. 安装向导最后一步勾选 **Launch StackBuilder**（若未勾选，可在开始菜单单独运行）。
3. 在 StackBuilder 中依次选择：
   `Spatial Extensions` → 勾选 **PostGIS**（如 PostGIS 3.5 / 3.6）→ 一路下一步完成安装。
   - 若 StackBuilder 列表里没有 PostGIS，可到 <https://download.osgeo.org/postgis/windows/>
     下载对应 PostgreSQL 17 的 `postgis-bundle-pg17x64-setup-*.exe` 安装。
4. 安装完成后，可用 pgAdmin 或命令行确认：`psql -U postgres -c "SELECT version();"`

> 说明：`CREATE EXTENSION postgis` 需要**超级用户**权限，本项目初始化脚本以 `postgres` 用户执行。

### macOS（Postgres.app）

1. 到 <https://postgresapp.com/> 下载 **Postgres.app**，解压拖入「应用程序」后双击启动；
   菜单栏出现大象图标即表示服务已在本机 `5432` 端口运行。
2. Postgres.app **已内置 PostGIS**，无需额外安装（不必像 Windows 那样装 StackBuilder）。
3. 超级用户是**你的 macOS 用户名**（不是 `postgres`），本地连接默认**无需密码**；
   编辑 `.env`，把 `PGUSER` 改成你的 macOS 用户名、`PGPASSWORD` 留空即可。
4. 确认 PostGIS 可用（`psql` 不在 PATH 时，可点菜单栏大象图标 → 「Open psql」）：
   `psql -d postgres -c "SELECT postgis_version();"`
   若报 `database "postgres" does not exist`，先执行 `createdb postgres` 再重试。

## 五、配置与运行

```bash
# 1. 安装依赖
npm install

# 2. 配置数据库连接
#    源码包内已附带 .env（默认密码 postgres）；若你的 PostgreSQL 口令不是 postgres，
#    请编辑 .env 里的 PGPASSWORD。若没有 .env，则先复制：
cp .env.example .env        # Windows 可用：copy .env.example .env

# 3. 一键初始化数据库（创建 parking_db + 建表 + 示例数据）
npm run db:init

# 4. 启动服务
npm start
```

启动后访问：

- 登录页：<http://localhost:3000/login.html>
- 用户端：<http://localhost:3000/index.html>（需登录）
- 管理端：<http://localhost:3000/admin.html>（需管理员）
- 健康检查：<http://localhost:3000/health>

> 系统采用 JWT 强制登录：用户端需登录后访问，管理端需管理员账号。默认管理员账号
> `admin / admin123`（密码由 `.env` 的 `ADMIN_PASSWORD` 决定），管理员登录还需在登录页
> 勾选「我是管理员」并填写 `.env` 中的 `ADMIN_SECRET`。普通用户可在登录页自行注册。

> 浏览器定位（"我的位置"）在 `localhost` 下可正常使用；若通过局域网 IP 访问，需使用 HTTPS。

## 六、REST 接口

> 除 `register` / `login` 外，其余接口均需在请求头携带 `Authorization: Bearer <token>`；
> 增删改停车场/车位仅管理员可调用。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册（普通用户） |
| POST | `/api/auth/login` | 登录（管理员需附带 `admin_key`） |
| GET | `/api/auth/me` | 当前登录用户 |
| GET | `/api/lots` | 停车场列表（GeoJSON） |
| POST/PUT/DELETE | `/api/lots[/:id]` | 停车场增改删 |
| GET | `/api/spaces?bbox=&status=&lot_id=&q=` | 车位搜索（视口/状态/停车场/关键字） |
| GET | `/api/spaces/nearby?lat=&lng=&radius=&status=` | 附近车位（按距离排序，单位米） |
| GET | `/api/spaces/:id` | 车位详情 |
| POST/PUT/DELETE | `/api/spaces[/:id]` | 车位增改删 |
| POST | `/api/spaces/:id/rent` | 租用车位（改状态 + 写租用记录） |
| POST | `/api/spaces/:id/release` | 释放车位 |
| GET | `/api/stats` | 各状态车位统计 |
| GET | `/api/route?from=lng,lat&to=lng,lat` | 车位导航（OSRM 路线，含降级） |

## 七、关键技术点

- 空间列统一使用 `geometry(..., 4326)`（WGS84 经纬度），并建立 `GIST` 索引。
- 距离计算使用 `geography`（单位：米），避免"经纬度当米用"的常见错误；
  半径过滤用 `ST_DWithin`（可走索引），邻近排序用 KNN 运算符 `<->`。
- 几何的 GeoJSON 输入输出通过 `ST_GeomFromGeoJSON` / `ST_AsGeoJSON` 完成。
