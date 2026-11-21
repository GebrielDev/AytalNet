# Round 21: Fix A Reading - PUT /api/drivers/:id/stops/:stopId/odometer (validation, original kept, flags recomputed, board count, sockets)
import io, json, os, subprocess, uuid
import pytest, requests
from PIL import Image

BASE = "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com/api"
JAMES = 3
LAT, LNG = 33.4497, -111.9464


def psql(sql):
    return subprocess.run(["su", "postgres", "-c", f'psql -d fleet_test -At -c "{sql}"'], capture_output=True, text=True).stdout.strip()


def jpg():
    b = io.BytesIO(); Image.new("RGB", (8, 8), (200, 10, 10)).save(b, "JPEG"); return b.getvalue()


def login(path, email, pw):
    r = requests.post(f"{BASE}{path}", json={"email": email, "password": pw}).json()
    return {"Authorization": "Bearer " + r["accessToken"]}, r.get("user", {})


@pytest.fixture(scope="module")
def ctx():
    a, au = login("/auth/login", "admin@fleet.com", "AdminTest123!")
    d, du = login("/auth/login", "dispatcher@fleet.com", "DispatchTest123!")
    j, _ = login("/auth/driver/login", "james@fleet.com", "DriverTest123!")
    if requests.get(f"{BASE}/trips/my-active", headers=j).json():
        pytest.skip("James already has an active trip")
    orig_odo = psql("select current_odometer from vehicles where id=3")
    S = int(float(orig_odo)) + 5
    payload = {"vehicleId": 3, "startOdometer": S, "startLatitude": LAT, "startLongitude": LNG, "clientRef": f"TEST_{uuid.uuid4()}"}
    files = {k: (f"{k}.jpg", jpg(), "image/jpeg") for k in ["license_plate", "driver_selfie", "start_odometer"]}
    r = requests.post(f"{BASE}/trips/start", headers=j, data={"payload": json.dumps(payload)}, files=files)
    assert r.status_code in (200, 201), r.text
    trip_id = r.json().get("id") or r.json().get("trip", {}).get("id")
    body = {"stops": [{"address": f"TEST_r21 stop {i + 1}", "latitude": LAT, "longitude": LNG} for i in range(5)], "clearDone": True}
    s = requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=a, json=body)
    assert s.status_code == 200, s.text
    ids = [x["id"] for x in s.json()["stops"]]
    # stop1 good, stop2 typo (flag), stop3 no reading, stop4 typo kept for UI
    for i, reading in enumerate([S + 10, S + 5000, None, S + 9000]):
        data = {"latitude": LAT, "longitude": LNG}
        if reading is not None:
            data["odometer"] = str(reading)
        rr = requests.post(f"{BASE}/drivers/my-stops/{ids[i]}/arrive", headers=j, data=data)
        assert rr.status_code == 200, rr.text
    c = {"a": a, "d": d, "j": j, "au": au, "du": du, "S": S, "trip": trip_id, "ids": ids}
    yield c
    print(f"\nTRIP_ID={trip_id} ORIG_ODO={orig_odo} S={S} IDS={ids}")
    if os.environ.get("KEEP"):
        return
    t = requests.get(f"{BASE}/trips/my-active", headers=j).json()
    if t and t.get("id"):
        requests.post(f"{BASE}/trips/{t['id']}/cancel", headers=a)
    requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=a, json={"stops": [], "clearDone": True})
    psql(f"update vehicles set current_odometer={orig_odo} where id=3")


def put(ctx, stop_id, body, who="a", driver=JAMES):
    return requests.put(f"{BASE}/drivers/{driver}/stops/{stop_id}/odometer", headers=ctx[who], json=body)


def me(stops, sid):
    return next(s for s in stops if s["id"] == sid)


def board_row(ctx):
    return next(x for x in requests.get(f"{BASE}/drivers/stops-board", headers=ctx["a"]).json() if x["driverId"] == JAMES)


