# STS Fleet Management – PRD

## Original request
"Build a mobile app: read from github" – the imported GitHub repo is an existing fleet management system
(Node/Express/PostgreSQL backend on Railway, React web dashboard, Expo SDK 57 driver app "STS Driver App").

## User choices
- Get driver app running here; later add features/fixes; publish to Play/App Store
- Server: live Railway server (https://api.startechsolutions.us/api) and a test copy
- File storage: Emergent managed storage (current backend uses Cloudinary – not changed yet)

## Done (2026-06)
- `/app/frontend` symlink -> `/app/driver-app` so the preview/Expo Go runs the driver app
- Installed driver-app deps (npm ci); added gitignored `driver-app/.env` with EXPO_PUBLIC_API_URL = live server
- Verified login screen renders; live API reachable (401 on bad creds without browser Origin)

## Known limits
- Web preview is blocked by the live server's CORS (403 for preview origin); phones via Expo Go are unaffected
- Test copy of the server needs PostgreSQL + Node backend, not available in this preview yet
- Store publishing: app already has its own EAS project / Apple team / Play listing (versionCode 8) – needs decision

## Backlog
- P0: decide store publishing path (existing EAS account vs Emergent Publish)
- P1: test-copy backend with demo data; move photo storage from Cloudinary to Emergent storage
- P2: features/fixes requested by user
