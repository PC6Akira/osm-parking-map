/* =============================================================
 *  用户端地图：地图展示 / 车位搜索 / 车位导航
 *  专业课程设计II 题目2
 * ============================================================= */

// 强制登录：未登录跳转登录页
if (!Auth.requireLogin()) throw new Error('需要登录');

const STATUS_META = {
  free: { label: '空闲', color: '#2ecc71' },
  occupied: { label: '占用', color: '#e74c3c' },
  reserved: { label: '已预约', color: '#f1c40f' },
  disabled: { label: '停用', color: '#95a5a6' },
};

// 地图初始中心：南京邮电大学仙林校区
const CENTER = [32.1180, 118.9385];

const state = {
  user: null,            // 用户定位 [lat, lng]
  spaceById: {},         // id -> feature
  markersById: {},       // id -> circleMarker
  routeLayer: null,
  navTargetId: null,
};

/* ---------- 地图与图层 ---------- */
const map = L.map('map').setView(CENTER, 17);

L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const lotLayer = L.geoJSON(null, {
  style: { color: '#3388ff', weight: 2, fillColor: '#3388ff', fillOpacity: 0.08 },
  onEachFeature: (f, layer) => layer.bindTooltip(
    `${f.properties.name}（空位 ${f.properties.free_count} / 共 ${f.properties.space_count}）`,
    { sticky: true },
  ),
}).addTo(map);

const spaceLayer = L.layerGroup().addTo(map);
const userLayer = L.layerGroup().addTo(map);

/* ---------- 工具函数 ---------- */
function toast(msg, isErr) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 3200);
}

