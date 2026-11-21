// Round 27: websocket-only client via bridge (BASE -> UP_PORT). Two outages: (1) upstream port closed for 8 s,
// (2) upstream answers every request (incl. ws upgrade) with HTTP 503 for 5 s (like Railway during a deploy).
// Pass = client reconnects after each outage (3 connects total).
const http = require('http');
const { Server } = require('/app/backend/node_modules/socket.io');
const { io } = require('/app/driver-app/node_modules/socket.io-client');
const PORT = Number(process.env.UP_PORT); const t0 = Date.now();
const L = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1), ...a);
let srv; let ioSrv; let bad;
const start = () => { srv = http.createServer(); ioSrv = new Server(srv, { path: '/socket.io' }); ioSrv.of('/driver').on('connection', () => L('server: connection')); srv.listen(PORT); L('server up'); };
const stop = (cb) => { ioSrv.close(); srv.close(cb); };
const start503 = () => {
  bad = http.createServer((q, r) => { r.writeHead(503); r.end('down'); });
  bad.on('upgrade', (q, sock) => { sock.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n'); });
  bad.listen(PORT); L('503 server up');
};
start();
const c = io(`${process.env.BASE}/driver`, { path: '/api/socket.io', transports: ['websocket'], reconnectionDelay: 300, reconnectionDelayMax: 1500 });
let connects = 0; let errors = 0;
c.on('connect', () => {
  connects += 1; L('client connect', connects);
  if (connects === 1) setTimeout(() => { L('outage 1: port closed 8 s'); stop(); setTimeout(start, 8000); }, 500);
  if (connects === 2) setTimeout(() => { L('outage 2: 503 for 5 s'); stop(() => { start503(); setTimeout(() => bad.close(start), 5000); }); }, 500);
});
c.on('disconnect', (r) => L('client disconnect', r));
c.on('connect_error', (e) => { errors += 1; if (errors % 3 === 1) L('client connect_error', e.message, 'active=', c.active); });
setTimeout(() => { const ok = connects >= 3; L(ok ? 'PASS reconnected after both outages' : `FAIL connects=${connects} active=${c.active}`); process.exit(ok ? 0 : 1); }, 25000);
