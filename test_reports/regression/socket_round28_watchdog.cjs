// Round 28: liveUpdates.ts watchdog (count ticks with !connected; on the 2nd consecutive tick
// socket.disconnect(); socket.connect()), interval shortened from 30 s to 2 s.
// Phase 1 (0-6 s): raw ws server on UP_PORT accepts then closes at once (old bridge failure -> stuck 'opening').
// Phase 2 (6 s+): real socket.io server. Pass = client connects in phase 2 AND, once connected, the watchdog
// never resets the socket during 5 more ticks (no client-side disconnect while connected).
// NO_WATCHDOG=1 runs the control (expected: stays stuck).
const http = require('http');
const { WebSocketServer } = require('/app/backend/node_modules/ws');
const { Server } = require('/app/backend/node_modules/socket.io');
const { io } = require('/app/driver-app/node_modules/socket.io-client');
const PORT = Number(process.env.UP_PORT || 8051); const t0 = Date.now(); const NOWD = process.env.NO_WATCHDOG === '1';
const L = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1), ...a);
const bad = http.createServer(); const wss = new WebSocketServer({ server: bad });
wss.on('connection', (s) => s.close(1011)); bad.listen(PORT); L('accept-then-close server up');
const socket = io(`http://127.0.0.1:${PORT}/driver`, { path: '/socket.io', transports: ['websocket'], reconnectionDelay: 300, reconnectionDelayMax: 800 });
let fired = 0; let firedWhileConnected = 0; let downTicks = 0; let connectedAt = null; let disconnectsAfter = 0;
// --- same logic as liveUpdates.ts lines 63-75 ---
const watchdog = setInterval(() => {
  if (NOWD) return;
  if (!socket || socket.connected) { downTicks = 0; return; }
  downTicks += 1;
  if (downTicks >= 2) { downTicks = 0; fired += 1; L('watchdog: reset (disconnect+connect)'); socket.disconnect(); socket.connect(); }
}, 2000);
// guard: any reset while connected would be a bug (should be impossible by construction)
const origDisconnect = socket.disconnect.bind(socket);
socket.disconnect = () => { if (socket.connected) firedWhileConnected += 1; return origDisconnect(); };
socket.on('connect', () => { L('client connect'); if (Date.now() - t0 > 6000 && !connectedAt) connectedAt = Date.now(); });
socket.on('connect_error', (e) => L('connect_error', e.message, 'active=', socket.active));
socket.on('disconnect', (r) => { L('disconnect', r); if (connectedAt) disconnectsAfter += 1; });
setTimeout(() => {
  wss.clients.forEach((c) => c.terminate()); wss.close(); bad.close(() => {
    const srv = http.createServer(); const s = new Server(srv, { path: '/socket.io' }); s.of('/driver').on('connection', () => {});
    srv.listen(PORT); L('socket.io server up');
  });
}, 6000);
setTimeout(() => {
  const ok = connectedAt && disconnectsAfter === 0 && firedWhileConnected === 0 && socket.connected;
  L(`${ok ? 'PASS' : 'FAIL'} connected=${socket.connected} recoveredAfter=${connectedAt ? ((connectedAt - t0) / 1000).toFixed(1) : 'never'}s fired=${fired} firedWhileConnected=${firedWhileConnected} disconnectsAfterConnect=${disconnectsAfter} (NO_WATCHDOG=${NOWD})`);
  clearInterval(watchdog); socket.close(); process.exit(ok ? 0 : 1);
}, 22000);
