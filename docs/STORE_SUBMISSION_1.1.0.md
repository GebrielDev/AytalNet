# STS Driver App 1.1.0 — store submission pack

Copy the blocks below into App Store Connect and Google Play Console.
Bundle / package: `us.startechsolutions.driverapp` · Version **1.1.0**
(build numbers are bumped automatically: `eas.json` uses remote versions with
auto-increment; Emergent builds set their own).

---

## 1. Release notes ("What's new")

**Short (Play, ≤ 500 characters)**
```
• Works with no signal: trips, stop arrivals, odometer readings and photos are saved on the phone and sent when you're back online
• Dark mode that follows your phone's setting
• Step-by-step trip start with bigger buttons
• Multi-stop jobs with one-tap Navigate (Google Maps, Apple Maps, Waze)
• Messages from the office with quick replies
• Trip history for the last 30 days
• Sign-in is now stored in the phone's secure storage
```

**Full (App Store)**
```
What's new in 1.1.0

• Keep working with no signal — trips, stop arrivals, odometer readings and photos are saved on your phone and sent automatically when you're back online.
• Dark mode — the app follows your phone's light or dark setting for night shifts.
• A clearer, step-by-step trip start with bigger buttons.
• Multi-stop jobs — see your stops in order, tap Navigate to open Google Maps, Apple Maps or Waze, and confirm arrival with an optional odometer photo.
• Messages from the office appear on your trip screen; answer with one tap ("On my way", "Call me", "Running late").
• Trip history — miles, odometer readings and photos from the last 30 days.
• Your sign-in is now kept in the phone's secure storage.
• Privacy notice, privacy policy and help links in the app.
```

---

## 2. Permission explanations

| Permission | Shown to the driver (iOS text) | Why it is needed | When it is asked |
|---|---|---|---|
| Camera (iOS `NSCameraUsageDescription`, Android `CAMERA`) | "Photograph your odometer, plate and selfie for trip records." | Odometer, license-plate and driver photos at trip start/end, optional odometer photo at a stop | Only when the driver taps a photo button |
| Location while using the app (iOS `NSLocationWhenInUseUsageDescription`, Android `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`) | "Records trip routes and confirms arrival at your stops." | Trip start/end position, live position for the dispatcher **only while a trip is open**, confirming the driver is at a stop | When the driver starts a trip or taps "I've arrived" |

No background location, microphone, contacts or photo-library access is requested.
If a permission is refused the app explains why and offers **Open Settings**.

---

## 3. Reviewer demo account

Create (or refresh) it on the **live Railway database** — it gets its own
vehicle `DEMO-0001` so it never touches real drivers' data:

```
# Railway → backend service → Shell
DEMO_DRIVER_PASSWORD='<choose a strong password>' npm run demo:driver
```

The script is safe to re-run; it prints the credentials and leaves a welcome
message from the office so reviewers can try the reply buttons.

| Field | Value |
|---|---|
| Username | `play.review@startechsolutions.us` |
| Password | the one you set above |

### Notes for the reviewer (paste into App Review Information / App access)
```
STS Driver App is an internal tool for STS Transportation's employed drivers. Accounts are created by the company's dispatchers; there is no public sign-up, so account deletion is handled by the employer (drivers can request it at support@startechsolutions.us).

Demo login:
  Email: play.review@startechsolutions.us
  Password: <password>

To try it:
1. Sign in and read the privacy notice, then tap "Got it".
2. Tap "+ Start New Trip". Vehicle DEMO-0001 is already assigned. Follow the steps: enter any odometer value (e.g. 10010), take the odometer, plate and selfie photos (any picture is fine), and start the trip.
3. On the trip screen you'll see a message from the office — tap a quick reply.
4. Tap "End Trip", enter a higher odometer value (e.g. 10025), take the photo and complete the trip.
5. "Last 30 days ›" on the home screen shows the trip history.

Location is used only while a trip is open, to record the route; the camera only when the driver taps a photo button.
Privacy policy: https://driverapp.startechsolutions.us/privacy
```

---

## 4. Privacy / data forms

**Apple — App Privacy ("Data linked to the user", used for App Functionality, not tracking):**
- Contact info: name, email address
- Location: precise location
- User content: photos
- Identifiers: user ID
- No data used for tracking or advertising.

**Google Play — Data safety:**
| Data | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| Name, email | Yes | No | App functionality, account management | Required |
| Precise location | Yes | No | App functionality | Required for trips |
| Photos | Yes | No | App functionality | Required for trips |
| User IDs | Yes | No | Account management | Required |

- Data is encrypted in transit (HTTPS): **Yes**
- Users can request data deletion: **Yes** — via support@startechsolutions.us (accounts are employer-managed)

---

## 5. Links
- Privacy policy: https://driverapp.startechsolutions.us/privacy
- Support / marketing URL: https://driverapp.startechsolutions.us/
- Support email: support@startechsolutions.us

## 6. Before you press Submit
- [ ] Railway is updated to the current code (see `RAILWAY_GO_LIVE.md`) — the app needs it.
- [ ] Demo account created on the live server and you signed in with it once on a phone.
- [ ] New build installed on a real phone: camera, location, dark mode and offline mode checked.
- [ ] Screenshots refreshed if the store listing still shows the old look.
