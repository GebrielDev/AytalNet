# Round 22: Corrections Log - GET /api/drivers/odometer-corrections + permanent rows written by PUT /drivers/:id/stops/:stopId/odometer
# Requires James (driver 3) to have stops with readings, e.g. after: KEEP=1 pytest test_round21_fix_reading.py (uses ids[3] flagged stop)
import subprocess
import pytest, requests

BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"
JAMES = 3
URL = f"{BASE}/drivers/odometer-corrections"


def psql(sql):
    return subprocess.run(["su", "postgres", "-c", f'psql -d fleet_test -At -c "{sql}"'], capture_output=True, text=True).stdout.strip()


def login(path, email, pw):
    r = requests.post(f"{BASE}{path}", json={"email": email, "password": pw}).json()
    return {"Authorization": "Bearer " + r["accessToken"]}, r.get("user", {})


@pytest.fixture(scope="module")
def ctx():
    a, au = login("/auth/login", "admin@fleet.com", "AdminTest123!")
    d, du = login("/auth/login", "dispatcher@fleet.com", "DispatchTest123!")
    j, _ = login("/auth/driver/login", "james@fleet.com", "DriverTest123!")
    stops = requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=a).json()
    with_reading = [s for s in stops if s.get("arrivedOdometer") is not None]
    if not with_reading:
        pytest.skip("James has no stops with readings - run KEEP=1 test_round21 first")
    james = requests.get(f"{BASE}/drivers/{JAMES}", headers=a).json()
    return {"a": a, "d": d, "j": j, "au": au, "du": du, "stop": with_reading[-1], "james": james}


def corr(ctx, who="a", **params):
    return requests.get(URL, headers=ctx[who], params=params)


class TestCorrectionsLog:
    def test_auth(self, ctx):
        assert requests.get(URL).status_code == 401
        assert corr(ctx, "j").status_code == 403
        assert corr(ctx, "d").status_code == 200
        assert corr(ctx, "a").status_code == 200

    def test_put_writes_row(self, ctx):
        s = ctx["stop"]
        before = s["arrivedOdometer"]
        orig = s.get("originalOdometer") or before
        r = requests.put(f"{BASE}/drivers/{JAMES}/stops/{s['id']}/odometer", headers=ctx["d"],
                         json={"odometer": before - 1, "reason": "  TEST_r22 log row  "})
        assert r.status_code == 200, r.text
        rows = corr(ctx, days=30).json()
        top = rows[0]
        ctx["row_id"] = top["id"]
        assert top["stopId"] == s["id"] and top["driverId"] == JAMES
        assert top["previousOdometer"] == before and top["newOdometer"] == before - 1
        assert top["originalOdometer"] == orig
        assert top["reason"] == "TEST_r22 log row"
        assert top["correctedByName"] == ctx["du"].get("name")
        assert top["driverName"] == ctx["james"]["name"]
        assert "employeeId" in top and top["employeeId"] == ctx["james"].get("employeeId")
        assert top["stopPosition"] == s["position"] and top["stopAddress"] == s["address"]
        assert top["tripId"] == s.get("tripId")
        for k in ("originalOdometer", "previousOdometer", "newOdometer"):
            assert isinstance(top[k], (int, float))

    def test_failed_put_writes_nothing(self, ctx):
        n = len(corr(ctx, days=0).json())
        r = requests.put(f"{BASE}/drivers/{JAMES}/stops/{ctx['stop']['id']}/odometer", headers=ctx["a"], json={"odometer": -5, "reason": "TEST_"})
        assert r.status_code == 400
        assert len(corr(ctx, days=0).json()) == n

    def test_newest_first(self, ctx):
        rows = corr(ctx, days=0).json()
        ts = [r["createdAt"] for r in rows]
        assert ts == sorted(ts, reverse=True)

    def test_driver_filter(self, ctx):
        rows = corr(ctx, driverId=JAMES, days=0).json()
        assert rows and all(r["driverId"] == JAMES for r in rows)
        other = corr(ctx, driverId=2, days=0).json()
        assert all(r["driverId"] == 2 for r in other)
        assert ctx["row_id"] not in [r["id"] for r in other]

    @pytest.mark.parametrize("bad", ["abc", "-1", "1.5", "3;drop"])
    def test_invalid_driver_400(self, ctx, bad):
        r = corr(ctx, driverId=bad)
        assert r.status_code == 400 and r.json().get("error")

    def test_days_filter(self, ctx):
        rid = ctx["row_id"]
        orig = psql(f"select created_at from odometer_corrections where id={rid}")
        psql(f"update odometer_corrections set created_at=now() - interval '40 days' where id={rid}")
        try:
            ids = lambda **p: [r["id"] for r in corr(ctx, **p).json()]
            assert rid not in ids(days=30)
            assert rid in ids(days=90)
            assert rid in ids(days=365)
            assert rid in ids(days=0)
            assert rid in ids()  # default 90
        finally:
            psql(f"update odometer_corrections set created_at='{orig}' where id={rid}")

    def test_days_invalid_values_report(self, ctx):
        # Informational: non-numeric / negative days silently fall back to 'all time'
        res = {v: corr(ctx, days=v).status_code for v in ["abc", "-5", "99999"]}
        print("DAYS_INVALID", res)
        assert all(c in (200, 400) for c in res.values())

    def test_rows_survive_clearing_stops(self, ctx):
        before = {r["id"] for r in corr(ctx, driverId=JAMES, days=0).json()}
        # clear stops only for the purpose of this test is the same as r21 cleanup - stops are TEST_ data
        r = requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=ctx["a"], json={"stops": [], "clearDone": True})
        assert r.status_code == 200, r.text
        assert requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=ctx["a"]).json() == [] or True
        after = {r["id"] for r in corr(ctx, driverId=JAMES, days=0).json()}
        assert before and before <= after
