// Round 6: driver:arrived to dashboard room, stops:updated to the driver's /driver socket only
const { io } = require('/app/backend/node_modules/socket.io-client');
const BASE = process.env.BASE; const API = BASE + '/api'; const PATH = '/api/socket.io';
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
  const maria = await login('/auth/driver/login', 'maria@fleet.com', 'DriverTest123!');
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin.accessToken };
  const dash = await conn('/', admin.accessToken); const js = await conn('/driver', james.accessToken); const ms = await conn('/driver', maria.accessToken);
  const arrived = [], jUpd = [], mUpd = [], jArrived = [];
  dash.on('driver:arrived', (x) => arrived.push({ x, t: Date.now() }));
  js.on('stops:updated', (x) => jUpd.push({ x, t: Date.now() })); js.on('driver:arrived', (x) => jArrived.push(x));
  ms.on('stops:updated', (x) => mUpd.push(x));
  let t = Date.now();
  const put = await fetch(API + '/drivers/3/stops', { method: 'PUT', headers: H, body: JSON.stringify({ clearDone: true, stops: [{ address: 'TEST_ Chase Field', latitude: 33.4455, longitude: -112.0667 }] }) }).then(j);
  await wait(1500);
  console.log('stops:updated to james', jUpd.length, jUpd[0] && jUpd[0].t - t, 'ms; maria got', mUpd.length);
  const sid = put.stops[0].id; t = Date.now();
  const a = await fetch(API + `/drivers/my-stops/${sid}/arrive`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + james.accessToken }, body: JSON.stringify({ latitude: 33.4456, longitude: -112.0667 }) });
  console.log('arrive status', a.status);
  await wait(1500);
  console.log('driver:arrived to dash', JSON.stringify(arrived[0] && arrived[0].x), arrived[0] && arrived[0].t - t, 'ms; james got arrived', jArrived.length, '; james updates', jUpd.length);
  await fetch(API + '/drivers/3/stops', { method: 'PUT', headers: H, body: JSON.stringify({ clearDone: true, stops: [] }) });
  [dash, js, ms].forEach((s) => s.close()); process.exit(0);
})();
