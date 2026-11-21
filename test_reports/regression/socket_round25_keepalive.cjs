// Round 25: bridge socket keep-alive (survives > pingInterval) and bad-token refusal. Env: BASE, DRIVER, MODE, SECS
const { io } = require('/app/backend/node_modules/socket.io-client');
const { BASE, DRIVER } = process.env; const MODE = process.env.MODE || 'websocket'; const SECS = Number(process.env.SECS || 35);
const o = (token) => ({ path: '/api/socket.io', forceNew: true, reconnection: false, transports: [MODE], auth: (cb) => cb({ token }) });
const out = { mode: MODE, bad: null, good: null, disconnects: [] };
const bad = io(`${BASE}/driver`, o('not-a-token'));
bad.on('connect', () => { out.bad = 'CONNECTED (unexpected)'; bad.close(); });
bad.on('connect_error', (e) => { out.bad = `refused: ${e.message}`; });
const good = io(`${BASE}/driver`, o(DRIVER));
good.on('connect', () => { out.good = 'connected'; });
good.on('disconnect', (r) => out.disconnects.push(r));
setTimeout(() => { out.stillConnected = good.connected; good.close(); console.log(JSON.stringify(out)); process.exit(0); }, SECS * 1000);
