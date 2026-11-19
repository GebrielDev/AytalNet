# Late trips (recordedOffline filter) + create late trip via API
import os, io, json, datetime as dt
import pytest, requests

BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"
JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffdb004300" + "08" * 64 + "ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda0008010100003f00d2cf20ffd9")
REF = os.environ.get("LATE_REF", "late-test-xyz12345")
state = {}


def iso(minutes_ago):
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z")


@pytest.fixture(scope="module")
def admin():
    r = requests.post(f"{BASE}/auth/login", json={"email": "admin@fleet.com", "password": "AdminTest123!"})
    assert r.status_code == 200, r.text
    d = r.json()
    return d.get("token") or d.get("accessToken")


@pytest.fixture(scope="module")
def driver():
    r = requests.post(f"{BASE}/auth/driver/login", json={"email": "james@fleet.com", "password": "DriverTest123!"})
    assert r.status_code == 200, r.text
    d = r.json()
    return d.get("token") or d.get("accessToken")


def H(t):
    return {"Authorization": f"Bearer {t}"}


def trips(admin, **params):
    r = requests.get(f"{BASE}/trips", headers=H(admin), params={"limit": 100, **params})
    assert r.status_code == 200, r.text
    d = r.json()
    return d.get("trips") or d.get("data") or d.get("rows") or d


def test_dispatcher_login():
    r = requests.post(f"{BASE}/auth/login", json={"email": "dispatcher@fleet.com", "password": "DispatchTest123!"})
    assert r.status_code == 200


def test_recorded_offline_filter_seed(admin):
    rows = trips(admin, recordedOffline="true")
    ids = sorted(t["id"] for t in rows)
    print("late ids", ids, [(t["id"], t.get("clientRef"), t.get("startTime"), t.get("createdAt"), t.get("endTime"), t.get("endReceivedAt")) for t in rows])
    assert 7 in ids and 8 in ids
    assert not set(ids) & {1, 2, 3, 4, 5, 6}
    assert all(t.get("clientRef") for t in rows)


def test_unfiltered_includes_all(admin):
    rows = trips(admin)
    assert len(rows) >= 8


def test_driver_cannot_list_all(driver):
    r = requests.get(f"{BASE}/trips", headers=H(driver), params={"recordedOffline": "true"})
    assert r.status_code in (401, 403)


def test_create_late_trip(admin, driver):
    v = requests.get(f"{BASE}/vehicles/3", headers=H(admin))
    odo = (v.json().get("vehicle") or v.json()).get("currentOdometer", 0) if v.status_code == 200 else 0
    odo = int(float(odo or 0))
    state["start_odo"] = odo + 10
    payload = {"vehicleId": 3, "startOdometer": odo + 10, "startLatitude": 40.71, "startLongitude": -74.0,
               "clientRef": REF, "startedAt": iso(40)}
    files = {k: (f"{k}.jpg", io.BytesIO(JPEG), "image/jpeg") for k in ("license_plate", "driver_selfie", "start_odometer")}
    r = requests.post(f"{BASE}/trips/start", headers=H(driver), data={"payload": json.dumps(payload)}, files=files)
    print("start", r.status_code, r.text[:400])
    assert r.status_code in (200, 201)
    t = r.json().get("trip") or r.json()
    state["id"] = t["id"]
    r = requests.post(f"{BASE}/trips/{t['id']}/photos", headers=H(driver), data={"photoType": "end_odometer"},
                      files={"photo": ("e.jpg", io.BytesIO(JPEG), "image/jpeg")})
    print("photo", r.status_code, r.text[:200])
    assert r.status_code in (200, 201)
    r = requests.put(f"{BASE}/trips/{t['id']}/end", headers=H(driver),
                     json={"endOdometer": odo + 35, "endLatitude": 40.72, "endLongitude": -74.01, "endedAt": iso(20)})
    print("end", r.status_code, r.text[:400])
    assert r.status_code == 200


def test_late_trip_in_filter(admin):
    assert "id" in state
    rows = trips(admin, recordedOffline="true")
    mine = [t for t in rows if t["id"] == state["id"]]
    assert mine, "new late trip missing from filter"
    t = mine[0]
    print("new trip", {k: t.get(k) for k in ("id", "status", "startTime", "createdAt", "endTime", "endReceivedAt", "totalMileage")})
    assert t["status"] == "completed"


def test_late_trip_detail(admin):
    r = requests.get(f"{BASE}/trips/{state['id']}", headers=H(admin))
    assert r.status_code == 200
    t = r.json().get("trip") or r.json()
    assert t.get("endReceivedAt")
    assert len(t.get("photos", [])) >= 4