class TestFixReading:
    def test_initial_flags(self, ctx):
        S = ctx["S"]
        stops = requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=ctx["a"]).json()
        assert me(stops, ctx["ids"][1])["odometerFlag"] == "4990 mi since stop 1 — check"
        assert me(stops, ctx["ids"][3])["odometerFlag"] == "8990 mi since stop 1 — check"
        assert board_row(ctx)["odometerFlags"] == 2

    def test_auth(self, ctx):
        sid = ctx["ids"][1]
        assert requests.put(f"{BASE}/drivers/{JAMES}/stops/{sid}/odometer", json={"odometer": 1, "reason": "x"}).status_code == 401
        assert put(ctx, sid, {"odometer": ctx["S"] + 20, "reason": "TEST_"}, who="j").status_code in (401, 403)

    @pytest.mark.parametrize("body", [{"reason": "TEST_r"}, {"odometer": -1, "reason": "TEST_r"}, {"odometer": "abc", "reason": "TEST_r"},
                                      {"odometer": "", "reason": "TEST_r"}, {"odometer": None, "reason": "TEST_r"}, {"odometer": 10000000, "reason": "TEST_r"},
                                      {"odometer": 100, "reason": ""}, {"odometer": 100, "reason": "   "}, {"odometer": 100}])
    def test_validation_400(self, ctx, body):
        r = put(ctx, ctx["ids"][1], body)
        assert r.status_code == 400, r.text
        assert r.json().get("error")

    def test_loose_types_report(self, ctx):
        # Informational: bool/array coerce via Number() (true->1, [5]->5). Expect 400 ideally.
        res = {}
        for name, val in [("bool", True), ("array", [5])]:
            res[name] = put(ctx, ctx["ids"][1], {"odometer": val, "reason": "TEST_r"}).status_code
        print("LOOSE_TYPES", res)
        # restore whatever got written so later tests start from a known state - first correction sets original
        stop = me(requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=ctx["a"]).json(), ctx["ids"][1])
        ctx["loose_written"] = stop.get("originalOdometer") is not None
        assert res["bool"] == 400 and res["array"] == 400, res

    def test_no_reading_and_ids(self, ctx):
        r = put(ctx, ctx["ids"][2], {"odometer": 100, "reason": "TEST_r"})
        assert r.status_code == 400 and "no odometer" in r.json()["error"]
        assert put(ctx, "abc", {"odometer": 100, "reason": "TEST_r"}).status_code == 400
        assert put(ctx, ctx["ids"][1], {"odometer": 100, "reason": "TEST_r"}, driver="x1").status_code == 400
        assert put(ctx, ctx["ids"][1], {"odometer": 100, "reason": "TEST_r"}, driver=2).status_code == 404
        assert put(ctx, 99999999, {"odometer": 100, "reason": "TEST_r"}).status_code == 404

    def test_correct_clears_flag(self, ctx):
        S, sid = ctx["S"], ctx["ids"][1]
        r = put(ctx, sid, {"odometer": S + 20, "reason": "TEST_ typo, extra zeros"})
        assert r.status_code == 200, r.text
        s = me(r.json()["stops"], sid)
        assert s["arrivedOdometer"] == S + 20
        if not ctx.get("loose_written"):
            assert s["originalOdometer"] == S + 5000
        assert s["odometerCorrectedBy"] == ctx["au"].get("name", s["odometerCorrectedBy"])
        assert s["odometerCorrectedAt"] and s["odometerCorrectionReason"] == "TEST_ typo, extra zeros"
        assert s["odometerFlag"] is None
        # stop 4 now compares with corrected stop 2
        assert me(r.json()["stops"], ctx["ids"][3])["odometerFlag"] == "8980 mi since stop 2 — check"
        row = board_row(ctx)
        assert row["odometerFlags"] == 1
        assert me(row["stops"], sid)["originalOdometer"] is not None

    def test_still_bad_value_keeps_flag(self, ctx):
        S, sid = ctx["S"], ctx["ids"][1]
        r = put(ctx, sid, {"odometer": S - 50, "reason": "TEST_ wrong again"}, who="d")
        assert r.status_code == 200
        assert me(r.json()["stops"], sid)["odometerFlag"] == f"Lower than trip start ({S})"

    def test_second_correction_keeps_original(self, ctx):
        S, sid = ctx["S"], ctx["ids"][1]
        r = put(ctx, sid, {"odometer": str(S + 25), "reason": "  TEST_ dispatcher fix  "}, who="d")
        assert r.status_code == 200
        s = me(r.json()["stops"], sid)
        if not ctx.get("loose_written"):
            assert s["originalOdometer"] == S + 5000
        assert s["arrivedOdometer"] == S + 25
        assert s["odometerCorrectionReason"] == "TEST_ dispatcher fix"
        assert s["odometerCorrectedBy"] == ctx["du"].get("name", s["odometerCorrectedBy"]) and s["odometerCorrectedBy"] != ctx["au"].get("name")
        got = me(requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=ctx["a"]).json(), sid)
        assert got["arrivedOdometer"] == S + 25 and got["odometerFlag"] is None
        mine = requests.get(f"{BASE}/drivers/my-stops", headers=ctx["j"]).json()
        mine = mine if isinstance(mine, list) else mine.get("stops", [])
        assert me(mine, sid)["arrivedOdometer"] == S + 25

    def test_sockets(self, ctx):
        env = dict(os.environ, BASE=BASE[:-4], STOP_ID=str(ctx["ids"][1]), ODO=str(ctx["S"] + 26))
        out = subprocess.run(["node", "/app/test_reports/regression/socket_round21_fix.cjs"], capture_output=True, text=True, env=env, timeout=60).stdout
        print(out)
        res = json.loads(out.strip().splitlines()[-1])
        assert res["status"] == 200
        assert any(c.get("driverId") == JAMES for c in res["changed"])
        assert res["updCount"] >= 1 and res["updOdo"] == ctx["S"] + 26 and res["updFlag"] is None
