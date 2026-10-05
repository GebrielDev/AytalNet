// Captures Play-ready phone screenshots of the real driver-app screens.
//
// There is no device or emulator in CI, so the app is rendered through
// react-native-web and photographed with Playwright at 1080x1920 (Play wants
// 9:16, each side 320-3840px).
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

const OUT = process.env.SHOT_DIR ||
  path.join(__dirname, '../../../store-assets/play/screenshots');
const APP = process.env.APP_URL || 'http://localhost:8081/';
const W = 1080, H = 1920, SCALE = 3;
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
    console.log('captured', name);
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
