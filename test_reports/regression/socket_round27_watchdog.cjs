// Round 27: liveUpdates.ts watchdog logic (socket.connect() when !connected && !active), interval shortened to 2 s.
// Phase 1: UP_PORT runs a raw ws server that accepts then closes at once (the old bridge's failure mode) for 6 s.
// Phase 2: a real socket.io server replaces it. Pass = client connects in phase 2 (with or without the watchdog firing).
const http = require('http');
const { WebSocketServer } = require('/app/backend/node_modules/ws');
const { Server } = require('/app/backend/node_modules/socket.io');
const { io } = require('/app/driver-app/node_modules/socket.io-client');
const PORT = Number(process.env.UP_PORT || 8051); const t0 = Date.now();
const L = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1), ...a);
const bad = http.createServer(); const wss = new WebSocketServer({ server: bad });
wss.on('connection', (s) => s.close(1011)); bad.listen(PORT); L('accept-then-close server up');
const socket = io(`http://127.0.0.1:${PORT}/driver`, { path: '/socket.io', transports: ['websocket'], reconnectionDelay: 300, reconnectionDelayMax: 800 });
let watchdogFired = 0; let gaveUp = false;
const watchdog = setInterval(() => {
  if (!socket.connected && !socket.active) { gaveUp = true; watchdogFired += 1; L('watchdog: connect()'); socket.connect(); }
}, 2000);
socket.on('connect', () => { L('client connect'); if (Date.now() - t0 > 6000) { L(`PASS recovered (watchdogFired=${watchdogFired}, gaveUp=${gaveUp})`); clearInterval(watchdog); socket.close(); process.exit(0); } });
socket.on('connect_error', (e) => L('connect_error', e.message, 'active=', socket.active));
socket.on('disconnect', (r) => L('disconnect', r, 'active=', socket.active));
setTimeout(() => {
  wss.clients.forEach((c) => c.terminate()); wss.close(); bad.close(() => {
    const srv = http.createServer(); const s = new Server(srv, { path: '/socket.io' }); s.of('/driver').on('connection', () => {});
    srv.listen(PORT); L('socket.io server up');
  });
}, 6000);
setTimeout(() => { L(`FAIL not recovered (watchdogFired=${watchdogFired}, active=${socket.active})`); process.exit(1); }, 16000);
