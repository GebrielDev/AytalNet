"""Captures store screenshots of the driver app (preview) at iPhone 6.7" size.

Output: /app/docs/store-screenshots/<scheme>-<n>-<name>.png (1290x2796).
Run after scripts/seed_screenshot_data.py.
"""
import asyncio
import os

from playwright.async_api import async_playwright

URL = os.environ.get("APP_URL", "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com")
# ios = 6.7" iPhone (1290x2796); android = 1080x1920 (Play needs a ratio of 2:1 or less)
SIZE = os.environ.get("SIZE", "ios")
VIEWPORT = {"ios": (430, 932), "android": (360, 640)}[SIZE]
OUT = f"/app/docs/store-screenshots/{SIZE}"
os.makedirs(OUT, exist_ok=True)


async def settle(page, ms=2500):
    await page.wait_for_timeout(ms)


async def shoot(page, scheme, n, name):
    path = f"{OUT}/{scheme}-{n}-{name}.png"
    await page.screenshot(path=path)
    print("saved", path)


async def run(scheme):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": VIEWPORT[0], "height": VIEWPORT[1]}, device_scale_factor=3, color_scheme=scheme)
        # Skip the first-launch notice except where we photograph it.
        page = await ctx.new_page()
        await page.goto(URL)
        await page.get_by_test_id("login-email-input").wait_for(timeout=90000)
        await settle(page)
        if scheme == "dark":
            await page.get_by_test_id("privacy-notice").wait_for(timeout=20000)
            await settle(page, 800)
            await shoot(page, scheme, 6, "privacy-notice")
        await page.get_by_test_id("privacy-notice-ok").click()
        await settle(page, 800)
        await page.get_by_test_id("login-email-input").fill("james@fleet.com")
        await page.get_by_test_id("login-password-input").fill("DriverTest123!")
        if scheme == "dark":
            await shoot(page, scheme, 5, "sign-in")
        await page.get_by_test_id("login-submit-button").click()
        await page.get_by_test_id("home-active-trip-banner").wait_for(timeout=30000)
        await settle(page, 3000)
        await shoot(page, scheme, 1, "home")
        await page.get_by_test_id("home-active-trip-banner").click()
        await page.get_by_test_id("notes-card").wait_for(timeout=30000)
        await settle(page, 3000)
        await shoot(page, scheme, 2, "active-trip-message")
        await page.mouse.wheel(0, 600 if SIZE == "ios" else 450)
        await settle(page, 1500)
        await shoot(page, scheme, 3, "multi-stop-job")
        await page.goto(URL)  # back to Home (sign-in is kept)
        await page.get_by_test_id("home-trip-history-button").wait_for(timeout=30000)
        await page.get_by_test_id("home-trip-history-button").click()
        await page.get_by_test_id("history-summary").wait_for(timeout=30000)
        await settle(page, 5000)
        await shoot(page, scheme, 4, "trip-history")
        await browser.close()


async def main():
    for scheme in ("dark", "light"):
        await run(scheme)


asyncio.run(main())