function fmtDuration(sec) {
  if (sec < 60) return `${Math.round(sec)} 秒`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

function popupHtml(p) {
  const meta = STATUS_META[p.status] || STATUS_META.disabled;
  const rentBtn = p.status === 'free'
    ? `<button class="p-primary" onclick="app.rentById(${p.id})">租用</button>`
    : (p.status === 'occupied'
      ? `<button class="p-warn" onclick="app.releaseById(${p.id})">释放</button>` : '');
  return `<div class="popup">
    <div class="p-title">车位 ${p.code}</div>
    <div class="p-row">${p.lot_name}</div>
    <div class="p-row">状态：<span class="dot ${p.status}"></span>${meta.label}</div>
    <div class="p-row">价格：￥${Number(p.price_per_hour).toFixed(2)}/小时</div>
    <div class="p-row">车型：${p.vehicle_type}</div>
    <div class="p-actions">
      ${rentBtn}
      <button class="p-nav" onclick="app.navigateTo(${p.id})">导航到此</button>
    </div>
  </div>`;
}

/* ---------- 渲染 ---------- */
function renderLots(fc) {
  lotLayer.clearLayers();
  lotLayer.addData(fc);
}

function renderSpaces(fc, { updateList = true } = {}) {
  spaceLayer.clearLayers();
  state.spaceById = {};
  state.markersById = {};

  fc.features.forEach((f) => {
    const p = f.properties;
    state.spaceById[p.id] = f;
    const meta = STATUS_META[p.status] || STATUS_META.disabled;
    const m = L.circleMarker(
      [f.geometry.coordinates[1], f.geometry.coordinates[0]],
      {
        radius: 7,
        color: '#fff',
        weight: 1.5,
        fillColor: meta.color,
        fillOpacity: 1,
      },
    );
    m.bindPopup(popupHtml(p));
    m.addTo(spaceLayer);
    state.markersById[p.id] = m;
  });

  if (updateList) renderList(fc.features);
}

function renderList(features) {
  const ul = document.getElementById('result-list');
  document.getElementById('list-count').textContent = features.length;
  if (!features.length) {
    ul.innerHTML = '<li style="cursor:default;color:#6b7a8d">无匹配车位</li>';
    return;
  }
  ul.innerHTML = features.map((f) => {
    const p = f.properties;
    const meta = STATUS_META[p.status] || STATUS_META.disabled;
    const dist = p.distance_m != null ? ` · 距离 ${p.distance_m} 米` : '';
    return `<li onclick="app.focusSpace(${p.id})">
      <div class="li-title"><span>${p.code} <span class="dot ${p.status}"></span>${meta.label}</span>
        <span style="color:#6b7a8d">￥${Number(p.price_per_hour).toFixed(2)}</span></div>
      <div class="li-sub">${p.lot_name}${dist}</div>
    </li>`;
  }).join('');
}

function updateLotSelect(lots) {
  const sel = document.getElementById('f-lot');
  sel.innerHTML = '<option value="">全部</option>'
    + lots.features.map((f) => `<option value="${f.properties.id}">${f.properties.name}</option>`).join('');
}

async function refreshStats() {
  try {
    const s = await API.stats();
    document.getElementById('stats').innerHTML = `
      <span>停车场 <b>${s.lots}</b></span>
      <span>车位 <b>${s.spaces}</b></span>
      <span><span class="dot free"></span>空闲 <b>${s.free}</b></span>
      <span><span class="dot occupied"></span>占用 <b>${s.occupied}</b></span>
      <span><span class="dot reserved"></span>预约 <b>${s.reserved}</b></span>`;
  } catch (e) {
    document.getElementById('stats').textContent = '统计不可用';
  }
}

/* ---------- 数据加载 ---------- */
async function loadAll() {
  try {
    const [lots, spaces] = await Promise.all([API.lots(), API.spaces()]);
    renderLots(lots);
    renderSpaces(spaces);
    updateLotSelect(lots);
    // 首次把视野适配到所有停车场
    if (lots.features.length) {
      map.fitBounds(lotLayer.getBounds().pad(0.2));
    }
    refreshStats();
  } catch (e) {
    toast('数据加载失败：' + e.message + '（请确认数据库已初始化）', true);
  }
}

/* ---------- 搜索 ---------- */
async function doSearch() {
  const status = document.getElementById('f-status').value;
  const lotId = document.getElementById('f-lot').value;
  const q = document.getElementById('f-q').value.trim();
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (lotId) qs.set('lot_id', lotId);
  if (q) qs.set('q', q);
  try {
    const fc = await API.spaces(qs.toString());
    renderSpaces(fc);
    if (fc.features.length === 1) app.focusSpace(fc.features[0].properties.id);
  } catch (e) { toast('搜索失败：' + e.message, true); }
}

/* ---------- 定位与附近搜索 ---------- */
function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('浏览器不支持定位'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
      (err) => reject(new Error('定位失败：' + err.message)),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}

async function doNearby() {
  try {
    const loc = await locate();
    state.user = loc;
    const radius = Number(document.getElementById('f-radius').value) || 500;
    const fc = await API.nearby(loc[0], loc[1], radius, 'free');

    // 标记用户位置
    userLayer.clearLayers();
    L.marker(loc).addTo(userLayer).bindPopup('我的位置').openPopup();
    L.circle(loc, { radius, color: '#2f6fed', weight: 1, fillOpacity: 0.05 }).addTo(userLayer);

    // 展示附近空闲车位（按距离排序）
    renderSpaces(fc);
    map.setView(loc, 17);
    if (!fc.features.length) toast('附近范围内没有空闲车位');
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------- 导航 ---------- */
async function navigateTo(id) {
  const f = state.spaceById[id];
  if (!f) return;
  const target = [f.geometry.coordinates[1], f.geometry.coordinates[0]]; // [lat,lng]

  let start = state.user;
  if (!start) {
    try {
      start = await locate();
      state.user = start;
      L.marker(start).addTo(userLayer).bindPopup('我的位置');
    } catch (e) {
      start = [map.getCenter().lat, map.getCenter().lng];
      toast('未获取到定位，以地图中心为起点', true);
    }
  }

  try {
    const res = await API.route(`${start[1]},${start[0]}`, `${target[1]},${target[0]}`);
    if (state.routeLayer) map.removeLayer(state.routeLayer);
    state.routeLayer = L.geoJSON(res.geometry, {
      style: { color: '#2f6fed', weight: 5, opacity: 0.85 },
    }).addTo(map);

    // 绘制起点终点标记
    L.marker(start).addTo(state.routeLayer);
    L.marker(target).addTo(state.routeLayer).bindPopup('目标车位 ' + f.properties.code).openPopup();

    map.fitBounds(state.routeLayer.getBounds().pad(0.25));

    const km = (res.distance / 1000).toFixed(2);
    const provider = res.provider === 'osrm' ? 'OSRM 驾车路线' : '直线估算';
    document.getElementById('nav-info').textContent =
      `导航至 ${f.properties.code}（${f.properties.lot_name}） · 直线/路径 ${km} 公里 · 预计 ${fmtDuration(res.duration)} · ${provider}`;
    document.getElementById('nav-bar').classList.remove('hidden');
    state.navTargetId = id;
  } catch (e) {
    toast('导航失败：' + e.message, true);
  }
}

function clearRoute() {
  if (state.routeLayer) { map.removeLayer(state.routeLayer); state.routeLayer = null; }
  document.getElementById('nav-bar').classList.add('hidden');
  state.navTargetId = null;
}

/* ---------- 车位操作（租用 / 释放） ---------- */
async function rentById(id) {
  try {
    await API.rent(id);
    toast('已租用车位');
    refreshOne(id);
    refreshStats();
  } catch (e) { toast(e.message, true); }
}

async function releaseById(id) {
  try {
    await API.release(id);
    toast('已释放车位');
    refreshOne(id);
    refreshStats();
  } catch (e) { toast(e.message, true); }
}

async function refreshOne(id) {
  try {
    const f = await API.space(id);
    state.spaceById[id] = f;
    const p = f.properties;
    const meta = STATUS_META[p.status] || STATUS_META.disabled;
    const m = state.markersById[id];
    if (m) {
      m.setStyle({ fillColor: meta.color });
      m.setPopupContent(popupHtml(p));
      m.openPopup();
    }
  } catch (e) { /* 忽略 */ }
}

function focusSpace(id) {
  const f = state.spaceById[id];
  if (!f) return;
  const latlng = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
  map.setView(latlng, 18);
  const m = state.markersById[id];
  if (m) m.openPopup();
}

/* ---------- 暴露给弹窗按钮 ---------- */
window.app = { focusSpace, navigateTo, rentById, releaseById };

/* ---------- 事件绑定与初始化 ---------- */
document.getElementById('btn-search').addEventListener('click', doSearch);
document.getElementById('btn-nearby').addEventListener('click', doNearby);
document.getElementById('btn-reset').addEventListener('click', () => {
  document.getElementById('f-status').value = '';
  document.getElementById('f-lot').value = '';
  document.getElementById('f-q').value = '';
  loadAll();
});
document.getElementById('btn-locate').addEventListener('click', async () => {
  try {
    const loc = await locate();
    state.user = loc;
    userLayer.clearLayers();
    L.marker(loc).addTo(userLayer).bindPopup('我的位置').openPopup();
    map.setView(loc, 17);
  } catch (e) { toast(e.message, true); }
});
document.getElementById('btn-clear-route').addEventListener('click', clearRoute);
document.getElementById('f-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

// 顶栏登录态与退出
const authUser = Auth.currentUser();
if (authUser) {
  document.getElementById('user-info').innerHTML =
    '👤 <b>' + (authUser.real_name || authUser.username) + '</b>';
}
document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

loadAll();
