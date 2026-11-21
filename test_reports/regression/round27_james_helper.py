# Round 27 helper: start a TEST_ trip for james / post a TEST_ note / cleanup. Usage: python3 round27_james_helper.py start|note|cleanup <ids>
import io, json, subprocess, sys, uuid
import requests
from PIL import Image

API = "http://127.0.0.1:8002/api"


def psql(q):
    return subprocess.run(["su", "postgres", "-c", f'psql -d fleet_test -tAc "{q}"'], capture_output=True, text=True).stdout.strip()


def tok(path, email, pw):
    d = requests.post(f"{API}{path}", json={"email": email, "password": pw}, timeout=20).json()
    return {"Authorization": "Bearer " + (d.get("accessToken") or d.get("token"))}


def jpg(c=(120, 100, 200)):
    b = io.BytesIO(); Image.new("RGB", (64, 64), c).save(b, "JPEG"); return b.getvalue()


cmd = sys.argv[1]
if cmd == "start":
    j = tok("/auth/driver/login", "james@fleet.com", "DriverTest123!")
    odo = float(psql("select current_odometer from vehicles where id=3")) + 5
    payload = {"vehicleId": 3, "startOdometer": odo, "startLatitude": 40.7, "startLongitude": -74.0, "clientRef": f"TEST_{uuid.uuid4()}"}
    files = {k: (f"{k}.jpg", jpg(), "image/jpeg") for k in ["license_plate", "driver_selfie", "start_odometer"]}
    r = requests.post(f"{API}/trips/start", headers=j, data={"payload": json.dumps(payload)}, files=files, timeout=60)
    t = r.json(); t = t.get("trip", t)
    print("TRIP", r.status_code, t.get("id"))
elif cmd == "note":
    a = tok("/auth/login", "admin@fleet.com", "AdminTest123!")
    r = requests.post(f"{API}/drivers/3/notes", headers=a, json={"message": sys.argv[2]}, timeout=20)
    n = r.json(); print("NOTE", r.status_code, n.get("id") or n.get("note", {}).get("id"))
elif cmd == "cleanup":
    a = tok("/auth/login", "admin@fleet.com", "AdminTest123!")
    trip = sys.argv[2]
    print(requests.post(f"{API}/trips/{trip}/cancel", headers=a, timeout=20).status_code)
    print(psql(f"delete from trip_photos where trip_id={int(trip)}"), psql(f"delete from trips where id={int(trip)}"))
    for nid in sys.argv[3:]:
        print(psql(f"delete from driver_notes where id={int(nid)} and message like 'TEST_%'"))
