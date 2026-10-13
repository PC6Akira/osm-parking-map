/* =============================================================
 *  管理端：停车场与车位的增、删、改、查（空间数据在地图上采集）
 *  专业课程设计II 题目2
 * ============================================================= */

// 强制管理员登录：未登录或非管理员跳转
if (!Auth.requireLogin('admin')) throw new Error('需要管理员权限');

const STATUS_META = {
  free: { label: '空闲', color: '#2ecc71' },
  occupied: { label: '占用', color: '#e74c3c' },
  reserved: { label: '已预约', color: '#f1c40f' },
  disabled: { label: '停用', color: '#95a5a6' },
};

const CENTER = [32.1180, 118.9385];

const state = {
  editingLotId: null,
  editingSpaceId: null,
  pickMode: null,        // 'lot' | 'point' | null
  lotCoords: [],         // 多边形顶点 [lng,lat]
  tempMarkers: [],
  tempPolygon: null,
  tempPoint: null,
};

/* ---------- 地图 ---------- */
const map = L.map('map').setView(CENTER, 16);
L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const lotLayer = L.geoJSON(null, {
  style: { color: '#3388ff', weight: 2, fillColor: '#3388ff', fillOpacity: 0.08 },
  onEachFeature: (f, layer) => layer.bindTooltip(f.properties.name, { sticky: true }),
}).addTo(map);

const spaceLayer = L.layerGroup().addTo(map);
const drawLayer = L.layerGroup().addTo(map);

/* ---------- 工具 ---------- */
function toast(msg, isErr) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 3000);
}

function clearDraw() {
  state.tempMarkers.forEach((m) => drawLayer.removeLayer(m));
  state.tempMarkers = [];
  if (state.tempPolygon) { drawLayer.removeLayer(state.tempPolygon); state.tempPolygon = null; }
  if (state.tempPoint) { drawLayer.removeLayer(state.tempPoint); state.tempPoint = null; }
}

/* ---------- 渲染 ---------- */
function renderStats(s) {
  document.getElementById('stats').innerHTML = `
    <span>停车场 <b>${s.lots}</b></span>
    <span>车位 <b>${s.spaces}</b></span>
    <span><span class="dot free"></span>空闲 <b>${s.free}</b></span>
    <span><span class="dot occupied"></span>占用 <b>${s.occupied}</b></span>`;
}

function renderSpacesOnMap(fc) {
  spaceLayer.clearLayers();
  fc.features.forEach((f) => {
    const p = f.properties;
    const meta = STATUS_META[p.status] || STATUS_META.disabled;
    L.circleMarker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
      radius: 6, color: '#fff', weight: 1.5, fillColor: meta.color, fillOpacity: 1,
    }).bindTooltip(`${p.code}（${meta.label}）`, { sticky: true }).addTo(spaceLayer);
  });
}

function renderLotList(fc) {
  const ul = document.getElementById('lot-list');
  if (!fc.features.length) { ul.innerHTML = '<li style="cursor:default;color:#6b7a8d">暂无停车场</li>'; return; }
  ul.innerHTML = fc.features.map((f) => {
    const p = f.properties;
    return `<li>
      <div class="li-title"><span>${p.name}</span>
        <span>
          <button class="btn small ghost" onclick="admin.editLot(${p.id})">编辑</button>
          <button class="btn small danger" onclick="admin.deleteLot(${p.id})">删除</button>
        </span></div>
      <div class="li-sub">车位 ${p.space_count} · 空闲 ${p.free_count} ${p.address ? '· ' + p.address : ''}</div>
    </li>`;
  }).join('');
}

function renderSpaceList(fc) {
  const ul = document.getElementById('space-list');
  document.getElementById('space-count').textContent = fc.features.length;
  if (!fc.features.length) { ul.innerHTML = '<li style="cursor:default;color:#6b7a8d">暂无车位</li>'; return; }
  ul.innerHTML = fc.features.map((f) => {
    const p = f.properties;
    const meta = STATUS_META[p.status] || STATUS_META.disabled;
    return `<li>
      <div class="li-title"><span>${p.code} <span class="dot ${p.status}"></span></span>
        <span>
          <button class="btn small ghost" onclick="admin.editSpace(${p.id})">编辑</button>
          <button class="btn small danger" onclick="admin.deleteSpace(${p.id})">删除</button>
        </span></div>
      <div class="li-sub">${p.lot_name} · ￥${Number(p.price_per_hour).toFixed(2)}/时</div>
    </li>`;
  }).join('');
}

