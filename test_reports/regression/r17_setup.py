# Round 17 UI helper: `setup` starts TEST_ trip for James + 4 TEST_ stops; `state` prints trip start + stops; `cleanup` cancels trip + clears stops
import io, json, subprocess, sys, uuid, requests
from PIL import Image
BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"
JAMES = 3
LAT, LNG = 33.4497, -111.9464


def psql(sql):
    return subprocess.run(["su", "postgres", "-c", f'psql -d fleet_test -At -c "{sql}"'], capture_output=True, text=True).stdout.strip()


def jpg():
    b = io.BytesIO(); Image.new("RGB", (8, 8), (200, 10, 10)).save(b, "JPEG"); return b.getvalue()


a = {"Authorization": "Bearer " + requests.post(f"{BASE}/auth/login", json={"email": "admin@fleet.com", "password": "AdminTest123!"}).json()["accessToken"]}
j = {"Authorization": "Bearer " + requests.post(f"{BASE}/auth/driver/login", json={"email": "james@fleet.com", "password": "DriverTest123!"}).json()["accessToken"]}
cmd = sys.argv[1]
if cmd == "setup":
    odo = float(psql("select current_odometer from vehicles where id=3")) + 5
    payload = {"vehicleId": 3, "startOdometer": odo, "startLatitude": LAT, "startLongitude": LNG, "clientRef": f"TEST_{uuid.uuid4()}"}
    files = {k: (f"{k}.jpg", jpg(), "image/jpeg") for k in ["license_plate", "driver_selfie", "start_odometer"]}
    r = requests.post(f"{BASE}/trips/start", headers=j, data={"payload": json.dumps(payload)}, files=files)
    print("start", r.status_code, r.text[:120])
    body = {"stops": [{"address": f"TEST_r17 stop {i + 1}", "latitude": LAT, "longitude": LNG} for i in range(4)], "clearDone": True}
    s = requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=a, json=body)
    print("stops", s.status_code, [x["id"] for x in s.json()["stops"]], "startOdo", odo)
elif cmd == "state":
    t = requests.get(f"{BASE}/trips/my-active", headers=j).json()
    print("trip", t and t.get("id"), t and t.get("startOdometer"), t and t.get("status"))
    for s in requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=a).json():
        print(s["id"], s["position"], s["address"], s["arrivedAt"], s["arrivedOdometer"], s["arrivedPhotoUrl"])
elif cmd == "cleanup":
    t = requests.get(f"{BASE}/trips/my-active", headers=j).json()
    if t and t.get("id"):
        print("cancel", t["id"], requests.post(f"{BASE}/trips/{t['id']}/cancel", headers=a).status_code)
    print("clear stops", requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=a, json={"stops": [], "clearDone": True}).status_code)
