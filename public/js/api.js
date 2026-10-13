/**
 * 后端接口统一封装
 */
const API = {
  // 统一携带登录 token
  headers() {
    const t = Auth.getToken();
    return t ? { Authorization: 'Bearer ' + t } : {};
  },
  async get(path) {
    const r = await fetch(path, { headers: API.headers() });
    if (r.status === 401) { Auth.clearSession(); Auth.redirectLogin(); throw new Error('未登录'); }
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || `请求失败(${r.status})`);
    }
    return r.json();
  },
  async send(method, path, body) {
    const r = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...API.headers() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { Auth.clearSession(); Auth.redirectLogin(); throw new Error('未登录'); }
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || `请求失败(${r.status})`);
    }
    return r.status === 204 ? null : r.json();
  },

  // 停车场
  lots: () => API.get('/api/lots'),
  createLot: (d) => API.send('POST', '/api/lots', d),
  updateLot: (id, d) => API.send('PUT', `/api/lots/${id}`, d),
  deleteLot: (id) => API.send('DELETE', `/api/lots/${id}`),

  // 车位
  spaces: (qs) => API.get('/api/spaces' + (qs ? `?${qs}` : '')),
  space: (id) => API.get(`/api/spaces/${id}`),
  nearby: (lat, lng, radius, status) => API.get(
    `/api/spaces/nearby?lat=${lat}&lng=${lng}&radius=${radius}` + (status ? `&status=${status}` : ''),
  ),
  createSpace: (d) => API.send('POST', '/api/spaces', d),
  updateSpace: (id, d) => API.send('PUT', `/api/spaces/${id}`, d),
  deleteSpace: (id) => API.send('DELETE', `/api/spaces/${id}`),
  rent: (id, d) => API.send('POST', `/api/spaces/${id}/rent`, d || {}),
  release: (id) => API.send('POST', `/api/spaces/${id}/release`),

  // 其它
  stats: () => API.get('/api/stats'),
  route: (from, to) => API.get(`/api/route?from=${from}&to=${to}`),
};
