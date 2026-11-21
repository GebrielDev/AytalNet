// Round 28: bridge (BASE -> UP_PORT) close code when the upstream dies mid-session.
// Raw ws upstream on UP_PORT; raw ws client through the bridge records the close code it gets.
// A: upstream TCP socket destroyed (no close frame)  -> expect 1011
// B: upstream sends close 1011                       -> expect 1011
// C: upstream closes normally (1000)                  -> expect 1000
// D: client closes first (1000), upstream alive       -> bridge must close upstream; no error
const http = require('http');
const { WebSocketServer, WebSocket } = require('/app/backend/node_modules/ws');
const PORT = Number(process.env.UP_PORT); const BASE = process.env.BASE.replace(/^http/, 'ws');
let mode = 'A'; let upstreamClosed = null;
const srv = http.createServer(); const wss = new WebSocketServer({ server: srv });
wss.on('connection', (s) => {
  s.on('close', (c) => { upstreamClosed = c; });
  s.send('0{"sid":"x","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}');
  setTimeout(() => {
    if (mode === 'A') s._socket.destroy();
    if (mode === 'B') s.close(1011, 'boom');
    if (mode === 'C') s.close(1000);
  }, 700);
});
const run = (m, expect) => new Promise((resolve) => {
  mode = m; upstreamClosed = null;
  const c = new WebSocket(`${BASE}/api/socket.io/?EIO=4&transport=websocket`);
  let first = null;
  c.on('message', (d) => { first = first || d.toString().slice(0, 1); if (m === 'D') setTimeout(() => c.close(1000), 300); });
  c.on('error', (e) => console.log(m, 'client error', e.message));
  c.on('close', (code) => {
    setTimeout(() => {
      const ok = m === 'D' ? upstreamClosed !== null : code === expect;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${m}: client close=${code} expected=${expect} firstFrame=${first} upstreamClosed=${upstreamClosed}`);
      resolve(ok);
    }, 500);
  });
});
srv.listen(PORT, async () => {
  const r = [await run('A', 1011), await run('B', 1011), await run('C', 1000), await run('D', 1000)];
  srv.close(); wss.close(); process.exit(r.every(Boolean) ? 0 : 1);
});
setTimeout(() => { console.log('FAIL timeout'); process.exit(1); }, 20000);
