# Round 8: POST /api/drivers/my-location (live tracking) + stops-board lastLocation 'live'
import os, time
import pytest, requests

BASE = os.environ["API_BASE"].rstrip("/")  # .../api


def login(path, email, pw):
    r = requests.post(f"{BASE}{path}", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


@pytest.fixture(scope="module")
def michael():
    return login("/auth/driver/login", "michael@fleet.com", "DriverTest123!")


@pytest.fixture(scope="module")
def james():
    return login("/auth/driver/login", "james@fleet.com", "DriverTest123!")


@pytest.fixture(scope="module")
def admin():
    return login("/auth/login", "admin@fleet.com", "AdminTest123!")


def post(h, body):
    return requests.post(f"{BASE}/drivers/my-location", json=body, headers=h, timeout=20)


def test_no_token_401():
    assert post({}, {"latitude": 1, "longitude": 1}).status_code == 401


def test_dashboard_token_403(admin):
    assert post(admin, {"latitude": 33.4, "longitude": -112.0}).status_code == 403


@pytest.mark.parametrize("body", [{}, {"latitude": "abc", "longitude": 1}, {"latitude": 91, "longitude": 0},
                                  {"latitude": 0, "longitude": 181}, {"latitude": None, "longitude": None},
                                  {"latitude": 10}])
def test_bad_coords_400(michael, body):
    r = post(michael, body)
    assert r.status_code == 400, (body, r.status_code, r.text)


def test_not_on_trip_409(james):
    r = post(james, {"latitude": 33.4, "longitude": -112.0})
    assert r.status_code == 409, r.text


def test_accept_then_throttle_then_board_live(michael, admin):
    time.sleep(11)
    r = post(michael, {"latitude": 33.4712, "longitude": -112.0533})
    assert r.status_code == 202 and r.json() == {"accepted": True}, r.text
    r2 = post(michael, {"latitude": 33.5, "longitude": -112.1})
    assert r2.status_code == 202 and r2.json() == {"accepted": False}, r2.text
    b = requests.get(f"{BASE}/drivers/stops-board", headers=admin, timeout=20).json()
    drivers = b if isinstance(b, list) else b.get("drivers", b)
    m = [d for d in drivers if (d.get("driver") or d).get("email") == "michael@fleet.com" or d.get("name", "").startswith("Michael")
         or (d.get("driver") or {}).get("firstName") == "Michael" or d.get("firstName") == "Michael"]
    assert m, str(b)[:500]
    ll = m[0]["lastLocation"]
    assert ll["source"] == "live", ll
    assert abs(ll["latitude"] - 33.4712) < 1e-4 and abs(ll["longitude"] + 112.0533) < 1e-4, ll
