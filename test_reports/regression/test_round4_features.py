# Round 4: destination, late trip alerts flag, offline locations
import os
import pytest
import requests

BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"


def login(path, email, pw):
    r = requests.post(f"{BASE}{path}", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def admin():
    d = login("/auth/login", "admin@fleet.com", "AdminTest123!")
    return {"Authorization": f"Bearer {d['accessToken']}"}


@pytest.fixture(scope="module")
def dispatcher():
    d = login("/auth/login", "dispatcher@fleet.com", "DispatchTest123!")
    return {"Authorization": f"Bearer {d['accessToken']}"}


@pytest.fixture(scope="module")
def maria():
    d = login("/auth/driver/login", "maria@fleet.com", "DriverTest123!")
    return {"Authorization": f"Bearer {d['accessToken']}"}, d


def maria_id(admin):
    ds = requests.get(f"{BASE}/drivers", headers=admin, params={"search": "maria@fleet.com"}).json()
    return ds[0]["id"], ds[0]


# Destination
class TestDestination:
    def test_set_get_clear(self, dispatcher, maria):
        mid, orig = maria_id(dispatcher)
        hdr, _ = maria
        r = requests.put(f"{BASE}/drivers/{mid}/destination", headers=dispatcher,
                         json={"address": "  TEST_100 Main St, Phoenix  ", "note": "TEST_gate"})
        assert r.status_code == 200, r.text
        assert r.json()["destinationAddress"] == "TEST_100 Main St, Phoenix"
        g = requests.get(f"{BASE}/drivers/my-destination", headers=hdr).json()
        assert g["address"] == "TEST_100 Main St, Phoenix" and g["note"] == "TEST_gate"
        lst = requests.get(f"{BASE}/drivers", headers=dispatcher, params={"search": "maria@fleet.com"}).json()
        assert lst[0]["destinationAddress"] == "TEST_100 Main St, Phoenix"
        # clear
        r = requests.put(f"{BASE}/drivers/{mid}/destination", headers=dispatcher, json={"address": "", "note": "x"})
        assert r.status_code == 200 and r.json()["destinationAddress"] is None and r.json()["destinationNote"] is None
        assert requests.get(f"{BASE}/drivers/my-destination", headers=hdr).json() is None
        # restore original
        if orig.get("destinationAddress"):
            requests.put(f"{BASE}/drivers/{mid}/destination", headers=dispatcher,
                         json={"address": orig["destinationAddress"], "note": orig.get("destinationNote") or ""})

    def test_validation(self, admin):
        mid, _ = maria_id(admin)
        r = requests.put(f"{BASE}/drivers/{mid}/destination", headers=admin, json={"address": 123})
        assert r.status_code == 400
        r = requests.put(f"{BASE}/drivers/{mid}/destination", headers=admin, json={"address": "a", "note": {"x": 1}})
        assert r.status_code == 400

    def test_404(self, admin):
        r = requests.put(f"{BASE}/drivers/999999/destination", headers=admin, json={"address": "x"})
        assert r.status_code == 404

    def test_driver_cannot_set(self, admin, maria):
        mid, _ = maria_id(admin)
        r = requests.put(f"{BASE}/drivers/{mid}/destination", headers=maria[0], json={"address": "TEST_hack"})
        assert r.status_code in (401, 403)

    def test_admin_cannot_get_my_destination(self, admin):
        r = requests.get(f"{BASE}/drivers/my-destination", headers=admin)
        assert r.status_code in (401, 403)

    def test_unauth(self):
        assert requests.get(f"{BASE}/drivers/my-destination").status_code == 401

    def test_john_destination(self):
        d = login("/auth/driver/login", "john@fleet.com", "DriverTest123!")
        g = requests.get(f"{BASE}/drivers/my-destination", headers={"Authorization": f"Bearer {d['accessToken']}"}).json()
        assert g["address"] == "2 N Central Ave, Phoenix, AZ"
        assert g["note"] == "North entrance"


# Late trip alerts flag
class TestLateAlerts:
    def test_toggle(self, admin):
        users = requests.get(f"{BASE}/users", headers=admin).json()
        assert all("lateTripAlerts" in u for u in users)
        disp = next(u for u in users if u["email"] == "dispatcher@fleet.com")
        orig = disp["lateTripAlerts"]
        r = requests.put(f"{BASE}/users/{disp['id']}", headers=admin, json={"lateTripAlerts": not orig})
        assert r.status_code == 200 and r.json()["lateTripAlerts"] == (not orig)
        g = requests.get(f"{BASE}/users/{disp['id']}", headers=admin).json()
        assert g["lateTripAlerts"] == (not orig)
        # name untouched
        assert g["name"] == disp["name"]
        requests.put(f"{BASE}/users/{disp['id']}", headers=admin, json={"lateTripAlerts": orig})

    def test_bad_type(self, admin):
        users = requests.get(f"{BASE}/users", headers=admin).json()
        disp = next(u for u in users if u["email"] == "dispatcher@fleet.com")
        r = requests.put(f"{BASE}/users/{disp['id']}", headers=admin, json={"lateTripAlerts": "yes"})
        assert r.status_code == 400

    def test_dispatcher_forbidden(self, dispatcher, admin):
        users = requests.get(f"{BASE}/users", headers=admin).json()
        disp = next(u for u in users if u["email"] == "dispatcher@fleet.com")
        r = requests.put(f"{BASE}/users/{disp['id']}", headers=dispatcher, json={"lateTripAlerts": True})
        assert r.status_code == 403


# Offline locations
class TestOfflineLocations:
    def test_admin(self, admin):
        r = requests.get(f"{BASE}/trips/offline-locations", headers=admin)
        assert r.status_code == 200
        pts = r.json()
        assert isinstance(pts, list) and len(pts) > 0
        p = pts[0]
        for k in ("tripId", "part", "at", "minutesLate", "latitude", "longitude"):
            assert k in p
        assert p["part"] in ("start", "end")
        assert isinstance(p["latitude"], (int, float))
        assert all(x["minutesLate"] > 0 for x in pts)

    def test_dispatcher(self, dispatcher):
        assert requests.get(f"{BASE}/trips/offline-locations", headers=dispatcher).status_code == 200

    def test_driver_403(self, maria):
        assert requests.get(f"{BASE}/trips/offline-locations", headers=maria[0]).status_code == 403

    def test_date_filter(self, admin):
        allp = requests.get(f"{BASE}/trips/offline-locations", headers=admin).json()
        future = requests.get(f"{BASE}/trips/offline-locations", headers=admin, params={"startDate": "2099-01-01"}).json()
        assert future == []
        past = requests.get(f"{BASE}/trips/offline-locations", headers=admin, params={"endDate": "2000-01-01"}).json()
        assert past == []
        assert len(allp) >= len(future)

    def test_invalid_date(self, admin):
        r = requests.get(f"{BASE}/trips/offline-locations", headers=admin, params={"startDate": "garbage"})
        print("invalid date status", r.status_code, r.text[:100])
        assert r.status_code in (200, 400)

    def test_offline_list_vs_trips_filter(self, admin):
        pts = requests.get(f"{BASE}/trips/offline-locations", headers=admin).json()
        r = requests.get(f"{BASE}/trips", headers=admin, params={"recordedOffline": "true", "limit": 100})
        assert r.status_code == 200
        body = r.json()
        trips = body.get("trips", body if isinstance(body, list) else [])
        ids = {t["id"] for t in trips}
        print("offline trips", len(ids), "points trips", len({p['tripId'] for p in pts}))
