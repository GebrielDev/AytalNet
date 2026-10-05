# Play Store screenshots

Google rejects a listing whose screenshots do not show the app
("Your store listing does not clearly describe your app's features"). The
first submission failed exactly that way: both phone screenshots were the STS
logo, so a reviewer could not see a single app screen.

These scripts photograph the real screens, with no device or emulator, by
rendering the app through `react-native-web` and driving it with Playwright.
Output is 1080x1920 PNGs, which satisfies Play's 9:16 / 320-3840px rule.

## Regenerating

Playwright is not a dependency of this app; install it wherever you run this
(`npm i -g playwright`), and point `CHROME_PATH` at a Chromium binary if the
bundled one is not where Playwright expects.

```sh
cd driver-app

# Pass A - home, active trip, login.
MOCK_ACTIVE=1 node tools/store-screenshots/mock-api.js &
EXPO_PUBLIC_API_URL=http://localhost:4100/api CI=1 npx expo start --web --port 8081 &
node tools/store-screenshots/capture.js A

# Pass B - start trip. Home only offers "Start New Trip" when nothing is running,
# so the mock API has to stop reporting an active trip first.
kill %1 && MOCK_ACTIVE=0 node tools/store-screenshots/mock-api.js &
node tools/store-screenshots/capture.js B
```

Screenshots land in `store-assets/play/screenshots/`.

## Why a mock backend

`mock-api.js` serves invented drivers, vehicles and trips. Pointing the capture
at production would put real driver names, plates and locations into a public
store listing. Its field names (`durationMinutes`, `totalMileage`) must track
`backend/src/models/Trip.ts`, or the trip history table renders as `-`.

## Known gap

The End Trip screen is not captured. It sits behind an `Alert.alert`
confirmation on the Active Trip screen, and `react-native-web` implements
`Alert` as a no-op, so the button does nothing in this harness. It works
normally on Android. Capturing it would need a device, or a temporary
`linking` config on the navigator.
