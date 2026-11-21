# Round 25: FastAPI deploy bridge (/app/backend/server.py) -> Node fleet API. Run with
#   BRIDGE_URL=http://127.0.0.1:8019 ECHO_BRIDGE_URL=http://127.0.0.1:8021 DOWN_BRIDGE_URL=http://127.0.0.1:8031 UPSTREAM_URL=http://127.0.0.1:8002
# (8019 -> real API on 8002, 8021 -> bridge_echo_upstream.py on 8022, 8031 -> dead upstream :9)
import hashlib
import io
import json
import os
import subprocess
import uuid

import pytest
import requests
from PIL import Image

BRIDGE = os.environ["BRIDGE_URL"].rstrip("/")
ECHO = os.environ["ECHO_BRIDGE_URL"].rstrip("/")
DOWN = os.environ["DOWN_BRIDGE_URL"].rstrip("/")
UP = os.environ["UPSTREAM_URL"].rstrip("/")
API = f"{BRIDGE}/api"
JAMES = 3
LAT, LNG = 33.4497, -111.9464


def psql(sql):
    return subprocess.run(["su", "postgres", "-c", f'psql -d fleet_test -At -c "{sql}"'], capture_output=True, text=True).stdout.strip()


def jpg(color=(10, 200, 10)):
    b = io.BytesIO(); Image.new("RGB", (16, 16), color).save(b, "JPEG"); return b.getvalue()


