# Round 14: driver notes, trip history (?days=30), stop-proof arrival (multipart odometer+photo), file access control
import io
import os
import struct
import zlib
import pytest
import requests

BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"
JAMES = 3
OTHER_PHOTO = "sts-fleet/trips/ff158e04-f70c-4fc3-8a25-cc2749a407ef.jpg"  # driver 2 (Maria)


def _png():
    raw = b"\x00\xff\x00\x00"
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


@pytest.fixture(scope="module")
def admin():
    r = requests.post(f"{BASE}/auth/login", json={"email": "admin@fleet.com", "password": "AdminTest123!"}, timeout=20)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


@pytest.fixture(scope="module")
def james():
    r = requests.post(f"{BASE}/auth/driver/login", json={"email": "james@fleet.com", "password": "DriverTest123!"}, timeout=20)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


@pytest.fixture(scope="module")
def maria():
    r = requests.post(f"{BASE}/auth/driver/login", json={"email": "maria@fleet.com", "password": "DriverTest123!"}, timeout=20)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


# ---------- Notes ----------
class TestNotes:
    def test_empty_message_400(self, admin):
        r = requests.post(f"{BASE}/drivers/{JAMES}/notes", headers=admin, json={"message": "   "}, timeout=20)
        assert r.status_code == 400 and "error" in r.json()

    def test_too_long_400(self, admin):
        r = requests.post(f"{BASE}/drivers/{JAMES}/notes", headers=admin, json={"message": "x" * 501}, timeout=20)
        assert r.status_code == 400

    def test_unknown_driver_404(self, admin):
        r = requests.post(f"{BASE}/drivers/999999/notes", headers=admin, json={"message": "TEST_ hi"}, timeout=20)
        assert r.status_code == 404

    def test_driver_token_forbidden(self, james):
        r1 = requests.get(f"{BASE}/drivers/{JAMES}/notes", headers=james, timeout=20)
        r2 = requests.post(f"{BASE}/drivers/{JAMES}/notes", headers=james, json={"message": "TEST_x"}, timeout=20)
        assert r1.status_code in (401, 403) and r2.status_code in (401, 403)

    def test_send_list_read_flow(self, admin, james, maria):
        r = requests.post(f"{BASE}/drivers/{JAMES}/notes", headers=admin, json={"message": "TEST_ round14 note"}, timeout=20)
        assert r.status_code == 201
        note = r.json()
        assert note["message"] == "TEST_ round14 note" and note["readAt"] is None and note["sentByName"]
        lst = requests.get(f"{BASE}/drivers/{JAMES}/notes", headers=admin, timeout=20).json()
        assert lst[0]["id"] == note["id"]
        mine = requests.get(f"{BASE}/drivers/my-notes", headers=james, timeout=20).json()
        assert any(n["id"] == note["id"] for n in mine)
        assert all(n["readAt"] is None for n in mine)
        # Maria cannot mark James's note
        requests.post(f"{BASE}/drivers/my-notes/{note['id']}/read", headers=maria, timeout=20)
        mine = requests.get(f"{BASE}/drivers/my-notes", headers=james, timeout=20).json()
        assert any(n["id"] == note["id"] for n in mine), "Other driver could ack James's note"
        r = requests.post(f"{BASE}/drivers/my-notes/{note['id']}/read", headers=james, timeout=20)
        assert r.status_code == 200
        assert all(n["id"] != note["id"] for n in r.json())
        lst = requests.get(f"{BASE}/drivers/{JAMES}/notes", headers=admin, timeout=20).json()
        assert next(n for n in lst if n["id"] == note["id"])["readAt"] is not None

    def test_read_non_numeric_id(self, james):
        r = requests.post(f"{BASE}/drivers/my-notes/abc/read", headers=james, timeout=20)
        print("non-numeric note id ->", r.status_code, r.text[:120])
        assert r.status_code < 500


# ---------- Trip history ----------
class TestTripHistory:
    def test_days_30_has_photos(self, james):
        r = requests.get(f"{BASE}/trips/my-trips?days=30", headers=james, timeout=30)
        assert r.status_code == 200
        trips = r.json()
        assert len(trips) > 0
        assert all("photos" in t for t in trips)
        assert any(len(t["photos"]) > 0 for t in trips)
        p = next(p for t in trips for p in t["photos"])
        assert {"id", "photoType", "photoUrl"} <= set(p)

    def test_default_last_10_no_photos(self, james):
        trips = requests.get(f"{BASE}/trips/my-trips", headers=james, timeout=30).json()
        assert len(trips) <= 10 and all("photos" not in t for t in trips)


