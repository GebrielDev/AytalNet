// Round 21: PUT /drivers/:id/stops/:stopId/odometer -> dashboard 'stops:changed', driver 'stops:updated'
const { io } = require('/app/backend/node_modules/socket.io-client');
const BASE = process.env.BASE; const API = BASE + '/api'; const PATH = '/api/socket.io';
const STOP = process.env.STOP_ID; const ODO = Number(process.env.ODO);
const j = (r) => r.json();
const login = (p, email, password) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(j);
const conn = (ns, token) => new Promise((resolve) => {
  const s = io(BASE + ns, { path: PATH, transports: ['websocket'], auth: { token }, reconnection: false, timeout: 10000 });
  s.on('connect', () => resolve(s)); s.on('connect_error', (e) => { console.log('ERR', ns, e.message); resolve(s); });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const admin = await login('/auth/login', 'admin@fleet.com', 'AdminTest123!');
  const james = await login('/auth/driver/login', 'james@fleet.com', 'DriverTest123!');
  const dash = await conn('/', admin.accessToken); const js = await conn('/driver', james.accessToken);
  const changed = [], upd = [];
  dash.on('stops:changed', (x) => changed.push(x));
  js.on('stops:updated', (x) => upd.push(x));
  await wait(500);
  const r = await fetch(API + `/drivers/3/stops/${STOP}/odometer`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin.accessToken }, body: JSON.stringify({ odometer: ODO, reason: 'TEST_ socket check' }) });
  await wait(1500);
  const me = upd[0] && upd[0].find((s) => String(s.id) === String(STOP));
  console.log(JSON.stringify({ status: r.status, changed, updCount: upd.length, updOdo: me ? me.arrivedOdometer : null, updFlag: me ? me.odometerFlag : 'missing' }));
  [dash, js].forEach((s) => s.close()); process.exit(0);
})();
