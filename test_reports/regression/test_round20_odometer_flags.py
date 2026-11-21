# Round 20: Odometer flags on stops (flagOdometers) - arrive response, GET /drivers/:id/stops, stops-board odometerFlags count
import io, json, subprocess, uuid
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
    return {"Authorization": "Bearer " + requests.post(f"{BASE}{path}", json={"email": email, "password": pw}).json()["accessToken"]}


@pytest.fixture(scope="module")
def ctx():
    a = login("/auth/login", "admin@fleet.com", "AdminTest123!")
    j = login("/auth/driver/login", "james@fleet.com", "DriverTest123!")
    if requests.get(f"{BASE}/trips/my-active", headers=j).json():
        pytest.skip("James already has an active trip")
    orig_odo = psql("select current_odometer from vehicles where id=3")
    S = int(float(orig_odo)) + 5
    payload = {"vehicleId": 3, "startOdometer": S, "startLatitude": LAT, "startLongitude": LNG, "clientRef": f"TEST_{uuid.uuid4()}"}
    files = {k: (f"{k}.jpg", jpg(), "image/jpeg") for k in ["license_plate", "driver_selfie", "start_odometer"]}
    r = requests.post(f"{BASE}/trips/start", headers=j, data={"payload": json.dumps(payload)}, files=files)
    assert r.status_code in (200, 201), r.text
    trip_id = r.json().get("id") or r.json().get("trip", {}).get("id")
    body = {"stops": [{"address": f"TEST_r20 stop {i + 1}", "latitude": LAT, "longitude": LNG} for i in range(7)], "clearDone": True}
    s = requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=a, json=body)
    assert s.status_code == 200, s.text
    c = {"a": a, "j": j, "S": S, "trip": trip_id, "ids": [x["id"] for x in s.json()["stops"]], "arrive": {}}
    yield c
    print(f"\nTRIP_ID={trip_id} ORIG_ODO={orig_odo} S={S}")
    if __import__("os").environ.get("KEEP"):
        return  # keep data for UI checks; clean up later
    # cleanup: own trip + stops; restore vehicle odometer
    t = requests.get(f"{BASE}/trips/my-active", headers=j).json()
    if t and t.get("id"):
        requests.post(f"{BASE}/trips/{t['id']}/cancel", headers=a)
    requests.put(f"{BASE}/drivers/{JAMES}/stops", headers=a, json={"stops": [], "clearDone": True})
    psql(f"update vehicles set current_odometer={orig_odo} where id=3")


# readings relative to trip start S; expected flags while trip in progress
def plan(S):
    return [
        (S + 10, None),
        (S + 310, None),                                   # exactly 300 jump -> not flagged
        (S + 305, f"Lower than stop 2 ({S + 310})"),
        (S - 3, f"Lower than trip start ({S})"),
        (S + 700, "390 mi since stop 2 — check"),          # compared with last GOOD reading (stop 2)
        (None, None),                                      # no reading
        (S + 420, None),
    ]


def flags_of(stops):
    return [s.get("odometerFlag") for s in stops]


class TestOdometerFlags:
    def test_arrive_each_stop_returns_flags(self, ctx):
        S = ctx["S"]
        for i, (reading, expected) in enumerate(plan(S)):
            data = {"latitude": LAT, "longitude": LNG}
            if reading is not None:
                data["odometer"] = str(reading)
            r = requests.post(f"{BASE}/drivers/my-stops/{ctx['ids'][i]}/arrive", headers=ctx["j"], data=data)
            assert r.status_code == 200, r.text
            stops = r.json()["stops"]
            assert all("odometerFlag" in s for s in stops)
            me = next(s for s in stops if s["id"] == ctx["ids"][i])
            assert me["arrivedOdometer"] == (reading if reading is None else float(reading))
            assert me["odometerFlag"] == expected, f"stop {i + 1}: {me['odometerFlag']!r} != {expected!r}"
            assert me["tripId"] == ctx["trip"]

    def test_get_driver_stops_flags(self, ctx):
        r = requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=ctx["a"])
        assert r.status_code == 200
        assert flags_of(r.json()) == [e for _, e in plan(ctx["S"])]

    def test_my_stops_includes_flag(self, ctx):
        r = requests.get(f"{BASE}/drivers/my-stops", headers=ctx["j"])
        assert r.status_code == 200
        body = r.json()
        stops = body if isinstance(body, list) else body.get("stops", [])
        assert len(stops) == 7 and all("odometerFlag" in s for s in stops)

    def test_board_row_flag_count(self, ctx):
        r = requests.get(f"{BASE}/drivers/stops-board", headers=ctx["a"])
        assert r.status_code == 200
        row = next(x for x in r.json() if x["driverId"] == JAMES)
        assert row["odometerFlags"] == 3
        assert row["done"] == 7 and row["total"] == 7
        assert flags_of(row["stops"]) == [e for _, e in plan(ctx["S"])]
        # other drivers have numeric counts
        assert all(isinstance(x["odometerFlags"], int) for x in r.json())

    def test_end_trip_higher_than_end_flag(self, ctx):
        S = ctx["S"]
        r = requests.put(f"{BASE}/trips/{ctx['trip']}/end", headers=ctx["j"], json={"endOdometer": S + 410, "endLatitude": LAT, "endLongitude": LNG, "endAddress": "TEST_r20 end"})
        assert r.status_code == 200, r.text
        stops = requests.get(f"{BASE}/drivers/{JAMES}/stops", headers=ctx["a"]).json()
        exp = [e for _, e in plan(S)]
        exp[4] = f"Higher than trip end ({S + 410})"  # S+700 is also past the trip end
        exp[6] = f"Higher than trip end ({S + 410})"
        assert flags_of(stops) == exp
        row = next(x for x in requests.get(f"{BASE}/drivers/stops-board", headers=ctx["a"]).json() if x["driverId"] == JAMES)
        assert row["odometerFlags"] == 4

    def test_unauth_board(self, ctx):
        r = requests.get(f"{BASE}/drivers/stops-board")
        assert r.status_code in (401, 403)