# ---------- File access ----------
class TestFiles:
    def test_dispatcher_can_read(self, admin):
        r = requests.get(f"{BASE}/files/{OTHER_PHOTO}", headers=admin, timeout=30)
        assert r.status_code == 200 and r.headers["Content-Type"].startswith("image")

    def test_driver_forbidden_others(self, james):
        r = requests.get(f"{BASE}/files/{OTHER_PHOTO}", headers=james, timeout=30)
        assert r.status_code == 403

    def test_driver_owns_own(self, james):
        trips = requests.get(f"{BASE}/trips/my-trips?days=30", headers=james, timeout=30).json()
        url = next(p["photoUrl"] for t in trips for p in t["photos"] if "/files/" in p["photoUrl"])
        r = requests.get(url, headers=james, timeout=30)
        assert r.status_code == 200

    def test_no_token_401(self):
        r = requests.get(f"{BASE}/files/{OTHER_PHOTO}", timeout=30)
        assert r.status_code in (401, 403)


# ---------- Stop proof ----------
@pytest.fixture(scope="module")
def stops(admin):
    body = {"stops": [
        {"address": "TEST_ R14 stop A", "latitude": 33.4497, "longitude": -111.9464},
        {"address": "TEST_ R14 stop B", "latitude": 33.4457, "longitude": -112.0667},
        {"address": "TEST_ R14 stop C", "latitude": 33.4500, "longitude": -112.0700},
    ], "clearDone": True}
    r = requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=admin, json=body, timeout=60)
    assert r.status_code == 200, r.text
    s = requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=admin, timeout=20).json()
    s = s if isinstance(s, list) else s.get("stops", s)
    yield s
    requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=admin, json={"stops": [], "clearDone": True}, timeout=60)


class TestStopProof:
    def test_invalid_odometer_400(self, james, stops):
        a = stops[0]
        r = requests.post(f"{BASE}/drivers/my-stops/{a['id']}/arrive", headers=james,
                          data={"latitude": a["latitude"], "longitude": a["longitude"], "odometer": "abc"}, timeout=30)
        assert r.status_code == 400
        r = requests.post(f"{BASE}/drivers/my-stops/{a['id']}/arrive", headers=james,
                          data={"latitude": a["latitude"], "longitude": a["longitude"], "odometer": "-5"}, timeout=30)
        assert r.status_code == 400

    def test_multipart_with_odo_and_photo(self, james, admin, stops):
        a = stops[0]
        r = requests.post(f"{BASE}/drivers/my-stops/{a['id']}/arrive", headers=james,
                          data={"latitude": str(a["latitude"]), "longitude": str(a["longitude"]), "odometer": "12345.6"},
                          files={"photo": ("odo.png", io.BytesIO(_png()), "image/png")}, timeout=60)
        assert r.status_code == 200, r.text
        s = next(x for x in r.json()["stops"] if x["id"] == a["id"])
        print("arrived stop:", {k: (str(v)[:80]) for k, v in s.items()})
        assert float(s["arrivedOdometer"]) == 12345.6
        assert s["arrivedPhotoUrl"]
        # dispatcher sees it too
        d = requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=admin, timeout=20).json()
        d = d if isinstance(d, list) else d.get("stops", d)
        ds = next(x for x in d if x["id"] == a["id"])
        assert ds["arrivedPhotoUrl"] and float(ds["arrivedOdometer"]) == 12345.6
        if "/files/" in s["arrivedPhotoUrl"]:
            assert requests.get(s["arrivedPhotoUrl"], headers=james, timeout=30).status_code == 200

    def test_multipart_no_proof(self, james, stops):
        b = stops[1]
        r = requests.post(f"{BASE}/drivers/my-stops/{b['id']}/arrive", headers=james,
                          data={"latitude": str(b["latitude"]), "longitude": str(b["longitude"])}, timeout=30)
        assert r.status_code == 200, r.text
        s = next(x for x in r.json()["stops"] if x["id"] == b["id"])
        assert s["arrivedAt"] and s.get("arrivedOdometer") is None and s.get("arrivedPhotoUrl") is None

    def test_json_body_still_works(self, james, stops):
        c = stops[2]
        r = requests.post(f"{BASE}/drivers/my-stops/{c['id']}/arrive", headers=james,
                          json={"latitude": c["latitude"], "longitude": c["longitude"], "odometer": 12400}, timeout=30)
        assert r.status_code == 200, r.text
        s = next(x for x in r.json()["stops"] if x["id"] == c["id"])
        assert s["arrivedAt"] and float(s["arrivedOdometer"]) == 12400

    def test_stops_board_has_proof(self, admin, stops):
        r = requests.get(f"{BASE}/drivers/stops-board", headers=admin, timeout=30)
        assert r.status_code == 200
        print("stops-board sample:", str(r.json())[:300])
        assert "arrivedOdometer" in r.text
