// Round 23: password reset ends every old session (REST access + refresh, live sockets, new sockets)
// Usage: BASE=https://... node socket_round23_reset_signout.cjs
const fs = require('fs');
const { io } = require('/app/backend/node_modules/socket.io-client');
const BASE = process.env.BASE; const API = BASE + '/api'; const PATH = '/api/socket.io';
const LOG = '/var/log/supervisor/fleet-test-api.out.log';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, body, token) => {
  const r = await fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const get = async (p, token) => { const r = await fetch(API + p, { headers: { Authorization: 'Bearer ' + token } }); return r.status; };
const conn = (ns, token) => new Promise((resolve) => {
  const s = io(BASE + ns, { path: PATH, transports: ['websocket'], auth: { token }, reconnection: false, timeout: 10000 });
  s.on('connect', () => resolve({ s, ok: true }));
  s.on('connect_error', (e) => resolve({ s, ok: false, err: e.message }));
});
const resetToken = async (email, type) => {
  const before = fs.readFileSync(LOG, 'utf8').length;
  const r = await post('/auth/forgot-password', { email, type });
  for (let i = 0; i < 20; i++) {
    await wait(300);
    const tail = fs.readFileSync(LOG, 'utf8').slice(before);
    const m = [...tail.matchAll(new RegExp(`Development reset link for ${email.replace('.', '\\.')}: \\S*token=([a-f0-9]+)`, 'g'))];
    if (m.length) return { forgot: r.status, token: m[m.length - 1][1] };
  }
  return { forgot: r.status, token: null };
};
const flow = async (kind, email, original, loginPath, ns) => {
  const out = { kind, email };
  const NEW = 'TEST_Reset123!';
  const l1 = await post(loginPath, { email, password: original });
  out.login1 = l1.status;
  const A1 = l1.body.accessToken, R1 = l1.body.refreshToken;
  const c1 = await conn(ns, A1); out.socketBefore = c1.ok;
  let disconnected = null; c1.s.on('disconnect', (reason) => { disconnected = reason; });
  const t = await resetToken(email, kind === 'driver' ? 'driver' : 'user');
  out.forgot = t.forgot; out.gotToken = !!t.token;
  if (!t.token) return out;
  const rr = await post('/auth/reset-password', { token: t.token, password: NEW });
  out.reset = rr.status;
  await wait(1500);
  out.oldSocketDisconnected = disconnected;
  out.oldMe = await get('/auth/me', A1);
  out.oldRefresh = (await post('/auth/refresh', { refreshToken: R1 })).status;
  const c2 = await conn(ns, A1); out.oldTokenNewSocket = c2.ok ? 'CONNECTED(BAD)' : c2.err; c2.s.close();
  out.reuseResetToken = (await post('/auth/reset-password', { token: t.token, password: 'TEST_Other123!' })).status;
  out.loginOldPw = (await post(loginPath, { email, password: original })).status;
  const l2 = await post(loginPath, { email, password: NEW });
  out.loginNewPw = l2.status;
  out.newMe = await get('/auth/me', l2.body.accessToken);
  out.newRefresh = (await post('/auth/refresh', { refreshToken: l2.body.refreshToken })).status;
  const c3 = await conn(ns, l2.body.accessToken); out.newSocket = c3.ok; c3.s.close();
  // restore original password
  const t2 = await resetToken(email, kind === 'driver' ? 'driver' : 'user');
  out.restore = t2.token ? (await post('/auth/reset-password', { token: t2.token, password: original })).status : 'NO_TOKEN';
  out.loginRestored = (await post(loginPath, { email, password: original })).status;
  c1.s.close();
  return out;
};
(async () => {
  const results = [];
  results.push(await flow('driver', 'sarah@fleet.com', 'DriverTest123!', '/auth/driver/login', '/driver'));
  results.push(await flow('user', 'dispatcher@fleet.com', 'DispatchTest123!', '/auth/login', '/'));
  console.log(JSON.stringify(results, null, 1));
  process.exit(0);
})();
