# Round 15: notes routes reject non-numeric ids with 400; notes send/read regression + dashboard 'notes:changed' emit path
import pytest
import requests

BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"
JAMES = 3


def _login(path, email, pw):
    r = requests.post(f"{BASE}{path}", json={"email": email, "password": pw}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {email}")
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


@pytest.fixture(scope="module")
def admin():
    return _login("/auth/login", "admin@fleet.com", "AdminTest123!")


@pytest.fixture(scope="module")
def james():
    return _login("/auth/driver/login", "james@fleet.com", "DriverTest123!")


@pytest.fixture(scope="module")
def maria():
    return _login("/auth/driver/login", "maria@fleet.com", "DriverTest123!")


# Non-numeric ids -> 400
class TestNonNumericIds:
    @pytest.mark.parametrize("bad", ["abc", "3abc", "1.5", "-1"])
    def test_get_notes_bad_id(self, admin, bad):
        r = requests.get(f"{BASE}/drivers/{bad}/notes", headers=admin, timeout=20)
        assert r.status_code == 400, r.text
        assert r.json()["error"] == "Invalid driver id"

    def test_post_notes_bad_id(self, admin):
        r = requests.post(f"{BASE}/drivers/abc/notes", headers=admin, json={"message": "TEST_x"}, timeout=20)
        assert r.status_code == 400, r.text
        assert r.json()["error"] == "Invalid driver id"

    def test_read_bad_note_id(self, james):
        r = requests.post(f"{BASE}/drivers/my-notes/abc/read", headers=james, timeout=20)
        assert r.status_code == 400, r.text
        assert r.json()["error"] == "Invalid note id"

    def test_unknown_numeric_driver_404(self, admin):
        r = requests.post(f"{BASE}/drivers/999999/notes", headers=admin, json={"message": "TEST_x"}, timeout=20)
        assert r.status_code == 404

    def test_unknown_numeric_note_read_200(self, james):
        r = requests.post(f"{BASE}/drivers/my-notes/999999/read", headers=james, timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# Send -> driver sees -> read -> dashboard shows readAt; isolation from other driver
class TestNotesRegression:
    def test_send_read_flow(self, admin, james, maria):
        r = requests.post(f"{BASE}/drivers/{JAMES}/notes", headers=admin, json={"message": "TEST_r15 regression"}, timeout=20)
        assert r.status_code == 201
        note = r.json()
        assert note["readAt"] is None and note["sentByName"]
        mine = requests.get(f"{BASE}/drivers/my-notes", headers=james, timeout=20).json()
        assert any(n["id"] == note["id"] for n in mine)
        other = requests.get(f"{BASE}/drivers/my-notes", headers=maria, timeout=20).json()
        assert all(n["id"] != note["id"] for n in other)
        # Maria cannot ack James's note
        requests.post(f"{BASE}/drivers/my-notes/{note['id']}/read", headers=maria, timeout=20)
        lst = requests.get(f"{BASE}/drivers/{JAMES}/notes", headers=admin, timeout=20).json()
        assert next(n for n in lst if n["id"] == note["id"])["readAt"] is None
        rr = requests.post(f"{BASE}/drivers/my-notes/{note['id']}/read", headers=james, timeout=20)
        assert rr.status_code == 200
        assert all(n["id"] != note["id"] for n in rr.json())
        lst = requests.get(f"{BASE}/drivers/{JAMES}/notes", headers=admin, timeout=20).json()
        assert next(n for n in lst if n["id"] == note["id"])["readAt"] is not None
