# Round 5: destination history on trips, arrival check, setDestination geocode flag
import io, json, os, subprocess, time, uuid
import pytest, requests
from PIL import Image

BASE = os.environ["API_BASE"].rstrip("/")  # .../api


def login(path, email, pw):
    r = requests.post(f"{BASE}{path}", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


def psql(sql):
    out = subprocess.run(["su", "postgres", "-c", f'psql -d fleet_test -At -c "{sql}"'], capture_output=True, text=True)
    return out.stdout.strip()


def jpg():
    b = io.BytesIO(); Image.new("RGB", (8, 8), (200, 10, 10)).save(b, "JPEG"); return b.getvalue()


@pytest.fixture(scope="module")
def admin():
    return login("/auth/login", "admin@fleet.com", "AdminTest123!")


@pytest.fixture(scope="module")
def maria():
    return login("/auth/driver/login", "maria@fleet.com", "DriverTest123!")


@pytest.fixture(scope="module")
def james():
    return login("/auth/driver/login", "james@fleet.com", "DriverTest123!")


def start(h, vehicle_id, extra):
    odo = float(psql(f"select current_odometer from vehicles where id={vehicle_id}")) + 5
    payload = {"vehicleId": vehicle_id, "startOdometer": odo, "startLatitude": 33.45, "startLongitude": -112.07,
               "clientRef": f"TEST_{uuid.uuid4()}", **extra}
    files = {k: (f"{k}.jpg", jpg(), "image/jpeg") for k in ["license_plate", "driver_selfie", "start_odometer"]}
    r = requests.post(f"{BASE}/trips/start", headers=h, data={"payload": json.dumps(payload)}, files=files, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json(), odo


def end(h, trip_id, odo, lat, lng):
    r = requests.post(f"{BASE}/trips/{trip_id}/photos", headers=h, data={"photoType": "end_odometer"},
                      files={"photo": ("e.jpg", jpg(), "image/jpeg")}, timeout=30)
    assert r.status_code in (200, 201), r.text
    r = requests.put(f"{BASE}/trips/{trip_id}/end", headers=h,
                     json={"endOdometer": odo + 3, "endLatitude": lat, "endLongitude": lng}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def dest():
    lat, lng = psql("select destination_latitude, destination_longitude from drivers where id=2").split("|")
    return float(lat), float(lng)


class TestArrival:
    def test_matching_destination_arrived(self, maria):
        lat, lng = dest()
        t, odo = start(maria, 2, {"destinationAddress": "Phoenix Sky Harbor International Airport, Phoenix, AZ"})
        assert t["destinationAddress"].startswith("Phoenix Sky Harbor")
        assert t["destinationNote"] == "Terminal 4"
        assert abs(float(t["destinationLatitude"]) - lat) < 1e-5 and t["destinationLongitude"] is not None
        e = end(maria, t["id"], odo, lat + 0.001, lng)  # ~111 m
        print("near", t["id"], e["arrivedAtDestination"], e["endDistanceMeters"])
        assert e["arrivedAtDestination"] is True and e["endDistanceMeters"] < 300
        # GET persistence
        g = requests.get(f"{BASE}/trips/{t['id']}", headers=login("/auth/login", "admin@fleet.com", "AdminTest123!")).json()
        assert g["arrivedAtDestination"] is True

    def test_no_key_copies_current_far_away(self, maria):
        lat, lng = dest()
        t, odo = start(maria, 2, {})
        assert t["destinationAddress"].startswith("Phoenix Sky Harbor") and t["destinationLatitude"] is not None
        e = end(maria, t["id"], odo, lat + 0.045, lng)  # ~5 km
        print("far", t["id"], e["arrivedAtDestination"], e["endDistanceMeters"])
        assert e["arrivedAtDestination"] is False and 4500 < e["endDistanceMeters"] < 5500

    def test_different_address_null_coords(self, maria):
        t, odo = start(maria, 2, {"destinationAddress": "TEST_ Old address 1 Main St"})
        assert t["destinationAddress"] == "TEST_ Old address 1 Main St"
        assert t["destinationLatitude"] is None and t["destinationLongitude"] is None and t["destinationNote"] is None
        e = end(maria, t["id"], odo, 33.43, -112.0)
        assert e["arrivedAtDestination"] is None and e["endDistanceMeters"] is None

    def test_empty_address_clears(self, james):
        t, odo = start(james, 3, {"destinationAddress": ""})
        assert t["destinationAddress"] is None
        e = end(james, t["id"], odo, 33.43, -112.0)
        assert e["arrivedAtDestination"] is None

    def test_trip17(self, admin):
        g = requests.get(f"{BASE}/trips/17", headers=admin).json()
        assert g["arrivedAtDestination"] is True and g["endDistanceMeters"] == 93


class TestGeocodeFlag:
    def test_not_found_still_saves(self, admin):
        r = requests.put(f"{BASE}/drivers/4/destination", headers=admin, json={"address": "zzqx nowhere 99999 qqq", "note": "TEST_"})
        assert r.status_code == 200 and r.json()["destinationFound"] is False
        assert r.json()["destinationAddress"] == "zzqx nowhere 99999 qqq"
        time.sleep(1.2)
        r = requests.put(f"{BASE}/drivers/4/destination", headers=admin, json={"address": "Phoenix Sky Harbor International Airport, Phoenix, AZ"})
        assert r.json()["destinationFound"] is True
        assert psql("select destination_latitude is not null from drivers where id=4") == "t"
        r = requests.put(f"{BASE}/drivers/4/destination", headers=admin, json={"address": ""})
        assert r.json()["destinationFound"] is None and r.json()["destinationAddress"] is None
        assert psql("select coalesce(destination_latitude::text,'null') from drivers where id=4") == "null"
