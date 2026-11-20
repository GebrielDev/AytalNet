# Round 10: put / clear TEST_ stops on James (driver 3, no stops originally) for StopsCard dark/light UI checks
import sys, requests
BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"
JAMES = 3
r = requests.post(f"{BASE}/auth/login", json={"email": "admin@fleet.com", "password": "AdminTest123!"}, timeout=20)
h = {"Authorization": f"Bearer {r.json()['accessToken']}"}
print("current:", requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=h, timeout=20).json())
if sys.argv[1:] == ["clear"]:
    body = {"stops": [], "clearDone": True}
else:
    body = {"stops": [
        {"address": "TEST_ 455 N Galvin Pkwy, Phoenix, AZ", "latitude": 33.4497, "longitude": -111.9464, "note": "TEST_ gate code 1234"},
        {"address": "TEST_ 401 E Jefferson St, Phoenix, AZ", "latitude": 33.4457, "longitude": -112.0667},
    ], "clearDone": True}
r = requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=h, json=body, timeout=60)
print(r.status_code, r.text[:400])
