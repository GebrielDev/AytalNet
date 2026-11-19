# Round 6: multi-stop jobs, address search proxy, driver arrive endpoint, legacy destination, trip-end arrival
import os, subprocess, time
import pytest, requests

BASE = os.environ["API_BASE"].rstrip("/")  # .../api
JAMES = 3  # test target driver (no stops originally); restored to empty at the end


def login(path, email, pw):
    r = requests.post(f"{BASE}{path}", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


def psql(sql):
    return subprocess.run(["su", "postgres", "-c", f'psql -d fleet_test -At -c "{sql}"'], capture_output=True, text=True).stdout.strip()


@pytest.fixture(scope="module")
def admin():
    return login("/auth/login", "admin@fleet.com", "AdminTest123!")


@pytest.fixture(scope="module")
def james():
    return login("/auth/driver/login", "james@fleet.com", "DriverTest123!")


@pytest.fixture(scope="module", autouse=True)
def restore(admin):
    yield
    requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=admin, json={"stops": [], "clearDone": True}, timeout=30)


def put_stops(h, body):
    return requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=h, json=body, timeout=60)


ZOO = {"address": "TEST_ Phoenix Zoo", "note": "Gate A", "latitude": 33.4496185, "longitude": -111.9463685}
CHASE = {"address": "TEST_ Chase Field", "note": None, "latitude": 33.4455, "longitude": -112.0667}


