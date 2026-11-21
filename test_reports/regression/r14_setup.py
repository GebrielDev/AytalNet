# Round 14 UI helper: `setup` starts TEST_ trip for James + adds 2 TEST_ stops; `note <msg>` sends note; `cleanup` cancels trip + clears stops
import io, json, subprocess, sys, uuid, requests
from PIL import Image
BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"
JAMES = 3

def psql(sql):
    return subprocess.run(["su", "postgres", "-c", f'psql -d fleet_test -At -c "{sql}"'], capture_output=True, text=True).stdout.strip()

def jpg():
    b = io.BytesIO(); Image.new("RGB", (8, 8), (200, 10, 10)).save(b, "JPEG"); return b.getvalue()

a = {"Authorization": "Bearer " + requests.post(f"{BASE}/auth/login", json={"email": "admin@fleet.com", "password": "AdminTest123!"}).json()["accessToken"]}
j = {"Authorization": "Bearer " + requests.post(f"{BASE}/auth/driver/login", json={"email": "james@fleet.com", "password": "DriverTest123!"}).json()["accessToken"]}
cmd = sys.argv[1]
if cmd == "setup":
    odo = float(psql("select current_odometer from vehicles where id=3")) + 5
    payload = {"vehicleId": 3, "startOdometer": odo, "startLatitude": 33.4497, "startLongitude": -111.9464, "clientRef": f"TEST_{uuid.uuid4()}"}
    files = {k: (f"{k}.jpg", jpg(), "image/jpeg") for k in ["license_plate", "driver_selfie", "start_odometer"]}
    r = requests.post(f"{BASE}/trips/start", headers=j, data={"payload": json.dumps(payload)}, files=files)
    print("start", r.status_code, r.text[:150])
    body = {"stops": [
        {"address": "TEST_ 455 N Galvin Pkwy, Phoenix, AZ", "latitude": 33.4497, "longitude": -111.9464, "note": "TEST_ gate code"},
        {"address": "TEST_ 401 E Jefferson St, Phoenix, AZ", "latitude": 33.4498, "longitude": -111.9465},
    ], "clearDone": True}
    print("stops", requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=a, json=body).status_code)
elif cmd == "note":
    r = requests.post(f"{BASE}/drivers/{JAMES}/notes", headers=a, json={"message": sys.argv[2]})
    print("note", r.status_code, r.text)
elif cmd == "stops":
    print(json.dumps(requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=a).json())[:800])
elif cmd == "cleanup":
    t = requests.get(f"{BASE}/trips/my-active", headers=j).json()
    if t and t.get("id"):
        print("cancel", t["id"], requests.post(f"{BASE}/trips/{t['id']}/cancel", headers=a).status_code)
    print("clear stops", requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=a, json={"stops": [], "clearDone": True}).status_code)
elif cmd == "ack":
    mine = requests.get(f"{BASE}/drivers/my-notes", headers=j).json()
    for n in mine:
        if n["message"].startswith(sys.argv[2]):
            print("ack", n["id"], requests.post(f"{BASE}/drivers/my-notes/{n['id']}/read", headers=j).status_code)
