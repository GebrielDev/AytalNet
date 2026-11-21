"""Seeds realistic demo data into the PREVIEW TEST database for store screenshots.

James Wilson (james@fleet.com) gets: vehicle DEF-9012, 5 completed trips over the
last 2 weeks with odometer/plate/selfie photos, an active trip with 4 stops (2 done),
and a message from the office. Safe to re-run only on a fresh test DB.
"""
import io
import json
import subprocess
from datetime import datetime, timedelta, timezone

import requests
from PIL import Image, ImageDraw, ImageFont

API = "http://127.0.0.1:8002/api"
FONT = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"


def font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default()


def odometer_jpg(reading: int) -> bytes:
    img = Image.new("RGB", (640, 480), (18, 22, 30))
    d = ImageDraw.Draw(img)
    d.ellipse((70, 40, 570, 540), outline=(60, 70, 90), width=10)
    d.rounded_rectangle((150, 250, 490, 330), radius=10, fill=(5, 8, 12), outline=(90, 100, 120), width=3)
    d.text((170, 258), f"{reading:06d}", font=font(56), fill=(245, 245, 235))
    d.text((280, 345), "MILES", font=font(22), fill=(150, 160, 175))
    return _jpg(img)


def plate_jpg(plate: str) -> bytes:
    img = Image.new("RGB", (640, 480), (70, 75, 85))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((120, 160, 520, 320), radius=16, fill=(245, 245, 240), outline=(30, 30, 30), width=6)
    d.text((215, 172), "ARIZONA", font=font(26), fill=(150, 40, 40))
    d.text((165, 215), plate, font=font(64), fill=(20, 30, 80))
    return _jpg(img)


def selfie_jpg() -> bytes:
    img = Image.new("RGB", (480, 640), (120, 160, 200))
    d = ImageDraw.Draw(img)
    d.ellipse((150, 140, 330, 340), fill=(224, 182, 150))
    d.rectangle((110, 360, 370, 640), fill=(30, 70, 140))
    return _jpg(img)


def _jpg(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return buf.getvalue()


def login(path, email, password):
    r = requests.post(f"{API}{path}", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


def sql(q):
    subprocess.run(["su", "postgres", "-c", f'psql -d fleet_test -c "{q}"'], check=True, capture_output=True)


admin = login("/auth/login", "admin@fleet.com", "AdminTest123!")
VEHICLE, PLATE = 3, "DEF-9012"
requests.put(f"{API}/drivers/3", json={"assignedVehicleId": VEHICLE}, headers=admin, timeout=30).raise_for_status()
for did, vid in [(1, 1), (2, 2), (4, 4), (5, 6)]:
    requests.put(f"{API}/drivers/{did}", json={"assignedVehicleId": vid}, headers=admin, timeout=30)
driver = login("/auth/driver/login", "james@fleet.com", "DriverTest123!")

LAT, LNG = 33.4484, -112.0740  # Phoenix
odo = 48210
now = datetime.now(timezone.utc)
plan = [(13, 42.6), (10, 18.3), (6, 67.9), (3, 25.1), (1, 33.8)]
for days_ago, miles in plan:
    files = {
        "start_odometer": ("start_odometer.jpg", odometer_jpg(odo), "image/jpeg"),
        "license_plate": ("license_plate.jpg", plate_jpg(PLATE), "image/jpeg"),
        "driver_selfie": ("driver_selfie.jpg", selfie_jpg(), "image/jpeg"),
    }
    payload = {"vehicleId": VEHICLE, "startOdometer": odo, "startLatitude": LAT, "startLongitude": LNG}
    r = requests.post(f"{API}/trips/start", data={"payload": json.dumps(payload)}, files=files, headers=driver, timeout=60)
    r.raise_for_status()
    trip_id = r.json()["id"] if "id" in r.json() else r.json()["trip"]["id"]
    end = odo + round(miles)
    requests.post(f"{API}/trips/{trip_id}/photos", data={"photoType": "end_odometer"},
                  files={"photo": ("end.jpg", odometer_jpg(end), "image/jpeg")}, headers=driver, timeout=60).raise_for_status()
    requests.put(f"{API}/trips/{trip_id}/end", json={"endOdometer": end, "endLatitude": LAT + 0.2, "endLongitude": LNG + 0.1},
                 headers=driver, timeout=30).raise_for_status()
    start = now - timedelta(days=days_ago, hours=3)
    finish = start + timedelta(minutes=35 + int(miles))
    sql(f"UPDATE trips SET start_time='{start.isoformat()}', end_time='{finish.isoformat()}', "
        f"duration_minutes={35 + int(miles)} WHERE id={trip_id};")
    odo = end + 3

# Active trip with a multi-stop job.
stops = [
    {"address": "Sky Harbor Airport, Terminal 4, Phoenix, AZ", "note": "Pick up crew", "latitude": 33.4352, "longitude": -112.0101},
    {"address": "1 E Washington St, Phoenix, AZ", "note": "Drop 2 passengers", "latitude": 33.4486, "longitude": -112.0733},
    {"address": "Tempe Marketplace, Tempe, AZ", "note": "Wait at main entrance", "latitude": 33.4300, "longitude": -111.8970},
    {"address": "Mesa Riverview, Mesa, AZ", "note": "Final drop-off", "latitude": 33.4370, "longitude": -111.8670},
]
requests.put(f"{API}/drivers/3/stops", json={"stops": [{**s} for s in stops]}, headers=admin, timeout=30).raise_for_status()
files = {
    "start_odometer": ("start_odometer.jpg", odometer_jpg(odo), "image/jpeg"),
    "license_plate": ("license_plate.jpg", plate_jpg(PLATE), "image/jpeg"),
    "driver_selfie": ("driver_selfie.jpg", selfie_jpg(), "image/jpeg"),
}
payload = {"vehicleId": VEHICLE, "startOdometer": odo, "startLatitude": 33.4352, "startLongitude": -112.0101}
requests.post(f"{API}/trips/start", data={"payload": json.dumps(payload)}, files=files, headers=driver, timeout=60).raise_for_status()
my_stops = requests.get(f"{API}/drivers/my-stops", headers=driver, timeout=30).json()
for i, s in enumerate(my_stops[:2]):
    requests.post(f"{API}/drivers/my-stops/{s['id']}/arrive",
                  data={"latitude": str(s["latitude"]), "longitude": str(s["longitude"]), "odometer": str(odo + 4 + i * 9)},
                  files={"photo": ("stop.jpg", odometer_jpg(odo + 4 + i * 9), "image/jpeg")}, headers=driver, timeout=60).raise_for_status()
sql("UPDATE trips SET start_time = now() - interval '52 minutes' WHERE driver_id=3 AND status='in_progress';")
requests.post(f"{API}/drivers/3/notes", json={"message": "Crew flight landed early - head to Tempe when ready."},
              headers=admin, timeout=30).raise_for_status()
print("Screenshot data ready for james@fleet.com")