# Geo search proxy
class TestGeo:
    def test_short_query_empty(self, admin):
        r = requests.get(f"{BASE}/geo/search", params={"q": "ph"}, headers=admin, timeout=20)
        assert r.status_code == 200 and r.json() == []

    def test_search_returns_labels_with_coords(self, admin):
        r = requests.get(f"{BASE}/geo/search", params={"q": "Chase Field"}, headers=admin, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert 0 < len(data) <= 5
        assert all({"label", "latitude", "longitude"} <= set(x) for x in data)
        assert any("Phoenix" in x["label"] for x in data), data

    def test_search_requires_user(self, james):
        assert requests.get(f"{BASE}/geo/search", params={"q": "Chase"}, timeout=20).status_code == 401
        assert requests.get(f"{BASE}/geo/search", params={"q": "Chase"}, headers=james, timeout=20).status_code in (401, 403)


# Stops CRUD + validation
class TestStops:
    def test_validation(self, admin):
        assert put_stops(admin, {"stops": "x"}).status_code == 400
        assert put_stops(admin, {"stops": [{"address": f"a{i}", "latitude": 1, "longitude": 1} for i in range(26)]}).status_code == 400
        assert put_stops(admin, {"stops": [{"address": "  "}]}).status_code == 400
        assert put_stops(admin, {"stops": [{"address": "x", "note": 5}]}).status_code == 400
        assert requests.put(f"{BASE}/drivers/99999/stops", headers=admin, json={"stops": []}, timeout=20).status_code == 404

    def test_put_and_get_stops_mirror(self, admin, james):
        r = put_stops(admin, {"stops": [ZOO, CHASE], "clearDone": True})
        assert r.status_code == 200, r.text
        s = r.json()["stops"]
        assert [x["address"] for x in s] == [ZOO["address"], CHASE["address"]]
        assert [x["position"] for x in s] == [1, 2] and r.json()["notFound"] == []
        g = requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=admin, timeout=20).json()
        assert [x["id"] for x in g] == [x["id"] for x in s]
        mine = requests.get(f"{BASE}/drivers/my-stops", headers=james, timeout=20)
        assert mine.status_code == 200 and [x["id"] for x in mine.json()] == [x["id"] for x in s]
        d = requests.get(f"{BASE}/drivers/my-destination", headers=james, timeout=20).json()
        assert ZOO["address"] in str(d), d
        # driver can't read users-only route
        assert requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=james, timeout=20).status_code in (401, 403)

    def test_arrive_far_then_near(self, admin, james):
        s = requests.get(f"{BASE}/drivers/my-stops", headers=james, timeout=20).json()
        zoo = s[0]
        far = requests.post(f"{BASE}/drivers/my-stops/{zoo['id']}/arrive", headers=james, json={"latitude": 33.4455, "longitude": -112.0667}, timeout=20)
        assert far.status_code == 400 and far.json()["distanceMeters"] > 300 and "km" in far.json()["error"], far.text
        nol = requests.post(f"{BASE}/drivers/my-stops/{zoo['id']}/arrive", headers=james, json={}, timeout=20)
        assert nol.status_code == 400
        near = requests.post(f"{BASE}/drivers/my-stops/{zoo['id']}/arrive", headers=james, json={"latitude": 33.4497, "longitude": -111.9464}, timeout=20)
        assert near.status_code == 200, near.text
        st = near.json()["stops"]
        assert st[0]["arrivedAt"] and st[0]["arrivedDistanceMeters"] <= 300 and st[1]["arrivedAt"] is None
        assert psql(f"select destination_address from drivers where id={JAMES}") == CHASE["address"]
        # other driver's stop -> 404
        other = psql("select id from driver_stops where driver_id<>3 limit 1")
        assert requests.post(f"{BASE}/drivers/my-stops/{other}/arrive", headers=james, json={"latitude": 1, "longitude": 1}, timeout=20).status_code == 404

    def test_replace_keeps_done_then_clear(self, admin):
        r = put_stops(admin, {"stops": [CHASE, {**ZOO, "address": "TEST_ Second"}]})
        s = r.json()["stops"]
        assert len(s) == 3 and s[0]["arrivedAt"] and [x["position"] for x in s] == [1, 2, 3]
        r = put_stops(admin, {"stops": [CHASE], "clearDone": True})
        s = r.json()["stops"]
        assert len(s) == 1 and s[0]["position"] == 1 and s[0]["arrivedAt"] is None

    def test_not_found_still_saved(self, admin):
        r = put_stops(admin, {"stops": [{"address": "qqzz nowhere 0000 TEST_"}]})
        assert r.status_code == 200, r.text
        assert r.json()["notFound"] == ["qqzz nowhere 0000 TEST_"]
        assert r.json()["stops"][-1]["latitude"] is None

    def test_legacy_destination(self, admin):
        r = requests.put(f"{BASE}/drivers/{JAMES}/destination", headers=admin, json={"address": "qqzz nowhere 0000 TEST_", "note": "legacy"}, timeout=60)
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=admin, timeout=20).json()
        pend = [x for x in g if not x["arrivedAt"]]
        assert len(pend) == 1 and pend[0]["note"] == "legacy"
        r = requests.put(f"{BASE}/drivers/{JAMES}/destination", headers=admin, json={"address": ""}, timeout=20)
        assert r.status_code == 200
        assert [x for x in requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=admin, timeout=20).json() if not x["arrivedAt"]] == []
        assert psql(f"select coalesce(destination_address,'NULL') from drivers where id={JAMES}") == "NULL"


# Trip end within 300 m of a pending stop marks it arrived (how=trip_end)
class TestTripEndArrival:
    def test_trip_end_marks_stop(self, admin, james):
        import sys; sys.path.insert(0, os.path.dirname(__file__))
        from test_round5_arrival import start, end
        assert psql("select count(*) from trips where driver_id=3 and status='in_progress'") == "0"
        r = put_stops(admin, {"stops": [ZOO, CHASE], "clearDone": True})
        assert r.status_code == 200
        t, odo = start(james, 3, {"destinationAddress": ZOO["address"]})
        e = end(james, t["id"], odo, 33.4460, -112.0667)  # ~55 m from Chase (2nd stop)
        time.sleep(2)
        s = requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=admin, timeout=20).json()
        print("trip", t["id"], s)
        chase = [x for x in s if x["address"] == CHASE["address"]][0]
        assert chase["arrivedAt"] and chase["tripId"] == t["id"] and chase["arrivedDistanceMeters"] < 300
        zoo = [x for x in s if x["address"] == ZOO["address"]][0]
        assert zoo["arrivedAt"] is None
        assert psql(f"select destination_address from drivers where id={JAMES}") == ZOO["address"]
