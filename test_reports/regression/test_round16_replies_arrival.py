# Round 16: note quick replies (POST /drivers/my-notes/:id/reply + socket note:replied) and offline stop arrival (arrivedAt + late proof)
import io, json, os, subprocess, time, uuid
from datetime import datetime, timedelta, timezone
import pytest
import requests
from PIL import Image

BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"
ORIGIN = BASE[:-4]
JAMES = 3
LAT, LNG = 33.4497, -111.9464


def _login(path, email, pw):
    r = requests.post(f"{BASE}{path}", json={"email": email, "password": pw}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {email}")
    return r.json()["accessToken"]


def jpg():
    b = io.BytesIO(); Image.new("RGB", (8, 8), (10, 200, 10)).save(b, "JPEG"); return b.getvalue()


def psql(sql):
    return subprocess.run(["su", "postgres", "-c", f'psql -d fleet_test -At -c "{sql}"'], capture_output=True, text=True).stdout.strip()


@pytest.fixture(scope="module")
def admin_token():
    return _login("/auth/login", "admin@fleet.com", "AdminTest123!")


@pytest.fixture(scope="module")
def admin(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def james():
    return {"Authorization": f"Bearer {_login('/auth/driver/login', 'james@fleet.com', 'DriverTest123!')}"}


@pytest.fixture(scope="module")
def maria():
    return {"Authorization": f"Bearer {_login('/auth/driver/login', 'maria@fleet.com', 'DriverTest123!')}"}


def _note(admin, msg):
    r = requests.post(f"{BASE}/drivers/{JAMES}/notes", headers=admin, json={"message": msg}, timeout=20)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    return body["id"] if "id" in body else body["note"]["id"]


def _admin_note(admin, nid):
    notes = requests.get(f"{BASE}/drivers/{JAMES}/notes", headers=admin, timeout=20).json()
    notes = notes if isinstance(notes, list) else notes.get("notes", [])
    return next((n for n in notes if n["id"] == nid), None)


# Quick replies
class TestReplies:
    def test_invalid_reply_400(self, admin, james):
        nid = _note(admin, f"TEST_r16 invalid {uuid.uuid4().hex[:4]}")
        for bad in ["", "Hello", "on my way", None]:
            r = requests.post(f"{BASE}/drivers/my-notes/{nid}/reply", headers=james, json={"reply": bad}, timeout=20)
            assert r.status_code == 400, (bad, r.text)
            assert "Reply must be one of" in r.json()["error"]
        requests.post(f"{BASE}/drivers/my-notes/{nid}/reply", headers=james, json={"reply": "Got it"}, timeout=20)

    def test_non_numeric_id_400(self, james):
        r = requests.post(f"{BASE}/drivers/my-notes/abc/reply", headers=james, json={"reply": "Got it"}, timeout=20)
        assert r.status_code == 400 and r.json()["error"] == "Invalid note id"

    def test_other_driver_404(self, admin, james, maria):
        nid = _note(admin, f"TEST_r16 other {uuid.uuid4().hex[:4]}")
        r = requests.post(f"{BASE}/drivers/my-notes/{nid}/reply", headers=maria, json={"reply": "Call me"}, timeout=20)
        assert r.status_code == 404, r.text
        assert _admin_note(admin, nid)["reply"] is None
        requests.post(f"{BASE}/drivers/my-notes/{nid}/reply", headers=james, json={"reply": "Got it"}, timeout=20)

    def test_reply_saves_and_socket(self, admin, admin_token, james):
        p = subprocess.Popen(["node", "/app/test_reports/regression/socket_round16_reply.cjs"],
                             env={**os.environ, "BASE": ORIGIN, "TOKEN": admin_token, "SECS": "8"},
                             stdout=subprocess.PIPE, text=True)
        time.sleep(2.5)
        nid = _note(admin, f"TEST_r16 omw {uuid.uuid4().hex[:4]}")
        nid2 = _note(admin, f"TEST_r16 gotit {uuid.uuid4().hex[:4]}")
        r = requests.post(f"{BASE}/drivers/my-notes/{nid}/reply", headers=james, json={"reply": " On my way "}, timeout=20)
        assert r.status_code == 200, r.text
        unread = r.json()
        assert isinstance(unread, list) and all(n["id"] != nid for n in unread)
        assert any(n["id"] == nid2 for n in unread)
        r2 = requests.post(f"{BASE}/drivers/my-notes/{nid2}/reply", headers=james, json={"reply": "Got it"}, timeout=20)
        assert r2.status_code == 200
        out, _ = p.communicate(timeout=20)
        n = _admin_note(admin, nid)
        assert n["reply"] == "On my way" and n["repliedAt"] and n["readAt"]
        assert _admin_note(admin, nid2)["reply"] == "Got it"
        assert "CONNECTED" in out, out
        events = [json.loads(l[8:]) for l in out.splitlines() if l.startswith("REPLIED ")]
        assert any(e["noteId"] == nid and e["reply"] == "On my way" and e["driverId"] == JAMES and e["driverName"] for e in events), out
        assert not any(e["noteId"] == nid2 for e in events), "Got it must not emit note:replied"

    def test_reply_keeps_original_readAt(self, admin, james):
        nid = _note(admin, f"TEST_r16 read {uuid.uuid4().hex[:4]}")
        requests.post(f"{BASE}/drivers/my-notes/{nid}/read", headers=james, timeout=20)
        read_at = _admin_note(admin, nid)["readAt"]
        time.sleep(1)
        requests.post(f"{BASE}/drivers/my-notes/{nid}/reply", headers=james, json={"reply": "Running late"}, timeout=20)
        n = _admin_note(admin, nid)
        assert n["readAt"] == read_at and n["reply"] == "Running late"


@pytest.fixture(scope="module")
def trip(admin, james):
    active = requests.get(f"{BASE}/trips/my-active", headers=james, timeout=20).json()
    if active and active.get("id"):
        pytest.skip("James already has an active trip")
    odo = float(psql("select current_odometer from vehicles where id=3")) + 5
    payload = {"vehicleId": 3, "startOdometer": odo, "startLatitude": LAT, "startLongitude": LNG, "clientRef": f"TEST_{uuid.uuid4()}"}
    files = {k: (f"{k}.jpg", jpg(), "image/jpeg") for k in ["license_plate", "driver_selfie", "start_odometer"]}
    r = requests.post(f"{BASE}/trips/start", headers=james, data={"payload": json.dumps(payload)}, files=files, timeout=30)
    assert r.status_code in (200, 201), r.text
    t = r.json()
    body = {"stops": [{"address": f"TEST_ r16 stop {i}", "latitude": LAT, "longitude": LNG} for i in range(3)], "clearDone": True}
    s = requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=admin, json=body, timeout=20)
    assert s.status_code == 200, s.text
    yield {"trip": t, "odo": odo, "stops": [x["id"] for x in s.json()["stops"]]}
    requests.post(f"{BASE}/trips/{t['id']}/cancel", headers=admin, timeout=20)
    requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=admin, json={"stops": [], "clearDone": True}, timeout=20)


