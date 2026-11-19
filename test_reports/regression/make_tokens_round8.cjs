// Round 8: prints admin JWTs for the socket-rejoin UI test: short (expires in N s) and expired (valid signature).
const jwt = require('/app/backend/node_modules/jsonwebtoken');
const fs = require('fs');
const secret = fs.readFileSync('/app/backend/.env', 'utf8').match(/^JWT_SECRET=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '');
const payload = { id: 1, email: 'admin@fleet.com', type: 'user' };
const secs = Number(process.env.SECS || 20);
const now = Math.floor(Date.now() / 1000);
console.log(JSON.stringify({
  short: jwt.sign({ ...payload, exp: now + secs }, secret),
  expired: jwt.sign({ ...payload, iat: now - 7200, exp: now - 3600 }, secret),
}));
