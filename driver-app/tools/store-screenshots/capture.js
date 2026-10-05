// Captures store-ready phone screenshots of the real driver-app screens.
//
// There is no device or emulator in CI, so the app is rendered through
// react-native-web and photographed with Playwright. SHOT_DEVICE picks the
// size and output directory - see DEVICES below.
//
// The screens are the app's own, unmodified - only the backend is swapped for
// mock-api.js, so no production data ends up in a public store listing.
//
//   node tools/store-screenshots/capture.js A   # home + active trip + login
//   node tools/store-screenshots/capture.js B   # start trip
//
// Pass A needs the mock API started with MOCK_ACTIVE=1, pass B with
// MOCK_ACTIVE=0: the Home screen only offers "Start New Trip" when no trip is
// already running. See README.md for the full sequence.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Device presets. Play wants 9:16 with each side 320-3840px; Apple wants its
// 6.9" iPhone size, which is what App Store Connect asks for first.
const DEVICES = {
  android: { w: 1080, h: 1920, scale: 3, dir: 'store-assets/play/screenshots' },
  iphone: { w: 1320, h: 2868, scale: 3, dir: 'store-assets/appstore/screenshots' },
};

const DEVICE = (process.env.SHOT_DEVICE || 'android').toLowerCase();
const preset = DEVICES[DEVICE];
if (!preset) {
  throw new Error(`Unknown SHOT_DEVICE "${DEVICE}". Known: ${Object.keys(DEVICES).join(', ')}`);
}

const OUT = process.env.SHOT_DIR || path.join(__dirname, '../../..', preset.dir);
const APP = process.env.APP_URL || 'http://localhost:8081/';
const W = preset.w, H = preset.h, SCALE = preset.scale;
const PASS = (process.argv[2] || 'A').toUpperCase();

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: { width: W / SCALE, height: H / SCALE },
    deviceScaleFactor: SCALE,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));

  const shot = async (name) => {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log(`captured ${name} (${DEVICE} ${W}x${H})`);
  };

  await page.goto(APP, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(8000);

  if (PASS === 'A') await shot('4-login');

  // mock-api.js accepts any credentials.
  await page.getByPlaceholder('Email').fill('marcus.reed@startechsolutions.us');
  await page.getByPlaceholder('Password').fill('driver-demo-password');
  await page.getByText('Sign In', { exact: true }).click();
  await page.waitForTimeout(6000);

  if (PASS === 'A') {
    await shot('1-home');
    await page.getByText('Trip in Progress').click();
    await shot('3-active-trip');
    // The End Trip screen is not reachable here: it sits behind an
    // Alert.alert confirmation, which react-native-web does not implement.
  } else {
    await page.getByText('+ Start New Trip').click();
    await page.waitForTimeout(4000);
    const odo = page.getByPlaceholder('Enter current odometer');
    if (await odo.count()) await odo.fill('48210');
    await shot('2-start-trip');
  }

  await browser.close();
};

main().catch(e => { console.error(e); process.exit(1); });