def _login(path, email, pw):
    r = requests.post(f"{API}{path}", json={"email": email, "password": pw}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login via bridge failed {email}: {r.status_code} {r.text[:200]}")
    return r.json()


@pytest.fixture(scope="module", autouse=True)
def _clear_limits():
    psql("delete from auth_rate_limits")
    yield
    psql("delete from auth_rate_limits")


@pytest.fixture(scope="module")
def admin():
    return {"Authorization": f"Bearer {_login('/auth/login', 'admin@fleet.com', 'AdminTest123!')['accessToken']}"}


@pytest.fixture(scope="module")
def james():
    return {"Authorization": f"Bearer {_login('/auth/driver/login', 'james@fleet.com', 'DriverTest123!')['accessToken']}"}


# Health answered by the bridge itself
class TestHealth:
    def test_health(self):
        for p in ("/health", "/api/health"):
            r = requests.get(BRIDGE + p, timeout=10)
            assert r.status_code == 200 and r.json()["status"] == "ok"

    def test_upstream_down_502_json_health_ok(self):
        r = requests.get(f"{DOWN}/api/auth/me", timeout=20)
        assert r.status_code == 502 and "error" in r.json()
        r = requests.post(f"{DOWN}/api/auth/driver/login", json={"email": "x", "password": "y"}, timeout=20)
        assert r.status_code == 502 and r.headers["content-type"].startswith("application/json")
        assert requests.get(f"{DOWN}/health", timeout=10).status_code == 200


# Raw forwarding checked against an echo upstream
class TestForwardingEcho:
    def test_repeated_query_and_path(self):
        r = requests.get(f"{ECHO}/api/trips/report", params=[("status", "a"), ("status", "b"), ("q", "x y&z")], timeout=10)
        e = r.json()
        assert e["path"].startswith("/api/trips/report?")
        assert e["path"].count("status=") == 2 and "status=a" in e["path"] and "status=b" in e["path"]

    def test_multipart_body_intact(self):
        files = {"photo": ("p.jpg", jpg(), "image/jpeg")}
        req = requests.Request("POST", f"{ECHO}/api/drivers/my-stops/1/arrive", data={"latitude": "1"}, files=files).prepare()
        r = requests.Session().send(req, timeout=10)
        e = r.json()
        assert e["body_len"] == len(req.body) and e["body_sha256"] == hashlib.sha256(req.body).hexdigest()
        assert e["headers"]["content-type"] == req.headers["Content-Type"]

    def test_auth_header_forwarded_origin_stripped(self):
        r = requests.put(f"{ECHO}/api/x", headers={"Authorization": "Bearer abc", "Origin": "https://evil.example"}, json={"a": 1}, timeout=10)
        h = r.json()["headers"]
        assert h["authorization"] == "Bearer abc" and "origin" not in h
        assert r.json()["method"] == "PUT"

    def test_status_passthrough(self):
        for s in (400, 401, 404, 429, 500):
            assert requests.get(f"{ECHO}/api/x", headers={"x-echo-status": str(s)}, timeout=10).status_code == s


# Real API through the bridge
class TestRealApi:
    def test_logins_match_direct(self):
        b = requests.post(f"{API}/auth/driver/login", json={"email": "john@fleet.com", "password": "DriverTest123!"}, timeout=20)
        assert b.status_code == 200 and b.json()["accessToken"] and b.json()["driver"]["email"] == "john@fleet.com"
        a = requests.post(f"{API}/auth/login", json={"email": "admin@fleet.com", "password": "AdminTest123!"}, timeout=20)
        assert a.status_code == 200 and a.json()["user"]["role"] == "admin"

    def test_authenticated_get(self, admin, james):
        me = requests.get(f"{API}/auth/me", headers=admin, timeout=20)
        assert me.status_code == 200 and me.json()["email"] == "admin@fleet.com" if "email" in me.json() else me.json()["user"]["email"] == "admin@fleet.com"
        v = requests.get(f"{API}/drivers/my-vehicle", headers=james, timeout=20)
        assert v.status_code == 200
        direct = requests.get(f"{UP}/api/drivers/my-vehicle", headers=james, timeout=20)
        assert v.json() == direct.json()

    def test_repeated_params_same_as_direct(self, admin):
        q = "status=completed&status=cancelled&limit=5"
        b = requests.get(f"{API}/trips?{q}", headers=admin, timeout=20)
        d = requests.get(f"{UP}/api/trips?{q}", headers=admin, timeout=20)
        assert b.status_code == d.status_code and b.json() == d.json()

    def test_errors_passthrough(self, admin):
        assert requests.get(f"{API}/auth/me", timeout=20).status_code == 401
        r = requests.put(f"{API}/drivers/{JAMES}/stops", headers=admin, json={"stops": "x"}, timeout=20)
        assert r.status_code == 400 and "error" in r.json()
        assert requests.put(f"{API}/drivers/99999/stops", headers=admin, json={"stops": []}, timeout=20).status_code == 404

    def test_429_passthrough(self):
        email = f"TEST_bridge_{uuid.uuid4().hex[:6]}@fleet.com"
        codes = [requests.post(f"{API}/auth/driver/login", json={"email": email, "password": "bad"}, timeout=20).status_code for _ in range(11)]
        assert codes[:10] == [401] * 10 and codes[10] == 429, codes
        psql("delete from auth_rate_limits")

    def test_cors_preflight(self):
        r = requests.options(f"{API}/auth/driver/login", headers={
            "Origin": "https://some-app.example", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization"}, timeout=10)
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") in ("*", "https://some-app.example")
        assert "POST" in r.headers.get("access-control-allow-methods", "")
        g = requests.get(f"{API}/auth/me", headers={"Origin": "https://some-app.example"}, timeout=10)
        assert g.status_code == 401 and g.headers.get("access-control-allow-origin")

    def test_put_post_json(self, admin, james):
        body = {"stops": [{"address": "TEST_ bridge stop", "latitude": LAT, "longitude": LNG}], "clearDone": True}
        r = requests.put(f"{API}/drivers/{JAMES}/stops", headers=admin, json=body, timeout=20)
        assert r.status_code == 200 and r.json()["stops"][0]["address"] == "TEST_ bridge stop"
        mine = requests.get(f"{API}/drivers/my-stops", headers=james, timeout=20).json()
        mine = mine if isinstance(mine, list) else mine.get("stops", [])
        assert any(s["address"] == "TEST_ bridge stop" for s in mine)
        n = requests.post(f"{API}/drivers/{JAMES}/notes", headers=admin, json={"message": "TEST_ bridge note"}, timeout=20)
        assert n.status_code in (200, 201)
        notes = requests.get(f"{API}/drivers/my-notes", headers=james, timeout=20).json()
        notes = notes if isinstance(notes, list) else notes.get("notes", [])
        assert any(x["message"] == "TEST_ bridge note" for x in notes)
        requests.put(f"{API}/drivers/{JAMES}/stops", headers=admin, json={"stops": [], "clearDone": True}, timeout=20)


# Multipart uploads + binary photo download through the bridge
class TestMultipartAndFiles:
    def test_trip_start_arrive_and_photo(self, admin, james):
        active = requests.get(f"{API}/trips/my-active", headers=james, timeout=20).json()
        if active and active.get("id"):
            pytest.skip("James already has an active trip")
        odo = float(psql("select current_odometer from vehicles where id=3")) + 5
        payload = {"vehicleId": 3, "startOdometer": odo, "startLatitude": LAT, "startLongitude": LNG, "clientRef": f"TEST_{uuid.uuid4()}"}
        photos = {k: jpg((i * 60, 100, 200)) for i, k in enumerate(["license_plate", "driver_selfie", "start_odometer"])}
        files = {k: (f"{k}.jpg", v, "image/jpeg") for k, v in photos.items()}
        r = requests.post(f"{API}/trips/start", headers=james, data={"payload": json.dumps(payload)}, files=files, timeout=60)
        assert r.status_code in (200, 201), r.text
        trip = r.json()
        trip = trip.get("trip", trip)
        try:
            assert float(trip["startOdometer"]) == odo
            url = psql(f"select photo_url from trip_photos where trip_id={int(trip['id'])} and photo_type='license_plate'")
            assert "/files/" in url, url
            photos = {"license_plate": photos["license_plate"]}
            path = url[url.index("/files/"):]
            g = requests.get(f"{API}{path}", headers=james, timeout=30)
            assert g.status_code == 200 and g.headers["content-type"].startswith("image/"), (g.status_code, g.headers)
            assert g.content in photos.values() or g.content[:2] == b"\xff\xd8"
            d = requests.get(f"{UP}/api{path}", headers=james, timeout=30)
            assert d.content == g.content and len(g.content) == int(g.headers.get("content-length", len(g.content)))
            # arrive with photo (multipart)
            s = requests.put(f"{API}/drivers/{JAMES}/stops", headers=admin,
                             json={"stops": [{"address": "TEST_ bridge arrive", "latitude": LAT, "longitude": LNG}], "clearDone": True}, timeout=20)
            sid = s.json()["stops"][0]["id"]
            a = requests.post(f"{API}/drivers/my-stops/{sid}/arrive", headers=james,
                              data={"latitude": LAT, "longitude": LNG, "odometer": odo + 2}, files={"photo": ("p.jpg", jpg(), "image/jpeg")}, timeout=60)
            assert a.status_code == 200, a.text
            st = requests.get(f"{API}/drivers/{JAMES}/stops", headers=admin, timeout=20).json()
            st = st if isinstance(st, list) else st.get("stops", [])
            stop = next(x for x in st if x["id"] == sid)
            assert stop["arrivedAt"] and float(stop["arrivedOdometer"]) == odo + 2 and stop["arrivedPhotoUrl"]
            p2 = stop["arrivedPhotoUrl"]; p2 = p2[p2.index("/files/"):]
            g2 = requests.get(f"{API}{p2}", headers=admin, timeout=30)
            assert g2.status_code == 200 and g2.headers["content-type"].startswith("image/") and g2.content[:2] == b"\xff\xd8"
        finally:
            requests.post(f"{API}/trips/{trip['id']}/cancel", headers=admin, timeout=20)
            requests.put(f"{API}/drivers/{JAMES}/stops", headers=admin, json={"stops": [], "clearDone": True}, timeout=20)
