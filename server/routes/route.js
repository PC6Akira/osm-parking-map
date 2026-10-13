/**
 * 车位导航接口：从用户当前位置到目标车位的路径
 * 优先调用 OSRM 公共 demo 服务获取真实驾车路线；
 * 服务不可用/超时时降级为“直线 + 距离估算”，保证导航功能始终可用。
 *
 * GET /api/route?from=lng,lat&to=lng,lat
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const AVG_SPEED_KMH = 30; // 降级估算用平均车速

/** 两点球面距离（米） */
function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [fromLng, fromLat] = String(req.query.from || '').split(',').map(Number);
    const [toLng, toLat] = String(req.query.to || '').split(',').map(Number);
    if ([fromLng, fromLat, toLng, toLat].some(Number.isNaN)) {
      return res.status(400).json({ error: 'from / to 参数格式应为 lng,lat' });
    }

    const url = `${OSRM_BASE}/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'osm-parking-course-design/1.0 (student project)' },
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`OSRM HTTP ${resp.status}`);
      const data = await resp.json();
      const route = data.routes && data.routes[0];
      if (!route) throw new Error('OSRM 未返回路线');
      return res.json({
        provider: 'osrm',
        distance: route.distance, // 米
        duration: route.duration, // 秒
        geometry: route.geometry, // GeoJSON LineString，坐标 [lng,lat]
      });
    } catch (osrmErr) {
      const distance = haversine([fromLng, fromLat], [toLng, toLat]);
      return res.json({
        provider: 'fallback',
        distance,
        duration: distance / ((AVG_SPEED_KMH * 1000) / 3600),
        geometry: {
          type: 'LineString',
          coordinates: [[fromLng, fromLat], [toLng, toLat]],
        },
        note: `OSRM 不可用，已降级为直线估算：${osrmErr.message}`,
      });
    }
  } catch (err) { next(err); }
});

module.exports = router;
