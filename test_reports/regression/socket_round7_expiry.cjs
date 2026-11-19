// Round 7: what the Stops Board socket does when the server closes it at token expiry.
// Mimics StopsBoard.tsx: io(url, { path, auth: cb => cb({token: localStorage}) }) with default reconnection.
const { io } = require('/app/backend/node_modules/socket.io-client');
const jwt = require('/app/backend/node_modules/jsonwebtoken');
const fs = require('fs');
const secret = fs.readFileSync('/app/backend/.env', 'utf8').match(/^JWT_SECRET=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '');
const BASE = process.env.BASE; const PATH = '/api/socket.io';
// Admin token that expires in 5 s; a "refreshed" token (60 s) is put in place before expiry, like the axios refresh would.
let token = jwt.sign({ id: 1, email: 'admin@fleet.com', type: 'user' }, secret, { expiresIn: 5 });
setTimeout(() => { token = jwt.sign({ id: 1, email: 'admin@fleet.com', type: 'user' }, secret, { expiresIn: 60 }); }, 2000);
const s = io(BASE, { path: PATH, transports: ['websocket'], auth: (cb) => cb({ token }) });
let connects = 0;
s.on('connect', () => { connects += 1; console.log('connect', connects, new Date().toISOString()); });
s.on('disconnect', (reason) => console.log('disconnect reason=', reason, 'active=', s.active));
setTimeout(() => {
  console.log('RESULT connects=', connects, 'connected=', s.connected, 'active=', s.active);
  console.log(connects >= 2 ? 'PASS: socket reconnected after server-side expiry close' : 'FAIL: socket stayed down after the server closed it at token expiry (board would show "Reconnecting…" forever)');
  s.close(); process.exit(0);
}, 15000);
