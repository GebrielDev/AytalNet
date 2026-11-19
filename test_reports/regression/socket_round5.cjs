// Round 5: /driver namespace auth + destination:updated push, and / namespace for admin
const { io } = require('/app/backend/node_modules/socket.io-client');
const BASE = process.env.BASE; // e.g. https://host (no /api)
const API = BASE + '/api';
const PATH = '/api/socket.io';
const j = (r) => r.json();
const login = (p, email, password) =>
  fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(j);
const res = {};
const conn = (ns, token) =>
  new Promise((resolve) => {
    const s = io(BASE + ns, { path: PATH, transports: ['websocket'], auth: { token }, reconnection: false, timeout: 10000 });
    s.on('connect', () => resolve({ ok: true, s }));
    s.on('connect_error', (e) => resolve({ ok: false, err: e.message, s }));
  });
(async () => {
  const admin = await login('/auth/login', 'admin@fleet.com', 'AdminTest123!');
  const maria = await login('/auth/driver/login', 'maria@fleet.com', 'DriverTest123!');
  const james = await login('/auth/driver/login', 'james@fleet.com', 'DriverTest123!');
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin.accessToken };
  const a = await conn('/driver', admin.accessToken);
  res.user_token_on_driver = a.ok ? 'CONNECTED (BAD)' : a.err; a.s.close();
  const n = await conn('/driver', 'garbage');
  res.bad_token_on_driver = n.ok ? 'CONNECTED (BAD)' : n.err; n.s.close();
  const d = await conn('/', maria.accessToken);
  res.driver_token_on_dashboard = d.ok ? 'CONNECTED (BAD)' : d.err; d.s.close();
  const dash = await conn('/', admin.accessToken);
  res.admin_on_dashboard = dash.ok; dash.s.close();
  const m = await conn('/driver', maria.accessToken);
  const jm = await conn('/driver', james.accessToken);
  res.maria_on_driver = m.ok;
  const got = []; const jamesGot = [];
  m.s.on('destination:updated', (x) => got.push(x));
  jm.s.on('destination:updated', (x) => jamesGot.push(x));
  const put = (body) => fetch(API + '/drivers/2/destination', { method: 'PUT', headers: H, body: JSON.stringify(body) }).then(j);
  let t = Date.now();
  const r1 = await put({ address: 'Phoenix Sky Harbor International Airport, Phoenix, AZ', note: 'TEST_ Terminal 3' });
  await new Promise((r) => setTimeout(r, 1500));
  res.push_after_note_edit = { ms: Date.now() - t, payload: got[0], putResp: r1 };
  await put({ address: 'Phoenix Sky Harbor International Airport, Phoenix, AZ', note: 'Terminal 4' });
  await new Promise((r) => setTimeout(r, 1500));
  res.push_count = got.length; res.last = got[got.length - 1];
  res.james_received_marias = jamesGot.length;
  m.s.close(); jm.s.close();
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