def _stop(admin, sid):
    data = requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=admin, timeout=20).json()
    stops = data if isinstance(data, list) else data.get("stops", [])
    return next(s for s in stops if s["id"] == sid)


def _ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


# Stop arrival with arrivedAt (offline send) and late proof
class TestArrival:
    def test_arrivedAt_used(self, admin, james, trip):
        sid = trip["stops"][0]
        when = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(microsecond=0)
        r = requests.post(f"{BASE}/drivers/my-stops/{sid}/arrive", headers=james,
                          data={"latitude": LAT, "longitude": LNG, "arrivedAt": when.isoformat().replace("+00:00", "Z"), "odometer": trip["odo"] + 3},
                          files={"photo": ("p.jpg", jpg(), "image/jpeg")}, timeout=30)
        assert r.status_code == 200, r.text
        assert "stops" in r.json()
        s = _stop(admin, sid)
        assert abs((_ts(s["arrivedAt"]) - when).total_seconds()) < 2, s
        assert float(s["arrivedOdometer"]) == trip["odo"] + 3 and s["arrivedPhotoUrl"]

    def test_already_arrived_keeps_existing_proof(self, admin, james, trip):
        sid = trip["stops"][0]
        before = _stop(admin, sid)
        r = requests.post(f"{BASE}/drivers/my-stops/{sid}/arrive", headers=james,
                          data={"latitude": LAT, "longitude": LNG, "odometer": 1}, files={"photo": ("p.jpg", jpg(), "image/jpeg")}, timeout=30)
        assert r.status_code == 200, r.text
        after = _stop(admin, sid)
        assert after["arrivedOdometer"] == before["arrivedOdometer"] and after["arrivedPhotoUrl"] == before["arrivedPhotoUrl"]
        assert after["arrivedAt"] == before["arrivedAt"]

    def test_old_arrivedAt_falls_back_to_now(self, admin, james, trip):
        sid = trip["stops"][1]
        old = (datetime.now(timezone.utc) - timedelta(hours=72)).isoformat()
        r = requests.post(f"{BASE}/drivers/my-stops/{sid}/arrive", headers=james,
                          data={"latitude": LAT, "longitude": LNG, "arrivedAt": old}, timeout=30)
        assert r.status_code == 200, r.text
        s = _stop(admin, sid)
        assert abs((_ts(s["arrivedAt"]) - datetime.now(timezone.utc)).total_seconds()) < 60, s
        assert s["arrivedOdometer"] is None and not s["arrivedPhotoUrl"]

    def test_late_proof_attached_to_arrived_stop(self, admin, james, trip):
        sid = trip["stops"][1]
        r = requests.post(f"{BASE}/drivers/my-stops/{sid}/arrive", headers=james,
                          data={"latitude": LAT, "longitude": LNG, "odometer": trip["odo"] + 7},
                          files={"photo": ("p.jpg", jpg(), "image/jpeg")}, timeout=30)
        assert r.status_code == 200, r.text
        s = _stop(admin, sid)
        assert float(s["arrivedOdometer"]) == trip["odo"] + 7 and s["arrivedPhotoUrl"]

    def test_garbage_and_future_arrivedAt(self, admin, james, trip):
        sid = trip["stops"][2]
        r = requests.post(f"{BASE}/drivers/my-stops/{sid}/arrive", headers=james,
                          data={"latitude": LAT, "longitude": LNG, "arrivedAt": "not-a-date"}, timeout=30)
        assert r.status_code == 200, r.text
        s = _stop(admin, sid)
        assert abs((_ts(s["arrivedAt"]) - datetime.now(timezone.utc)).total_seconds()) < 60

    def test_bad_odometer_400(self, james, trip):
        r = requests.post(f"{BASE}/drivers/my-stops/{trip['stops'][2]}/arrive", headers=james,
                          data={"latitude": LAT, "longitude": LNG, "odometer": "-5"}, timeout=30)
        assert r.status_code == 400
