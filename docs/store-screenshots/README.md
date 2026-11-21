# Store screenshots — STS Driver App 1.1.0

Taken from the preview test copy with demo data (driver "James Wilson", Phoenix stops).
No real driver data appears in them.

| Folder | Size | Use for |
|---|---|---|
| `ios/` | 1290 × 2796 | App Store — iPhone 6.7" / 6.9" display |
| `android/` | 1080 × 1920 | Google Play — phone screenshots (2–8) |

Suggested order and captions (dark mode leads; light set as alternates):
1. `dark-1-home` — "Your day at a glance: stops, active trip and history"
2. `dark-3-multi-stop-job` — "Multi-stop jobs with one-tap Navigate"
3. `dark-2-active-trip-message` — "Messages from dispatch with one-tap replies"
4. `dark-4-trip-history` — "30-day trip history with odometer photos"
5. `dark-5-sign-in` — "Secure sign-in for STS drivers"
6. `dark-6-privacy-notice` — "Clear about location and photos"
Light-mode versions: `light-1…4`.

To retake them: `python3 scripts/seed_screenshot_data.py` (fresh test DB), then
`SIZE=ios python3 scripts/store_screenshots.py` and `SIZE=android python3 scripts/store_screenshots.py`.
