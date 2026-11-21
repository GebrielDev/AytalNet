// Round 23: reset a driver's password to the SAME value (bumps tokenVersion = "reset elsewhere")
// Usage: BASE=... EMAIL=maria@fleet.com PASS=DriverTest123! DELAY=40000 node reset_elsewhere_round23.cjs
const fs = require('fs');
const API = process.env.BASE + '/api'; const LOG = '/var/log/supervisor/fleet-test-api.out.log';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status);
(async () => {
  await wait(Number(process.env.DELAY || 0));
  const email = process.env.EMAIL; const before = fs.readFileSync(LOG, 'utf8').length;
  const f = await post('/auth/forgot-password', { email, type: 'driver' });
  let token = null;
  for (let i = 0; i < 20 && !token; i++) { await wait(300); const m = fs.readFileSync(LOG, 'utf8').slice(before).match(/token=([a-f0-9]+)/); if (m) token = m[1]; }
  const r = token ? await post('/auth/reset-password', { token, password: process.env.PASS }) : 'NO_TOKEN';
  console.log(new Date().toISOString(), JSON.stringify({ forgot: f, reset: r }));
})();
