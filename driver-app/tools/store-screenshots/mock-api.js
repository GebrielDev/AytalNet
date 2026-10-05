// Minimal stand-in for the AytalNet backend, used only to render the real app
// screens for store screenshots. Serves plausible demo data; writes nothing.
const http = require('http');

const vehicle = {
  id: 1, plateNumber: 'STS-4471', make: 'Ford', model: 'Transit 350',
  year: 2024, status: 'active', currentOdometer: 48210,
};
const driver = {
  id: 1, employeeId: 'STS-1042', email: 'driver@startechsolutions.us',
  name: 'Marcus Reed', phone: '480-572-5727',
};

const day = (d, h, m) => new Date(2026, 8, d, h, m).toISOString();
const trip = (id, d, sh, sm, eh, em, so, eo) => ({
  id, vehicle, startTime: day(d, sh, sm), endTime: day(d, eh, em),
  startOdometer: so, endOdometer: eo, status: 'completed',
  // Field names must match the Trip model, or the history table renders "-".
  durationMinutes: (eh * 60 + em) - (sh * 60 + sm),
  totalMileage: eo - so,
});

const trips = [
  trip(21, 21, 7, 45, 11, 20, 47890, 47948),
  trip(20, 18, 8, 10, 10, 5, 47802, 47890),
  trip(19, 17, 13, 30, 16, 52, 47735, 47802),
  trip(18, 16, 7, 55, 12, 40, 47661, 47735),
  trip(17, 15, 9, 5, 11, 48, 47604, 47661),
];

const active = {
  id: 22, vehicle, startTime: new Date(Date.now() - 74 * 60 * 1000).toISOString(),
  startOdometer: 48210, status: 'in_progress',
};

const routes = {
  'POST /api/auth/driver/login': { accessToken: 'demo', refreshToken: 'demo', driver },
  'GET /api/auth/me': { driver },
  'GET /api/drivers/my-vehicle': vehicle,
  'GET /api/trips/my-trips': trips,
};

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const path = req.url.split('?')[0];
  const key = `${req.method} ${path}`;

  // The Home screen shows the in-progress card only when this resolves.
  if (path === '/api/trips/my-active') {
    const body = process.env.MOCK_ACTIVE === '1' ? active : null;
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(body));
  }

  if (routes[key]) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(routes[key]));
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}).listen(4100, () => console.log('mock api on 4100'));
