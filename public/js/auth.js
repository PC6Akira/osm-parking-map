/* =============================================================
 *  登录态工具：token 与用户信息存取 / 强制登录
 *  - 用户信息来自登录/注册接口返回的 user 对象，前端不做 JWT 解码
 * ============================================================= */
const AUTH_TOKEN_KEY = 'osm_parking_token';
const AUTH_USER_KEY = 'osm_parking_user';

const Auth = {
  getToken() { return localStorage.getItem(AUTH_TOKEN_KEY); },

  setSession(token, user) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  },

  clearSession() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  },

  // 当前用户（来自登录/注册时后端返回的 user 对象）
  currentUser() {
    try { return JSON.parse(localStorage.getItem(AUTH_USER_KEY)); } catch (e) { return null; }
  },

  isLoggedIn() { return !!Auth.getToken(); },

  // 强制登录；role 传 'admin' 时额外校验角色
  requireLogin(role) {
    const user = Auth.currentUser();
    if (!user) { Auth.redirectLogin(); return null; }
    if (role && user.role !== role) {
      alert('需要管理员权限');
      location.href = 'index.html';
      return null;
    }
    return user;
  },

  redirectLogin() {
    const here = location.pathname.split('/').pop() || 'index.html';
    location.href = 'login.html?redirect=' + encodeURIComponent(here);
  },

  logout() {
    Auth.clearSession();
    Auth.redirectLogin();
  },
};
