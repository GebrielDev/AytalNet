# Fleet Management System

A comprehensive fleet management solution with real-time trip tracking, driver management, and reporting.

## Components

- **Backend API** - Node.js + Express + PostgreSQL
- **Web Dashboard** - React + Vite + Tailwind CSS
- **Driver Mobile App** - React Native + Expo

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Cloudinary account (for image uploads)

### Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your database and Cloudinary credentials
npm install
npm run dev
```

### Backend Tests

```bash
cd backend
npm test            # Vitest, once
npm run test:watch  # Vitest, watching
npm run typecheck   # type-checks src and the test files together
```

Tests sit beside the code they cover as `src/**/*.test.ts`, and need no
database: they mock the models and the auth config, so `npm test` runs on a
clean checkout with nothing but `npm install`. The same commands run in CI
(`.github/workflows/ci.yml`).

### Password Reset Email

Password resets are sent through [Resend](https://resend.com) over its HTTPS
API. Set `RESEND_API_KEY`, and verify the sending domain in Resend so it
matches `EMAIL_FROM` — an unverified domain is rejected with "The domain is not
verified".

SMTP is kept as a fallback and is used only when `RESEND_API_KEY` is absent.
It is not the default because the Microsoft 365 account previously used
refused client submission at the tenant level (`535 5.7.139`), which left
password reset broken for dispatchers and drivers alike, and because hosts
commonly block outbound SMTP — Railway disables it below the Pro plan.

A send that fails never changes what the API tells the caller, since that would
reveal which addresses are registered; it is logged instead, naming the
provider. Outside production the reset link is also printed to the log, so the
flow can be exercised with no mail provider at all.

### Photo Storage (Cloudinary or Emergent)

Trip photographs go to Cloudinary unless `PHOTO_STORAGE=emergent` is set, in
which case they go to Emergent managed storage. That also needs
`EMERGENT_LLM_KEY`, and optionally `PUBLIC_API_URL` (e.g.
`https://api.startechsolutions.us/api`), which is used to build the photo links.
These photos are served by the API at `GET /api/files/<path>`. Photos already in
Cloudinary stay there and keep working. Emergent storage has no delete call, so
the retention job erases a photograph by overwriting its file with zero bytes.

### Offline Trips

The driver app saves every trip start and end on the phone first and sends it
when there is signal. A start carries a `clientRef` and the time the driver
pressed Start (`startedAt`), and an end carries `endedAt`, so a re-sent request
returns the trip that already exists. **Deploy this backend before shipping the
app build**, because older servers ignore those fields.

### Seed Database

```bash
cd backend
npm run seed:dev     # from TypeScript source
npm run seed         # from a build, after npm run build
```

**There are no default passwords.** They used to be literals in `seed.ts`, which
meant an administrator account whose password was in source control everywhere
the seed had run. Each run now generates one per account and prints it once:

```
Accounts created by THIS run, with the passwords they were given:
  admin@fleet.com / vMrGyDhqUQWRrhYBfXSf (generated - this is the only time it is shown)
  ...
```

They are stored only as hashes, so save them as they appear. To choose them
yourself, set `SEED_ADMIN_PASSWORD`, `SEED_DISPATCHER_PASSWORD` and
`SEED_DRIVER_PASSWORD` before running.

The seed is idempotent: an account that already exists keeps the password it
was created with, and the run says so rather than printing one that would not
work. A forgotten password is reset through the forgot-password flow.

It refuses to run when `NODE_ENV=production` unless `ALLOW_PRODUCTION_SEED=yes`
is also set - it writes demo drivers, vehicles and trips, which is not data a
live fleet should acquire by accident.

### Web Dashboard

```bash
cd web-dashboard
npm install
npm run dev
```

Open http://localhost:5173

### Driver App

```bash
cd driver-app
npm install
npx expo start
```

## Railway Deployment

### 1. Deploy Backend

1. Create a new project in Railway
2. Add PostgreSQL service
3. Connect your GitHub repo
4. Set root directory to `backend`
5. Add environment variables:
   - `DATABASE_URL` (auto-provided by Railway PostgreSQL)
   - `JWT_SECRET`
   - `JWT_REFRESH_SECRET`
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
   - `FRONTEND_URL` (your deployed dashboard URL)