function fillLotSelect(fc) {
  const sel = document.getElementById('sp-lot');
  sel.innerHTML = fc.features
    .map((f) => `<option value="${f.properties.id}">${f.properties.name}</option>`).join('');
}

/* ---------- 加载 ---------- */
let cache = { lots: null, spaces: null };

async function loadAll() {
  try {
    const [lots, spaces, stats] = await Promise.all([API.lots(), API.spaces(), API.stats()]);
    cache.lots = lots; cache.spaces = spaces;
    lotLayer.clearLayers(); lotLayer.addData(lots);
    renderSpacesOnMap(spaces);
    renderLotList(lots);
    renderSpaceList(spaces);
    fillLotSelect(lots);
    renderStats(stats);
    if (lots.features.length) map.fitBounds(lotLayer.getBounds().pad(0.3));
  } catch (e) {
    toast('加载失败：' + e.message + '（请确认数据库已初始化）', true);
  }
}

/* ---------- 停车场 CRUD ---------- */
function startDrawLot() {
  state.pickMode = 'lot';
  state.lotCoords = [];
  clearDraw();
  document.getElementById('lot-geom-hint').textContent = '采集模式：单击加点，双击结束';
  toast('请在左侧地图上依次单击多边形顶点，双击结束');
}

function finishDrawLot() {
  if (state.lotCoords.length >= 3) {
    state.pickMode = null;
    state.tempPolygon = L.polygon(state.lotCoords.map((c) => [c[1], c[0]]), { color: '#e74c3c' }).addTo(drawLayer);
    document.getElementById('lot-geom-hint').textContent = `已采集 ${state.lotCoords.length} 个顶点`;
  } else {
    toast('至少需要 3 个顶点', true);
  }
}

function clearLot() {
  state.lotCoords = [];
  state.pickMode = null;
  clearDraw();
  document.getElementById('lot-geom-hint').textContent = '未采集（采集时单击加点，双击结束）';
}

async function saveLot() {
  const name = document.getElementById('lot-name').value.trim();
  if (!name) return toast('请填写停车场名称', true);
  const body = {
    name,
    address: document.getElementById('lot-address').value.trim() || null,
    capacity: Number(document.getElementById('lot-capacity').value) || 0,
  };
  if (state.lotCoords.length >= 3) {
    const ring = state.lotCoords.slice();
    ring.push(ring[0]); // 闭合环
    body.geometry = { type: 'Polygon', coordinates: [ring] };
  } else if (!state.editingLotId) {
    return toast('请先在地图上采集多边形边界', true);
  }
  try {
    if (state.editingLotId) {
      await API.updateLot(state.editingLotId, body);
      toast('停车场已更新');
    } else {
      await API.createLot(body);
      toast('停车场已新增');
    }
    cancelEditLot();
    loadAll();
  } catch (e) { toast(e.message, true); }
}

function editLot(id) {
  const f = cache.lots.features.find((x) => x.properties.id === id);
  if (!f) return;
  const p = f.properties;
  state.editingLotId = id;
  document.getElementById('lot-mode').textContent = '编辑 #' + id;
  document.getElementById('lot-name').value = p.name;
  document.getElementById('lot-address').value = p.address || '';
  document.getElementById('lot-capacity').value = p.capacity;
  // 用现有几何初始化采集顶点
  state.lotCoords = f.geometry.coordinates[0].slice(0, -1);
  clearDraw();
  state.tempPolygon = L.polygon(state.lotCoords.map((c) => [c[1], c[0]]), { color: '#e74c3c' }).addTo(drawLayer);
  map.fitBounds(state.tempPolygon.getBounds().pad(0.3));
  document.getElementById('lot-geom-hint').textContent = `已采集 ${state.lotCoords.length} 个顶点（可清除后重画）`;
}

function cancelEditLot() {
  state.editingLotId = null;
  document.getElementById('lot-mode').textContent = '新增';
  document.getElementById('lot-name').value = '';
  document.getElementById('lot-address').value = '';
  document.getElementById('lot-capacity').value = 0;
  clearLot();
}

async function deleteLot(id) {
  if (!confirm(`确认删除停车场 #${id}？其下所有车位将一并删除。`)) return;
  try { await API.deleteLot(id); toast('已删除'); loadAll(); } catch (e) { toast(e.message, true); }
}

/* ---------- 车位 CRUD ---------- */
function startPickPoint() {
  state.pickMode = 'point';
  toast('请在左侧地图上单击以选取车位位置');
}

