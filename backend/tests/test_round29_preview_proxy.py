# Round 29: rebuilt preview smoke — proxy routing, auth, James demo data, photos, socket.io via /api/socket.io, path traversal
import os
import subprocess
import time
import pytest
import requests

BASE = os.environ.get("PREVIEW_URL", "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com").rstrip("/")
API = BASE + "/api"


def _tok(path, email, pw):
    r = requests.post(f"{API}{path}", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login {email} failed {r.status_code} {r.text[:100]}")
    d = r.json()
    return {"Authorization": "Bearer " + (d.get("accessToken") or d.get("token"))}


@pytest.fixture(scope="module")
def admin():
    return _tok("/auth/login", "admin@fleet.com", "AdminTest123!")


@pytest.fixture(scope="module")
def james():
    return _tok("/auth/driver/login", "james@fleet.com", "DriverTest123!")


# Auth through proxy
def test_admin_login_returns_token():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@fleet.com", "password": "AdminTest123!"}, timeout=30)
    assert r.status_code == 200 and r.json().get("accessToken")


def test_bad_login_rejected():
    r = requests.post(f"{API}/auth/driver/login", json={"email": "james@fleet.com", "password": "nope"}, timeout=30)
    assert r.status_code in (400, 401)


def test_unauth_401(admin):
    assert requests.get(f"{API}/vehicles", timeout=30).status_code == 401


# James demo data
def test_james_trips_5_completed_with_photos(james):
    r = requests.get(f"{API}/trips/my-trips", headers=james, timeout=30)
    assert r.status_code == 200
    d = r.json()
    trips = d if isinstance(d, list) else d.get("trips") or d.get("data") or []
    done = [t for t in trips if t.get("status") == "completed"]
    assert len(done) >= 5, trips[:1]


def test_james_active_trip(james):
    r = requests.get(f"{API}/trips/my-active", headers=james, timeout=30)
    assert r.status_code == 200
    d = r.json()
    t = d.get("trip", d) if isinstance(d, dict) else d
    assert t and t.get("status") == "in_progress"


def test_james_stops_2_of_4(james):
    r = requests.get(f"{API}/drivers/my-stops", headers=james, timeout=30)
    assert r.status_code == 200
    stops = r.json()
    assert len(stops) == 4
    done = [s for s in stops if s.get("arrivedAt") or s.get("arrived_at") or s.get("status") in ("arrived", "done", "completed")]
    assert len(done) == 2, stops[0]


def test_james_note_present(james):
    r = requests.get(f"{API}/drivers/my-notes", headers=james, timeout=30)
    assert r.status_code == 200
    d = r.json()
    notes = d if isinstance(d, list) else d.get("notes", [])
    assert any("Crew flight landed early" in n.get("message", "") for n in notes)


def test_stops_board_james(admin):
    r = requests.get(f"{API}/drivers/stops-board", headers=admin, timeout=30)
    assert r.status_code == 200
    assert "James" in r.text


def test_trip_photo_file_loads(admin):
    out = subprocess.run(["su", "postgres", "-c", "psql -d fleet_test -tAc \"select id from trip_photos where trip_id=17 limit 1\""],
                         capture_output=True, text=True).stdout.strip()
    r = requests.get(f"{API}/trips/17", headers=admin, timeout=30)
    assert r.status_code == 200
    import re
    urls = re.findall(r'"(?:url|photoUrl|fileUrl|signedUrl)"\s*:\s*"([^"]+)"', r.text)
    assert urls, f"no photo url in trip 17 (photo id {out}): {r.text[:300]}"
    u = urls[0]
    if u.startswith("/"):
        u = BASE + u
    p = requests.get(u, headers=admin, timeout=30)
    assert p.status_code == 200 and p.headers.get("content-type", "").startswith("image/"), (u, p.status_code, p.headers.get("content-type"))


# Dashboard static + SPA fallback
def test_dashboard_index():
    r = requests.get(f"{API}/dashboard/", timeout=30)
    assert r.status_code == 200 and "text/html" in r.headers["content-type"] and "<div id=\"root\"" in r.text


def test_dashboard_deeplink_stops():
    r = requests.get(f"{API}/dashboard/stops", timeout=30)
    assert r.status_code == 200 and "<div id=\"root\"" in r.text


def test_dashboard_assets_served_with_type():
    import re
    html = requests.get(f"{API}/dashboard/", timeout=30).text
    js = re.findall(r'src="([^"]+\.js)"', html)
    assert js
    r = requests.get(BASE + js[0] if js[0].startswith("/") else f"{API}/dashboard/{js[0]}", timeout=30)
    assert r.status_code == 200 and "javascript" in r.headers["content-type"]


# Path traversal must not leak files
@pytest.mark.parametrize("p", ["/api/dashboard/%2e%2e/%2e%2e/backend/.env", "/api/dashboard/..%2f..%2fbackend%2f.env",
                               "/api/dashboard/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd"])
def test_traversal_blocked(p):
    r = requests.get(BASE + p, timeout=30)
    assert "MONGO_URL" not in r.text and "DATABASE_URL" not in r.text and "root:x:" not in r.text and "JWT" not in r.text


# Malformed percent-encoding must not crash the proxy (DoS)
def _proxy_pid():
    return subprocess.run(["supervisorctl", "status", "fleet-preview-proxy"], capture_output=True, text=True).stdout.split()


def test_malformed_uri_does_not_crash_proxy():
    before = _proxy_pid()
    r1 = requests.get(BASE + "/api/dashboard/%FF", timeout=30)
    time.sleep(1.5)
    after = _proxy_pid()
    assert r1.status_code != 502 and before[:4] == after[:4], f"proxy crashed/restarted: {r1.status_code} {before} -> {after}"


# socket.io polling handshake through /api/socket.io
def test_socketio_polling_handshake():
    r = requests.get(f"{API}/socket.io/?EIO=4&transport=polling", timeout=30)
    assert r.status_code == 200 and r.text.startswith("0{") and "websocket" in r.text
