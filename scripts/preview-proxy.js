// Preview-only proxy (port 8001): /api/dashboard/* serves the built web
// dashboard, /api/socket.io/* is the live feed, everything else under /api
// goes to the local Node test API on 8002. Not used in production.
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');

const API_PORT = 8002;
const DIST = path.join(__dirname, '..', 'web-dashboard', 'dist');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

const rewrite = (url) => (url.startsWith('/api/socket.io') ? url.replace('/api/socket.io', '/socket.io') : url);

const serveDashboard = (req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/api\/dashboard\/?/, ''));
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Bad request');
  }
  let file = path.normalize(path.join(DIST, rel));
  const inside = file === DIST || file.startsWith(DIST + path.sep);
  const exists = inside && fs.existsSync(file) && !fs.statSync(file).isDirectory();
  if (!exists) {
    // Missing build files are a real 404; anything else is a dashboard page.
    if (/\.(js|css|map|png|svg|ico|json)$/.test(rel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    file = path.join(DIST, 'index.html');
  }
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.once('open', () => res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }));
  stream.pipe(res);
};

const server = http.createServer((req, res) => {
  if (req.url === '/api/dashboard' || req.url.startsWith('/api/dashboard/') || req.url.startsWith('/api/dashboard?')) return serveDashboard(req, res);
  const upstream = http.request(
    { host: '127.0.0.1', port: API_PORT, path: rewrite(req.url), method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Test API not running' }));
  });
  req.pipe(upstream);
});

// WebSocket upgrades (socket.io) are passed through as raw TCP.
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(API_PORT, '127.0.0.1', () => {
    const lines = [`${req.method} ${rewrite(req.url)} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(8001, '0.0.0.0', () => console.log('preview proxy on 8001 -> 8002'));
