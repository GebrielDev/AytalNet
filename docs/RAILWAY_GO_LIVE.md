# Railway go-live checklist

This rolls out offline trips, Emergent photo storage, private photo links and
late-trip alerts to production. Follow the steps in order: the new driver app
build needs the new server, and the server must be live before you move any
photos.

## 1. Back up the database
Railway → your Postgres service → **Backups** → create a backup. Step 2 adds
columns and tables on start-up (trips, drivers, users and driver_stops columns,
plus the new `driver_notes`, `odometer_corrections` and `auth_rate_limits`
tables). Nothing is dropped, but a backup is what lets you roll back.

## 2. Deploy the backend
1. Merge these changes into the branch Railway deploys (normally `main`) and push.
2. Railway builds `backend/` with its Dockerfile.
3. In the deploy logs, confirm these lines:
   - `Migration: trips.client_ref column ensured`
   - `Migration: trips.end_received_at column ensured`
   - `Server running on port ...`

## 3. Add the new variables (backend service → Variables)
| Variable | Value | What it does |
|---|---|---|
| `PHOTO_STORAGE` | `emergent` | New photos go to Emergent storage instead of Cloudinary |
| `EMERGENT_LLM_KEY` | your Emergent key (Emergent → Profile → Universal Key) | Access to the storage account; uses your Emergent balance |
| `PUBLIC_API_URL` | `https://api.startechsolutions.us/api` | Base address for the new photo links |
| `LATE_TRIP_ALERT_MINUTES` | `60` (optional) | How late a trip must arrive before dispatchers get an email |
| `ALERT_TIMEZONE` | `America/Phoenix` (optional) | Time zone used for the times in alert emails |
| `TRUST_PROXY_HOPS` | `1` (optional) | Lets login attempt limits see the real client address behind Railway's proxy |
| `AUTH_RATE_LIMIT_PER_ACCOUNT` | `10` (optional) | Failed tries per email per 15 min before "Too many attempts" |
| `AUTH_RATE_LIMIT_PER_IP` | `50` (optional) | Failed tries per network per 15 min |
| `ODOMETER_JUMP_MILES` | `300` (optional) | Stop readings this far past the previous one are flagged |

Keep `CLOUDINARY_*` set. Old photos stay on Cloudinary until step 6.
`RESEND_API_KEY` and `EMAIL_FROM` must already be set (password reset uses
them), because late-trip alerts are sent the same way. Saving the variables
redeploys the service.

## 4. Check it works
- Open `https://api.startechsolutions.us/health`. It should return `{"status":"ok"}`.
- Start and end a test trip from the current app. Then open it on the dashboard
  and check the photos appear.

## 5. Deploy the web dashboard
Redeploy the `web-dashboard` service. It has the "Recorded offline only"
filter, and it loads private photos while you are signed in. Deploy it at the
same time as step 3: once storage is switched on, new photos only load in the
updated dashboard.

In the `web-dashboard` service variables, set `VITE_API_URL` to your live API
(for example `https://api.startechsolutions.us/api`) before it builds. Railway
serves the dashboard at the root of its own address, so the normal
`vite build` is right there (the `--base=/api/dashboard/` flag is only for the
preview test copy).

## 6. Move the old photos (backend service → Shell, or a one-off command)
```bash
npm run photos:migrate                          # report only
npm run photos:migrate -- --commit              # copy and repoint
npm run photos:migrate -- --commit --delete-cloudinary   # optional, once you've checked the photos
```
You can run it more than once; each run moves only what is left. Old Cloudinary
links work for anyone who has them, so photos are fully private only after
`--delete-cloudinary`.

## 7. Release the driver app
The app adds offline saving (netinfo, file-system), encrypted sign-in storage
(secure-store), dark mode (system-ui) and new permission texts, so it needs a
new store build, not just an update. Its `EXPO_PUBLIC_API_URL` must be
`https://api.startechsolutions.us/api` (the default if unset). Build and submit version 1.1.0 as you normally do,
only after steps 2–4.

## 8. Update the retention job
The monthly retention cron runs from the same code. Give it the same
`PHOTO_STORAGE`, `EMERGENT_LLM_KEY` and `PUBLIC_API_URL` variables, so it can
erase photos stored in Emergent storage.

## Rolling back
Remove `PHOTO_STORAGE` to go back to Cloudinary for new photos. Photos already
in Emergent storage keep working while `EMERGENT_LLM_KEY` stays set. The new
columns are harmless to older code.

## After go-live: what drivers and dispatchers notice
- Everyone who changes or resets a password is signed out on their other devices.
- Existing sign-ins keep working after the deploy (old tokens count as version 0).
- New dashboard pages: Stops board, Coverage, Corrections; Drivers page has "Note".

## Emergent deploy (bridge)
The Emergent deployment runs `backend/server.py`, a small bridge that forwards
every `/api` request and live update to this Railway API. Railway must be on the
current code first (older code has no driver live-update channel).
- On Railway (backend variables) set `BRIDGE_SHARED_SECRET` to a long random value.
- In Emergent (deployment secrets) set the same `BRIDGE_SHARED_SECRET`, and
  `FLEET_API_UPSTREAM=https://api.startechsolutions.us` (the default).
With the shared secret, login attempt limits count each real caller instead of
treating everyone behind the bridge as one address.

## Step-by-step walkthrough (check after every step)
Run `bash docs/check-go-live.sh` (see the top of the file for settings) after each step.
On 21 Nov 2026 it reported: Railway up, but **on older code** (no driver live channel).

1. **Back up** Postgres (Railway → Postgres → Backups → Create). Nothing to check yet.
2. **Set backend variables** (Railway → backend → Variables): `PHOTO_STORAGE=emergent`,
   `EMERGENT_LLM_KEY`, `PUBLIC_API_URL=https://api.startechsolutions.us`, and a new
   `BRIDGE_SHARED_SECRET` (any long random text, e.g. from a password manager). Save — Railway redeploys.
3. **Deploy the current backend code** (push the branch Railway watches, or Deploy → Redeploy latest).
   Watch the deploy log for `Server running` and no `ALTER TABLE` errors.
   ✔ Check: `Railway runs the 1.1.0 code` must now PASS.
4. **Reviewer account**: Railway → backend → Shell →
   `DEMO_DRIVER_PASSWORD='<strong password>' npm run demo:driver`.
   ✔ Check: run the script with `DEMO_EMAIL` / `DEMO_PASSWORD` — sign-in and new endpoints PASS.
5. **Dashboard**: set `VITE_API_URL=https://api.startechsolutions.us/api` on the web-dashboard service and redeploy.
   ✔ Check by hand: sign in at the dashboard; Stops, Coverage and Corrections pages open.
6. **Old photos**: Railway → backend → Shell → `npm run photos:migrate`.
   ✔ Check by hand: open an old trip on the dashboard; its photos still show.
7. **Emergent**: add the same `BRIDGE_SHARED_SECRET` (and `FLEET_API_UPSTREAM=https://api.startechsolutions.us`)
   to the Emergent deployment secrets, then Publish / Redeploy.
   ✔ Check: run the script with `BRIDGE=https://<your emergent app address>` — all bridge lines PASS.
8. **Phones**: generate the 1.1.0 builds and follow `STORE_SUBMISSION_1.1.0.md`.