### 2. Deploy Web Dashboard

1. Add another service to your Railway project
2. Set root directory to `web-dashboard`
3. Add environment variable:
   - `VITE_API_URL` (your deployed backend URL + /api)

### 3. Data retention (required for the published privacy policy)

The privacy policy at `landing/public/privacy.html` tells drivers that after
seven years their photographs are deleted and their trip records anonymised.
That is a commitment to them, and it is only kept if something runs:

```bash
npm run retention              # report what is due, change nothing
npm run retention -- --commit  # delete and anonymise
```

It reports by default. Both steps are irreversible - a deleted Cloudinary
image is gone, and an anonymised trip cannot be re-linked to its driver - so
nothing happens without `--commit`, and **no schedule is configured for you.**

To enforce the policy, add a Railway cron service:

1. Add a service to the project, same repo, root directory `backend`
2. Set its start command to `npm run retention -- --commit`
3. Set the cron schedule to `0 3 1 * *` (03:00 UTC on the first of the month -
   the window is seven years, so daily buys nothing)
4. Give it the same `DATABASE_URL` and `CLOUDINARY_*` variables as the backend

It covers both halves of the policy: trips and their photographs at seven
years, and driver account records seven years after the driver stops driving.
The clock for an account starts when its status moves to inactive, which is
recorded from now on. **Drivers already inactive have no such date**, so their
seven years cannot be counted and the job reports them without touching them -
set `drivers.deactivated_at` for those rows to bring them under the policy.

Run it without `--commit` once first and read what it reports. The job exits
non-zero if any Cloudinary asset could not be deleted, keeping those records so
the next run retries them.

Until that service exists, the seven-year promise is documented but not
enforced.

### 4. Driver App

For the mobile app:
1. Update `src/services/api.ts` with your production API URL
2. Build with Expo:
   ```bash
   npx expo build:android
   npx expo build:ios
   ```

## Features

### Web Dashboard (Dispatchers)
- Real-time trip monitoring
- Driver management (CRUD)
- Vehicle management (CRUD)
- Trip reports with date filters
- Export to CSV/Excel
- Live updates via WebSocket

### Driver App
- Driver authentication
- Start trip with:
  - Vehicle selection
  - Odometer reading + photo
  - Driver selfie
  - Optional passenger photo
  - GPS location capture
- Active trip tracking (duration display)
- End trip with:
  - Odometer reading + photo
  - GPS location capture
- Trip summary

## API Endpoints

### Authentication
- `POST /api/auth/login` - Dispatcher login
- `POST /api/auth/driver/login` - Driver login
- `POST /api/auth/refresh` - Refresh token
- `GET /api/auth/me` - Get current user

### Drivers
- `GET /api/drivers` - List drivers
- `POST /api/drivers` - Create driver
- `PUT /api/drivers/:id` - Update driver
- `DELETE /api/drivers/:id` - Deactivate driver

### Vehicles
- `GET /api/vehicles` - List vehicles
- `GET /api/vehicles/available` - Available vehicles
- `POST /api/vehicles` - Create vehicle
- `PUT /api/vehicles/:id` - Update vehicle
- `DELETE /api/vehicles/:id` - Deactivate vehicle

### Trips
- `GET /api/trips` - List trips (paginated)
- `GET /api/trips/active` - Active trips
- `GET /api/trips/:id` - Trip details
- `POST /api/trips/start` - Start trip (driver)
- `PUT /api/trips/:id/end` - End trip (driver)
- `POST /api/trips/:id/photos` - Upload photo
- `GET /api/trips/my-active` - Driver's active trip

### Reports
- `GET /api/reports/trips` - Trip report
- `GET /api/reports/summary` - Summary stats
- `GET /api/reports/export` - Export CSV/Excel

## Tech Stack

### Backend
- Node.js + Express + TypeScript
- PostgreSQL + Sequelize ORM
- JWT authentication
- Socket.io for real-time
- Cloudinary for images
- XLSX for exports

### Web Dashboard
- React 18 + TypeScript
- Vite build tool
- Tailwind CSS
- Recharts
- Socket.io client

### Mobile App
- React Native + Expo
- React Navigation
- Expo Camera + Location
- AsyncStorage

## License

MIT
### By: Gebriel D.