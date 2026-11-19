# Round 7: GET /api/drivers/stops-board (dispatcher stops progress board)
import os, subprocess
import pytest, requests

BASE = os.environ["API_BASE"].rstrip("/")  # .../api


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
def dispatcher():
    return login("/auth/login", "dispatcher@fleet.com", "DispatchTest123!")


@pytest.fixture(scope="module")
def sarah():
    return login("/auth/driver/login", "sarah@fleet.com", "DriverTest123!")


@pytest.fixture(scope="module")
def board(admin):
    r = requests.get(f"{BASE}/drivers/stops-board", headers=admin, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


# Access control
class TestAccess:
    def test_admin_ok(self, board):
        assert isinstance(board, list) and len(board) > 0

    def test_dispatcher_ok(self, dispatcher):
        r = requests.get(f"{BASE}/drivers/stops-board", headers=dispatcher, timeout=20)
        assert r.status_code == 200 and isinstance(r.json(), list)

    def test_driver_forbidden(self, sarah):
        r = requests.get(f"{BASE}/drivers/stops-board", headers=sarah, timeout=20)
        assert r.status_code == 403, r.text

    def test_no_token_401(self):
        r = requests.get(f"{BASE}/drivers/stops-board", timeout=20)
        assert r.status_code == 401


# Shape and content
class TestContent:
    def test_row_shape(self, board):
        keys = {"driverId", "name", "employeeId", "plate", "activeTrip", "stops", "done", "total"}
        for r in board:
            assert keys <= set(r), r
            assert r["total"] == len(r["stops"])
            assert r["done"] == len([s for s in r["stops"] if s["arrivedAt"]])

    def test_stops_in_order(self, board):
        for r in board:
            pos = [s["position"] for s in r["stops"]]
            assert pos == sorted(pos), (r["driverId"], pos)

    def test_only_active_drivers(self, board):
        active = set(int(x) for x in psql("select id from drivers where status='active'").split())
        assert {r["driverId"] for r in board} == active

    def test_active_trips_match_db(self, board):
        db = {}
        for line in psql("select driver_id, id from trips where status='in_progress'").splitlines():
            d, t = line.split("|"); db[int(d)] = int(t)
        for r in board:
            if r["driverId"] in db:
                assert r["activeTrip"] and r["activeTrip"]["id"] == db[r["driverId"]]
            else:
                assert r["activeTrip"] is None

    def test_working_first_then_name(self, board):
        working = [r for r in board if r["total"] > r["done"]]
        rest = [r for r in board if not (r["total"] > r["done"])]
        assert board == working + rest
        assert [r["name"] for r in working] == sorted(r["name"] for r in working)

    def test_idle_drivers_present(self, board):
        idle = {r["name"].split()[0] for r in board if r["total"] == 0}
        assert {"James", "Michael"} <= idle

    def test_sarah_row(self, board):
        s = next(r for r in board if r["driverId"] == 4)
        addrs = [x["address"] for x in s["stops"]]
        assert addrs[0].startswith("Phoenix Zoo") and addrs[1].startswith("Chase Field")
        assert s["plate"] == "GHI-3456"
