# Railway go-live checklist

This rolls out offline trips, Emergent photo storage, private photo links and
late-trip alerts to production. Follow the steps in order: the new driver app
build needs the new server, and the server must be live before you move any
photos.

## 1. Back up the database
Railway → your Postgres service → **Backups** → create a backup. Step 2 adds
columns (`trips.client_ref`, `trips.end_received_at`), and a backup is what lets
you roll back.

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
The app adds offline saving (netinfo, file-system), so it needs a new store
build, not just an update. Build and submit version 1.1.0 as you normally do,
only after steps 2–4.

## 8. Update the retention job
The monthly retention cron runs from the same code. Give it the same
`PHOTO_STORAGE`, `EMERGENT_LLM_KEY` and `PUBLIC_API_URL` variables, so it can
erase photos stored in Emergent storage.

## Rolling back
Remove `PHOTO_STORAGE` to go back to Cloudinary for new photos. Photos already
in Emergent storage keep working while `EMERGENT_LLM_KEY` stays set. The new
columns are harmless to older code.