async function saveSpace() {
  const lotId = Number(document.getElementById('sp-lot').value);
  const code = document.getElementById('sp-code').value.trim();
  const lng = Number(document.getElementById('sp-lng').value);
  const lat = Number(document.getElementById('sp-lat').value);
  if (!lotId) return toast('请选择所属停车场', true);
  if (!code) return toast('请填写车位标识', true);
  if (Number.isNaN(lng) || Number.isNaN(lat)) return toast('请在地图上取点或输入经纬度', true);

  const body = {
    lot_id: lotId,
    code,
    status: document.getElementById('sp-status').value,
    price_per_hour: Number(document.getElementById('sp-price').value) || 0,
    vehicle_type: document.getElementById('sp-vtype').value.trim() || '小型车',
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
  try {
    if (state.editingSpaceId) {
      await API.updateSpace(state.editingSpaceId, body);
      toast('车位已更新');
    } else {
      await API.createSpace(body);
      toast('车位已新增');
    }
    cancelEditSpace();
    loadAll();
  } catch (e) { toast(e.message, true); }
}

function editSpace(id) {
  const f = cache.spaces.features.find((x) => x.properties.id === id);
  if (!f) return;
  const p = f.properties;
  state.editingSpaceId = id;
  document.getElementById('space-mode').textContent = '编辑 #' + id;
  document.getElementById('sp-lot').value = p.lot_id;
  document.getElementById('sp-code').value = p.code;
  document.getElementById('sp-status').value = p.status;
  document.getElementById('sp-price').value = p.price_per_hour;
  document.getElementById('sp-vtype').value = p.vehicle_type;
  document.getElementById('sp-lng').value = f.geometry.coordinates[0];
  document.getElementById('sp-lat').value = f.geometry.coordinates[1];
  map.setView([f.geometry.coordinates[1], f.geometry.coordinates[0]], 18);
}

function cancelEditSpace() {
  state.editingSpaceId = null;
  document.getElementById('space-mode').textContent = '新增';
  document.getElementById('sp-code').value = '';
  document.getElementById('sp-lng').value = '';
  document.getElementById('sp-lat').value = '';
  document.getElementById('sp-price').value = 2.5;
  document.getElementById('sp-vtype').value = '小型车';
  document.getElementById('sp-status').value = 'free';
  clearDraw();
}

async function deleteSpace(id) {
  if (!confirm(`确认删除车位 #${id}？`)) return;
  try { await API.deleteSpace(id); toast('已删除'); loadAll(); } catch (e) { toast(e.message, true); }
}

/* ---------- 地图交互：采集 ---------- */
map.on('click', (e) => {
  const lng = Number(e.latlng.lng.toFixed(7));
  const lat = Number(e.latlng.lat.toFixed(7));
  if (state.pickMode === 'point') {
    document.getElementById('sp-lng').value = lng;
    document.getElementById('sp-lat').value = lat;
    clearDraw();
    state.tempPoint = L.marker([lat, lng], { draggable: false }).addTo(drawLayer);
    state.pickMode = null;
    toast(`已取点：${lng}, ${lat}`);
  } else if (state.pickMode === 'lot') {
    state.lotCoords.push([lng, lat]);
    const m = L.circleMarker([lat, lng], { radius: 5, color: '#e74c3c', fillOpacity: 1 }).addTo(drawLayer);
    state.tempMarkers.push(m);
    if (state.tempPolygon) drawLayer.removeLayer(state.tempPolygon);
    if (state.lotCoords.length >= 2) {
      state.tempPolygon = L.polyline(state.lotCoords.map((c) => [c[1], c[0]]), { color: '#e74c3c' }).addTo(drawLayer);
    }
    document.getElementById('lot-geom-hint').textContent = `已采集 ${state.lotCoords.length} 个顶点（双击结束）`;
  }
});
map.on('dblclick', () => { if (state.pickMode === 'lot') finishDrawLot(); });

/* ---------- 事件绑定 ---------- */
document.getElementById('btn-draw-lot').addEventListener('click', startDrawLot);
document.getElementById('btn-clear-lot').addEventListener('click', clearLot);
document.getElementById('btn-save-lot').addEventListener('click', saveLot);
document.getElementById('btn-cancel-lot').addEventListener('click', cancelEditLot);
document.getElementById('btn-pick-point').addEventListener('click', startPickPoint);
document.getElementById('btn-save-space').addEventListener('click', saveSpace);
document.getElementById('btn-cancel-space').addEventListener('click', cancelEditSpace);

window.admin = { editLot, deleteLot, editSpace, deleteSpace };

// 顶栏登录态与退出
const authUser = Auth.currentUser();
if (authUser) {
  document.getElementById('user-info').innerHTML =
    '👤 <b>' + (authUser.real_name || authUser.username) + '</b>（管理员）';
}
document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

loadAll();
