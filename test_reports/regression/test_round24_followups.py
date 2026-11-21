# Round 24: iteration_23 follow-ups - admin password change signs out, atomic reset token,
# tokenVersion hidden, rate limit counts only failures, XLSX/CSV formula-safe export
import html
import io
import json
import os
import re
import subprocess
import threading
import time
import zipfile

import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_API_URL').rstrip('/')  # .../api
ADMIN = ('admin@fleet.com', 'AdminTest123!')
DISPATCH = ('dispatcher@fleet.com', 'DispatchTest123!')
DRV_PW = 'DriverTest123!'
DRIVERS = ['john@fleet.com', 'maria@fleet.com', 'james@fleet.com', 'sarah@fleet.com', 'michael@fleet.com']
LOG = '/var/log/supervisor/fleet-test-api.out.log'
TMP_PW = 'TEST_TempPw123!'
EVIL = '=HYPERLINK("http://evil.example","x, y")'


def clear_limits():
    subprocess.run(['su', 'postgres', '-c', "psql -d fleet_test -c 'delete from auth_rate_limits'"],
                   capture_output=True, check=False)


def post(path, body, **kw):
    return requests.post(f'{BASE_URL}{path}', json=body, timeout=30, **kw)


def login(path, email, pw):
    r = post(path, {'email': email, 'password': pw})
    assert r.status_code == 200, r.text
    return r.json()


def auth(tok):
    return {'Authorization': 'Bearer ' + tok}


@pytest.fixture(scope='module', autouse=True)
def _limits():
    clear_limits()
    yield
    clear_limits()


@pytest.fixture(scope='module')
def admin_h():
    return auth(login('/auth/login', *ADMIN)['accessToken'])


@pytest.fixture(scope='module')
def ids(admin_h):
    users = requests.get(f'{BASE_URL}/users', headers=admin_h).json()
    users = users.get('users', users) if isinstance(users, dict) else users
    drivers = requests.get(f'{BASE_URL}/drivers', headers=admin_h).json()
    drivers = drivers.get('drivers', drivers) if isinstance(drivers, dict) else drivers
    return {u['email']: u['id'] for u in users} | {d['email']: d['id'] for d in drivers}


# --- Admin sets a new password -> old sessions end
class TestAdminPasswordChangeSignsOut:
    def test_user_password_put_revokes(self, admin_h, ids):
        clear_limits()
        uid = ids[DISPATCH[0]]
        old = login('/auth/login', *DISPATCH)
        assert requests.get(f'{BASE_URL}/auth/me', headers=auth(old['accessToken'])).status_code == 200
        try:
            r = requests.put(f'{BASE_URL}/users/{uid}', json={'password': TMP_PW}, headers=admin_h)
            assert r.status_code == 200, r.text
            assert 'tokenVersion' not in r.json() and 'passwordHash' not in r.json()
            assert requests.get(f'{BASE_URL}/auth/me', headers=auth(old['accessToken'])).status_code == 401
            assert post('/auth/refresh', {'refreshToken': old['refreshToken']}).status_code == 401
            assert post('/auth/login', {'email': DISPATCH[0], 'password': DISPATCH[1]}).status_code == 401
            new = login('/auth/login', DISPATCH[0], TMP_PW)
            assert requests.get(f'{BASE_URL}/auth/me', headers=auth(new['accessToken'])).status_code == 200
        finally:
            r = requests.put(f'{BASE_URL}/users/{uid}', json={'password': DISPATCH[1]}, headers=admin_h)
            assert r.status_code == 200
        assert login('/auth/login', *DISPATCH)

    def test_non_password_update_keeps_session(self, admin_h, ids):
        uid = ids[DISPATCH[0]]
        old = login('/auth/login', *DISPATCH)
        me = requests.get(f'{BASE_URL}/users/{uid}', headers=admin_h).json()
        name = me.get('name')
        r = requests.put(f'{BASE_URL}/users/{uid}', json={'name': name}, headers=admin_h)
        assert r.status_code == 200
        assert requests.get(f'{BASE_URL}/auth/me', headers=auth(old['accessToken'])).status_code == 200

    def test_driver_password_put_revokes(self, admin_h, ids):
        clear_limits()
        email = 'maria@fleet.com'
        did = ids[email]
        old = login('/auth/driver/login', email, DRV_PW)
        assert requests.get(f'{BASE_URL}/auth/me', headers=auth(old['accessToken'])).status_code == 200
        try:
            r = requests.put(f'{BASE_URL}/drivers/{did}', json={'password': TMP_PW}, headers=admin_h)
            assert r.status_code == 200, r.text
            assert 'tokenVersion' not in r.json()
            assert requests.get(f'{BASE_URL}/auth/me', headers=auth(old['accessToken'])).status_code == 401
            assert requests.get(f'{BASE_URL}/drivers/my-vehicle', headers=auth(old['accessToken'])).status_code == 401
            assert post('/auth/refresh', {'refreshToken': old['refreshToken']}).status_code == 401
            new = login('/auth/driver/login', email, TMP_PW)
            assert requests.get(f'{BASE_URL}/auth/me', headers=auth(new['accessToken'])).status_code == 200
        finally:
            r = requests.put(f'{BASE_URL}/drivers/{did}', json={'password': DRV_PW}, headers=admin_h)
            assert r.status_code == 200
        assert login('/auth/driver/login', email, DRV_PW)


