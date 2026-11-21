// Round 26: socket.io client against a bridge whose upstream is down -> socket closed (1011) and client keeps retrying
// Env: BASE (bridge origin with dead upstream), MODE = websocket | polling
const { io } = require('/app/backend/node_modules/socket.io-client');
const MODE = process.env.MODE || 'websocket';
const s = io(process.env.BASE, { path: '/api/socket.io', transports: [MODE], reconnectionDelay: 300, reconnectionDelayMax: 600, auth: { token: 'x' } });
const r = { mode: MODE, errors: [], attempts: 0 };
s.on('connect_error', (e) => r.errors.push(String(e.message).slice(0, 60)));
s.io.on('reconnect_attempt', () => { r.attempts += 1; });
setTimeout(() => { r.errors = [...new Set(r.errors)]; console.log(JSON.stringify(r)); s.close(); process.exit(r.attempts >= 2 ? 0 : 1); }, 6000);
