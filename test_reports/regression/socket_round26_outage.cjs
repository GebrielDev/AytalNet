// Round 26: upstream outage mid-session through the bridge. Starts a throwaway socket.io server on UP_PORT,
// client (websocket-only, like the driver app) connects via BASE (bridge -> UP_PORT); server is stopped for 3 s, then restarted.
// Pass = client reconnects after the server is back.
const http = require('http');
const { Server } = require('/app/backend/node_modules/socket.io');
const { io } = require('/app/driver-app/node_modules/socket.io-client');
const PORT = Number(process.env.UP_PORT); const t0 = Date.now();
const L = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1), ...a);
let srv; let ioSrv;
const start = () => { srv = http.createServer(); ioSrv = new Server(srv, { path: '/socket.io' }); ioSrv.of('/driver').on('connection', () => L('server: connection')); srv.listen(PORT); L('server up'); };
start();
const c = io(`${process.env.BASE}/driver`, { path: process.env.CLIENT_PATH || '/api/socket.io', transports: ['websocket'], reconnectionDelay: 300, reconnectionDelayMax: 800 });
let connects = 0;
c.on('connect', () => { connects += 1; L('client connect', connects); if (connects === 1) setTimeout(() => { L('server down'); ioSrv.close(); srv.close(); setTimeout(start, 3000); }, 500); });
c.on('disconnect', (r) => L('client disconnect', r));
c.on('connect_error', (e) => L('client connect_error', e.message));
c.io.on('reconnect_attempt', (n) => L('reconnect_attempt', n));
setTimeout(() => { L(connects >= 2 ? 'PASS reconnected' : 'FAIL never reconnected'); process.exit(connects >= 2 ? 0 : 1); }, 12000);
