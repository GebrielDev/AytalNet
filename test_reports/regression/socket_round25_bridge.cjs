// Round 25: Socket.IO through the FastAPI bridge (/api/socket.io), for each transport mode.
// Dashboard '/' (admin token) must get note:replied; driver '/driver' (james token) must get notes:updated.
// Env: BASE (bridge origin), ADMIN, DRIVER (access tokens), MODE = websocket | polling | default
const { io } = require('/app/backend/node_modules/socket.io-client');
const BASE = process.env.BASE; const MODE = process.env.MODE || 'default';
const opts = (token) => ({
  path: '/api/socket.io', forceNew: true, reconnection: false,
  ...(MODE === 'default' ? {} : { transports: [MODE] }),
  auth: (cb) => cb({ token }),
});
const result = { mode: MODE, dash: null, drv: null, notesUpdated: false, noteReplied: false, transports: {} };
const done = (code) => { console.log(JSON.stringify(result)); process.exit(code); };
setTimeout(() => done(1), 20000);

const dash = io(BASE, opts(process.env.ADMIN));
const drv = io(`${BASE}/driver`, opts(process.env.DRIVER));
let ready = 0; let noteId = null; let posted = false;
const api = (p, token, body) => fetch(`${BASE}/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) }).then((r) => r.json());

const check = () => {
  if (result.notesUpdated && result.noteReplied) {
    result.transports = { dash: dash.io.engine.transport.name, drv: drv.io.engine.transport.name };
    dash.close(); drv.close(); done(0);
  }
};
const onReady = async () => {
  if (++ready < 2) return;
  // wait so 'default' mode has time to upgrade to websocket
  await new Promise((r) => setTimeout(r, MODE === 'default' ? 1500 : 200));
  posted = true;
  const n = await api('/drivers/3/notes', process.env.ADMIN, { message: `TEST_ bridge socket ${MODE}` });
  noteId = n.id ?? n.note?.id;
  result.noteId = noteId;
  if (result.notesUpdated) reply();
};
const reply = async () => {
  await api(`/drivers/my-notes/${noteId}/reply`, process.env.DRIVER, { reply: 'On my way' });
};
dash.on('connect', () => { result.dash = 'connected'; onReady(); });
drv.on('connect', () => { result.drv = 'connected'; onReady(); });
dash.on('connect_error', (e) => { result.dash = `error: ${e.message}`; done(1); });
drv.on('connect_error', (e) => { result.drv = `error: ${e.message}`; done(1); });
drv.on('notes:updated', () => {
  if (!posted || result.notesUpdated) return;
  result.notesUpdated = true;
  if (noteId) reply();
});
dash.on('note:replied', (p) => { if (p.noteId === noteId) { result.noteReplied = true; check(); } });
