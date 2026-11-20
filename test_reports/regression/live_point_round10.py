# Round 10: post a live point as Michael (driver 5) then backdate it so the Stops board "Live" label should expire within ~30s
import subprocess, sys, requests
BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"
age = sys.argv[1] if len(sys.argv) > 1 else "155 seconds"
r = requests.post(f"{BASE}/auth/driver/login", json={"email": "michael@fleet.com", "password": "DriverTest123!"}, timeout=20)
h = {"Authorization": f"Bearer {r.json()['accessToken']}"}
p = requests.post(f"{BASE}/drivers/my-location", headers=h, json={"latitude": 33.45, "longitude": -112.07}, timeout=20)
print("my-location:", p.status_code, p.text[:200])
sql = f"update drivers set last_located_at = now() - interval '{age}' where id=5 returning last_located_at, now()"
print(subprocess.run(["su", "postgres", "-c", f'psql -d fleet_test -At -c "{sql}"'], capture_output=True, text=True).stdout.strip())
