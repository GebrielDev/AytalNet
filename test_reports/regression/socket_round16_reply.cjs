// Round 16: dashboard socket listens for 'note:replied'; prints events as JSON lines for N seconds
const { io } = require('/app/backend/node_modules/socket.io-client');
const BASE = process.env.BASE; const token = process.env.TOKEN; const secs = Number(process.env.SECS || 15);
const s = io(BASE, { path: '/api/socket.io', transports: ['websocket'], auth: (cb) => cb({ token }) });
s.on('connect', () => console.log('CONNECTED'));
s.on('connect_error', (e) => console.log('CONNECT_ERROR', e.message));
s.on('note:replied', (p) => console.log('REPLIED ' + JSON.stringify(p)));
setTimeout(() => { s.close(); process.exit(0); }, secs * 1000);
