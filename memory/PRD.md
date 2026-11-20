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

- 2026-06: Destinations and Navigate. Dispatchers set or clear a driver's destination from the Drivers page. The app shows it on Home and Active Trip, also offline, with Navigate → Google Maps / Apple Maps (iOS) / Waze.
- 2026-06: Alert recipients. Admins can switch late trip alerts on or off for each user on the Users page (`users.late_trip_alerts`).
- 2026-06: Signal coverage map. A dashboard Coverage page (Leaflet/OpenStreetMap) uses `GET /api/trips/offline-locations`.

- 2026-06: Live destination updates. A socket.io `/driver` namespace (driver tokens only, room `driver:<id>`) pushes `destination:updated`, and the app listens in liveUpdates.ts.
- 2026-06: Destination history. Trips record destinationAddress, note and coordinates at start; the app sends the address it showed.
- 2026-06: Arrival check. Destinations are looked up on OpenStreetMap (Nominatim) when saved. At trip end the server stores endDistanceMeters and arrivedAtDestination (within `ARRIVAL_RADIUS_METERS`, 300 by default). The dashboard shows a badge and an Arrival row.
- 2026-06: Coverage export. The Coverage page has a "Download spreadsheet" CSV button.

- 2026-06: Address search. `GET /api/geo/search` (Photon/OSM, cached for 10 minutes, biased toward Phoenix) backs the dashboard AddressSearch, which suggests addresses while typing.
- 2026-06: Multi-stop jobs. A `driver_stops` table with `GET/PUT /api/drivers/:id/stops`, `GET /api/drivers/my-stops` and `POST /api/drivers/my-stops/:id/arrive` (checked against the 300 m radius). The current stop is copied onto the driver's destination fields, and the app shows StopsCard: Navigate on every stop, "I've arrived" on the next. Stop changes reach the phone live via `stops:updated`.
- 2026-06: Arrival notices. A dashboard-wide toast (ArrivalNotices) listens for socket `driver:arrived`, sent when the driver taps "I've arrived" or ends a trip within range of a stop.

- 2026-06: Stops board. A dashboard /stops page (`GET /api/drivers/stops-board`) shows every active driver's stops, progress and trip status. It updates live from socket `stops:changed`, `driver:arrived` and the trip events.

- 2026-06: Board map view. The Stops board has a Leaflet map showing each driver's last known location (from the latest trip start/end or stop arrival; there is no continuous tracking) and their next stop, joined by a dashed line. Clicking a card focuses that driver. `driver_stops` gained arrived_latitude/longitude.

## Known limits
- The preview test copy (Postgres plus the supervisor program) is lost when the container restarts and has to be set up again.
- The live server needs this backend deployed to Railway, with `PHOTO_STORAGE=emergent`, `EMERGENT_LLM_KEY` and `PUBLIC_API_URL`, before the new app build ships.
- The new native modules (netinfo, file-system) need a new store build.
- Store publishing: the app is on the user's own EAS account. Signing and listing continuity with Emergent Publish must be confirmed with support@emergent.sh.

## Backlog
- P0: deploy the backend to Railway, then build and submit 1.1.0
- P1: move existing Cloudinary photos to Emergent storage; preload the vehicle at login
- P2: dashboard view of trips that synced late