# --- Reset token is claimed atomically
def reset_token(email, typ):
    before = len(open(LOG, encoding='utf8', errors='ignore').read())
    r = post('/auth/forgot-password', {'email': email, 'type': typ})
    assert r.status_code == 200
    pat = re.compile(r'Development reset link for ' + re.escape(email) + r': \S*token=([a-f0-9]+)')
    for _ in range(20):
        time.sleep(0.3)
        m = pat.findall(open(LOG, encoding='utf8', errors='ignore').read()[before:])
        if m:
            return m[-1]
    pytest.skip('reset token not found in log')


class TestAtomicReset:
    @pytest.mark.parametrize('email,typ,pw,path', [
        ('james@fleet.com', 'driver', DRV_PW, '/auth/driver/login'),
        (DISPATCH[0], 'user', DISPATCH[1], '/auth/login'),
    ])
    def test_concurrent_reset_one_wins(self, email, typ, pw, path):
        for attempt in range(3):
            clear_limits()
            tok = reset_token(email, typ)
            codes = []
            barrier = threading.Barrier(5)

            def go():
                barrier.wait()
                codes.append(post('/auth/reset-password', {'token': tok, 'password': pw}).status_code)
            ts = [threading.Thread(target=go) for _ in range(5)]
            [t.start() for t in ts]
            [t.join() for t in ts]
            print(email, 'attempt', attempt, sorted(codes))
            assert sorted(codes) == [200, 400, 400, 400, 400], codes
        clear_limits()
        assert login(path, email, pw)


# --- tokenVersion never leaves the API
def find_key(obj, key):
    if isinstance(obj, dict):
        return key in obj or any(find_key(v, key) for v in obj.values())
    if isinstance(obj, list):
        return any(find_key(v, key) for v in obj)
    return False


class TestTokenVersionHidden:
    def test_admin_endpoints(self, admin_h):
        trips = requests.get(f'{BASE_URL}/trips', headers=admin_h).json()
        tl = trips.get('trips', trips) if isinstance(trips, dict) else trips
        paths = ['/drivers', '/drivers/1', '/drivers/4', '/drivers/stops-board', '/drivers/odometer-corrections',
                 '/trips', '/trips/active', '/reports/trips', '/vehicles', '/vehicles/1', '/users', '/auth/me']
        if tl:
            paths.append(f"/trips/{tl[0]['id']}")
        for p in paths:
            r = requests.get(f'{BASE_URL}{p}', headers=admin_h)
            assert r.status_code == 200, p
            body = r.json()
            assert not find_key(body, 'tokenVersion'), p
            assert not find_key(body, 'passwordHash'), p

    def test_driver_endpoints(self):
        d = login('/auth/driver/login', 'michael@fleet.com', DRV_PW)
        assert not find_key(d, 'tokenVersion')
        h = auth(d['accessToken'])
        for p in ['/auth/me', '/trips/my-active', '/trips/my-trips', '/drivers/my-vehicle', '/drivers/my-destination']:
            r = requests.get(f'{BASE_URL}{p}', headers=h)
            assert r.status_code in (200, 404), p
            if r.status_code == 200:
                assert not find_key(r.json(), 'tokenVersion'), p


