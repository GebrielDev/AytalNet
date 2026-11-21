# Round 18 UI helper: `create` posts a TEST_ note to James; `get <id>` prints it (read/reply state)
import sys, requests
BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"
a = {"Authorization": "Bearer " + requests.post(f"{BASE}/auth/login", json={"email": "admin@fleet.com", "password": "AdminTest123!"}).json()["accessToken"]}
if sys.argv[1] == "create":
    r = requests.post(f"{BASE}/drivers/3/notes", headers=a, json={"message": "TEST_r18 note please confirm"})
    print(r.status_code, r.json().get("id"))
else:
    notes = requests.get(f"{BASE}/drivers/3/notes", headers=a).json()
    notes = notes if isinstance(notes, list) else notes.get("notes", [])
    print(next((n for n in notes if n["id"] == int(sys.argv[2])), None))
