# Store screenshots

Google rejects a listing whose screenshots do not show the app
("Your store listing does not clearly describe your app's features"). The
first submission failed exactly that way: both phone screenshots were the STS
logo, so a reviewer could not see a single app screen.

These scripts photograph the real screens, with no device or emulator, by
rendering the app through `react-native-web` and driving it with Playwright.
Output size depends on the target store - see Devices below.

## Devices

`SHOT_DEVICE` picks the size and the output directory:

| `SHOT_DEVICE` | Size | Output |
| --- | --- | --- |
| `android` (default) | 1080x1920 | `store-assets/play/screenshots/` |
| `iphone` | 1320x2868 | `store-assets/appstore/screenshots/` |

Google Play wants 9:16 with each side between 320 and 3840px. Apple asks for
its 6.9" iPhone size first, which is 1320x2868.

## Regenerating

Playwright is not a dependency of this app; install it wherever you run this
(`npm i -g playwright`), and point `CHROME_PATH` at a Chromium binary if the
bundled one is not where Playwright expects.

```sh
cd driver-app

# Pass A - home, active trip, login.
MOCK_ACTIVE=1 node tools/store-screenshots/mock-api.js &
EXPO_PUBLIC_API_URL=http://localhost:4100/api CI=1 npx expo start --web --port 8081 &
SHOT_DEVICE=iphone node tools/store-screenshots/capture.js A

# Pass B - start trip. Home only offers "Start New Trip" when nothing is running,
# so the mock API has to stop reporting an active trip first.
kill %1 && MOCK_ACTIVE=0 node tools/store-screenshots/mock-api.js &
SHOT_DEVICE=iphone node tools/store-screenshots/capture.js B
```

Drop `SHOT_DEVICE` for the Play set.

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