# --- Rate limit: only failures add up
class TestRateLimitFailuresOnly:
    def test_60_successful_driver_logins_one_ip(self):
        clear_limits()
        codes = [post('/auth/driver/login', {'email': DRIVERS[i % 5], 'password': DRV_PW}).status_code for i in range(60)]
        assert codes.count(200) == 60, codes

    def test_60_successful_user_logins_one_ip(self):
        clear_limits()
        accts = [ADMIN, DISPATCH]
        codes = [post('/auth/login', {'email': accts[i % 2][0], 'password': accts[i % 2][1]}).status_code for i in range(60)]
        assert codes.count(200) == 60, codes

    def test_11_failures_one_email_429(self):
        clear_limits()
        codes = [post('/auth/driver/login', {'email': 'TEST_rl24@example.com', 'password': 'bad'}).status_code for _ in range(11)]
        assert codes[:10] == [401] * 10 and codes[10] == 429, codes

    def test_failures_on_real_account_then_success_still_counts(self):
        clear_limits()
        email = 'john@fleet.com'
        codes = [post('/auth/driver/login', {'email': email, 'password': 'bad'}).status_code for _ in range(10)]
        assert codes == [401] * 10
        r = post('/auth/driver/login', {'email': email, 'password': DRV_PW})
        # 11th try on this IP+email -> blocked even with the right password
        assert r.status_code == 429, r.status_code
        clear_limits()

    def test_51_failures_across_emails_429(self):
        clear_limits()
        codes = [post('/auth/login', {'email': f'test_rl24_{i}@example.com', 'password': 'x'}).status_code for i in range(51)]
        assert codes[:50].count(429) == 0 and codes[50] == 429, codes
        clear_limits()


# --- Exports are formula-safe
@pytest.fixture
def renamed_driver(admin_h):
    orig = requests.get(f'{BASE_URL}/drivers/4', headers=admin_h).json()['name']
    assert requests.put(f'{BASE_URL}/drivers/4', json={'name': EVIL}, headers=admin_h).status_code == 200
    yield admin_h
    assert requests.put(f'{BASE_URL}/drivers/4', json={'name': orig}, headers=admin_h).status_code == 200
    assert requests.get(f'{BASE_URL}/drivers/4', headers=admin_h).json()['name'] == orig


class TestExport:
    def test_xlsx_and_csv(self, renamed_driver):
        r = requests.get(f'{BASE_URL}/reports/export', params={'format': 'xlsx', 'driverId': 4}, headers=renamed_driver)
        assert r.status_code == 200
        z = zipfile.ZipFile(io.BytesIO(r.content))
        sheet = z.read('xl/worksheets/sheet1.xml').decode()
        strings = z.read('xl/sharedStrings.xml').decode() if 'xl/sharedStrings.xml' in z.namelist() else ''
        assert '<f>' not in sheet and '<f ' not in sheet
        blob = html.unescape(sheet + strings)
        assert EVIL in blob
        assert "'" + EVIL not in blob  # no visible apostrophe
        r = requests.get(f'{BASE_URL}/reports/export', params={'format': 'csv', 'driverId': 4}, headers=renamed_driver)
        assert r.status_code == 200
        expected = '"\'' + EVIL.replace('"', '""') + '"'
        assert expected in r.text, r.text[:400]
