# STS Fleet Management – PRD

## Original request
"Build a mobile app: read from github". The imported repo is an existing fleet management system:
a Node/Express/PostgreSQL backend on Railway, a React web dashboard, and an Expo SDK 57 driver app ("STS Driver App").

## User choices
- Get the driver app running here, add features, publish to Play/App Store
- Servers: live Railway (api.startechsolutions.us) plus a test copy
- File storage: Emergent managed storage
- Google sign-in: requested, then cancelled (not built)

## Done
- 2026-06: `/app/frontend` symlinked to `/app/driver-app` so the preview and Expo Go run the app
- 2026-06: Test server copy in the preview. Local Postgres `fleet_test` with seeded demo data, the Node API on port 8001 (supervisor `fleet-test-api`; the platform `backend` program is stopped). The preview app points at the test copy (driver-app/.env).
- 2026-06: Photos go to Emergent storage when `PHOTO_STORAGE=emergent`. They are served at `/api/files/...`, and the retention job erases them by overwriting with zero bytes. Cloudinary stays the default otherwise.
- 2026-06: Offline trips. The app queues starts and ends on the phone and syncs them on reconnect or foreground. The server accepts clientRef, startedAt and endedAt, and repeat sends are idempotent. A "waiting to send" card has Send now and Discard.
- 2026-06: Security fix. A driver can no longer read or upload photos to another driver's trip.

- 2026-06: Photo migration script `npm run photos:migrate` (a dry run by default; `--commit` copies Cloudinary/inline photos to Emergent storage; `--delete-cloudinary` is optional).
- 2026-06: Late trips view. Trips now record `end_received_at`. `GET /api/trips?recordedOffline=true` returns only trips that have a clientRef and arrived more than 5 minutes late. The dashboard has a filter checkbox, an amber badge, and "reached office" rows in the trip details.
- 2026-06: The dashboard test copy is served at `/api/dashboard/` through the preview proxy (/opt/fleet-preview, port 8001 → API on 8002, socket.io at /api/socket.io).
- 2026-06: Offline trip history. The driver's Home screen shows saved trips when there is no signal, with an "updated" time, plus trips waiting to send and the total miles.
- 2026-06: Fixed the inflated page count on the trips list (`distinct: true`).

- 2026-06: Late trip alerts. Every dashboard user gets an email (through the existing Resend/SMTP setup) when a trip's start, or its end if the start was on time, arrives more than `LATE_TRIP_ALERT_MINUTES` (60) late.
- 2026-06: Private photo links. `/api/files/*` needs a dispatcher or admin session; the dashboard loads photos through AuthImage.
- 2026-06: Railway go-live checklist written at docs/RAILWAY_GO_LIVE.md.

## Known limits
- The preview test copy (Postgres plus the supervisor program) is lost when the container restarts and has to be set up again.
- The live server needs this backend deployed to Railway, with `PHOTO_STORAGE=emergent`, `EMERGENT_LLM_KEY` and `PUBLIC_API_URL`, before the new app build ships.
- The new native modules (netinfo, file-system) need a new store build.
- Store publishing: the app is on the user's own EAS account. Signing and listing continuity with Emergent Publish must be confirmed with support@emergent.sh.

## Backlog
- P0: deploy the backend to Railway, then build and submit 1.1.0
- P1: move existing Cloudinary photos to Emergent storage; preload the vehicle at login
- P2: dashboard view of trips that synced late
