# Round 21 cleanup after KEEP=1 run: cancel James's TEST trip, clear his stops, restore vehicle 3 odometer
import subprocess, sys, requests
BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"
ORIG = sys.argv[1]
login = lambda p, e, pw: {"Authorization": "Bearer " + requests.post(f"{BASE}{p}", json={"email": e, "password": pw}).json()["accessToken"]}
a = login("/auth/login", "admin@fleet.com", "AdminTest123!")
j = login("/auth/driver/login", "james@fleet.com", "DriverTest123!")
t = requests.get(f"{BASE}/trips/my-active", headers=j).json()
if t and t.get("id"):
    print("cancel", t["id"], requests.post(f"{BASE}/trips/{t['id']}/cancel", headers=a).status_code)
print("clear stops", requests.put(f"{BASE}/drivers/3/stops", headers=a, json={"stops": [], "clearDone": True}).status_code)
subprocess.run(["su", "postgres", "-c", f'psql -d fleet_test -c "update vehicles set current_odometer={ORIG} where id=3"'])
print("active after:", requests.get(f"{BASE}/trips/my-active", headers=j).json())
