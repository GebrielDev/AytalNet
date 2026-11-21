# Round 23: security fixes - tampered tokens, auth rate limits, safe report exports, auth regression
import base64
import hashlib
import hmac
import io
import json
import os
import re
import subprocess
import time
import zipfile

import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_API_URL').rstrip('/')  # .../api
ADMIN = ('admin@fleet.com', 'AdminTest123!')
DISPATCH = ('dispatcher@fleet.com', 'DispatchTest123!')
DRIVER = ('john@fleet.com', 'DriverTest123!')


def clear_limits():
    subprocess.run(['su', 'postgres', '-c', "psql -d fleet_test -c 'delete from auth_rate_limits'"],
                   capture_output=True, check=False)


def login(path, creds):
    r = requests.post(f'{BASE_URL}{path}', json={'email': creds[0], 'password': creds[1]}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def b64(d):
    return base64.urlsafe_b64encode(d).rstrip(b'=').decode()


def dec(s):
    return json.loads(base64.urlsafe_b64decode(s + '=' * (-len(s) % 4)))


def secret(name):
    for line in open('/app/backend/.env'):
        if line.startswith(name + '='):
            return line.split('=', 1)[1].strip()
    raise RuntimeError(name)


def sign(header, payload, key, digest=hashlib.sha256):
    h, p = b64(json.dumps(header).encode()), b64(json.dumps(payload).encode())
    sig = hmac.new(key.encode(), f'{h}.{p}'.encode(), digest).digest()
    return f'{h}.{p}.{b64(sig)}'


@pytest.fixture(scope='module', autouse=True)
def _limits():
    clear_limits()
    yield
    clear_limits()


@pytest.fixture(scope='module')
def admin():
    return login('/auth/login', ADMIN)


# --- Token tampering / algorithm checks ---
class TestTokenTamper:
    def test_valid_token_ok(self, admin):
        r = requests.get(f'{BASE_URL}/auth/me', headers={'Authorization': 'Bearer ' + admin['accessToken']})
        assert r.status_code == 200 and r.json()['user']['email'] == ADMIN[0]

    def test_alg_none_rejected(self, admin):
        p = dec(admin['accessToken'].split('.')[1])
        tok = f"{b64(json.dumps({'alg': 'none', 'typ': 'JWT'}).encode())}.{b64(json.dumps(p).encode())}."
        r = requests.get(f'{BASE_URL}/auth/me', headers={'Authorization': 'Bearer ' + tok})
        assert r.status_code == 401

    def test_hs512_same_secret_rejected(self, admin):
        p = dec(admin['accessToken'].split('.')[1])
        tok = sign({'alg': 'HS512', 'typ': 'JWT'}, p, secret('JWT_SECRET'), hashlib.sha512)
        r = requests.get(f'{BASE_URL}/auth/me', headers={'Authorization': 'Bearer ' + tok})
        assert r.status_code == 401

    def test_tampered_payload_rejected(self, admin):
        h, p, s = admin['accessToken'].split('.')
        pl = dec(p); pl['id'] = pl['id'] + 1
        tok = f"{h}.{b64(json.dumps(pl).encode())}.{s}"
        r = requests.get(f'{BASE_URL}/auth/me', headers={'Authorization': 'Bearer ' + tok})
        assert r.status_code == 401

    def test_wrong_version_rejected(self, admin):
        pl = dec(admin['accessToken'].split('.')[1]); pl['ver'] = pl.get('ver', 0) + 99
        tok = sign({'alg': 'HS256', 'typ': 'JWT'}, pl, secret('JWT_SECRET'))
        r = requests.get(f'{BASE_URL}/auth/me', headers={'Authorization': 'Bearer ' + tok})
        assert r.status_code == 401

    def test_refresh_token_not_usable_as_access(self, admin):
        r = requests.get(f'{BASE_URL}/auth/me', headers={'Authorization': 'Bearer ' + admin['refreshToken']})
        assert r.status_code == 401

    def test_access_token_not_usable_as_refresh(self, admin):
        r = requests.post(f'{BASE_URL}/auth/refresh', json={'refreshToken': admin['accessToken']})
        assert r.status_code == 401

    def test_refresh_tampered_alg_rejected(self, admin):
        p = dec(admin['refreshToken'].split('.')[1])
        tok = sign({'alg': 'HS384', 'typ': 'JWT'}, p, secret('JWT_REFRESH_SECRET'), hashlib.sha384)
        r = requests.post(f'{BASE_URL}/auth/refresh', json={'refreshToken': tok})
        assert r.status_code == 401


# --- Rate limits: 10 per IP+email, 50 per IP ---
RL = [
    ('/auth/login', lambda i: {'email': 'test_rl_login@example.com', 'password': f'wrong{i}'}),
    ('/auth/driver/login', lambda i: {'email': 'test_rl_driver@example.com', 'password': f'wrong{i}'}),
    ('/auth/forgot-password', lambda i: {'email': 'test_rl_forgot@example.com'}),
    ('/auth/reset-password', lambda i: {'token': 'test_rl_badtoken', 'password': 'whatever123'}),
]


class TestRateLimits:
    @pytest.mark.parametrize('path,body', RL)
    def test_per_account_limit(self, path, body):
        clear_limits()
        codes = [requests.post(f'{BASE_URL}{path}', json=body(i), timeout=20).status_code for i in range(10)]
        assert 429 not in codes, codes
        r = requests.post(f'{BASE_URL}{path}', json=body(11), timeout=20)
        assert r.status_code == 429, (path, codes, r.status_code)
        ra = r.headers.get('Retry-After')
        assert ra and 0 < int(ra) <= 900
        assert 'Too many attempts' in r.json()['error']
        # spoofed X-Forwarded-For must not reset the counter
        r2 = requests.post(f'{BASE_URL}{path}', json=body(12), headers={'X-Forwarded-For': '9.9.9.9'}, timeout=20)
        assert r2.status_code == 429, f'XFF spoof bypassed limit on {path}: {r2.status_code}'
        clear_limits()

    def test_limit_does_not_block_other_account_and_email_case(self):
        clear_limits()
        for i in range(11):
            requests.post(f'{BASE_URL}/auth/login', json={'email': 'TEST_RL_Case@example.com', 'password': 'x'})
        r = requests.post(f'{BASE_URL}/auth/login', json={'email': 'test_rl_case@example.com', 'password': 'x'})
        assert r.status_code == 429  # same account, different case
        r = requests.post(f'{BASE_URL}/auth/login', json={'email': ADMIN[0], 'password': ADMIN[1]})
        assert r.status_code == 200  # other account fine
        clear_limits()

    def test_per_ip_limit_across_emails(self):
        clear_limits()
        codes = []
        for i in range(51):
            codes.append(requests.post(f'{BASE_URL}/auth/login', json={'email': f'test_rl_ip{i}@example.com', 'password': 'x'}, timeout=20).status_code)
        assert 429 not in codes[:50], codes
        assert codes[50] == 429, codes[45:]
        r = requests.post(f'{BASE_URL}/auth/login', json={'email': ADMIN[0], 'password': ADMIN[1]})
        assert r.status_code == 429 and r.headers.get('Retry-After')
        # driver login is a separate bucket
        r = requests.post(f'{BASE_URL}/auth/driver/login', json={'email': DRIVER[0], 'password': DRIVER[1]})
        assert r.status_code == 200
        clear_limits()

    def test_normal_login_under_limit(self):
        clear_limits()
        for _ in range(3):
            requests.post(f'{BASE_URL}/auth/login', json={'email': ADMIN[0], 'password': 'wrong'})
        assert requests.post(f'{BASE_URL}/auth/login', json={'email': ADMIN[0], 'password': ADMIN[1]}).status_code == 200
        clear_limits()


# --- Report export formula safety ---
EVIL = '=HYPERLINK("http://evil.example","x, y")'


@pytest.fixture(scope='class')
def renamed_driver(admin):
    h = {'Authorization': 'Bearer ' + admin['accessToken']}
    orig = requests.get(f'{BASE_URL}/drivers/4', headers=h).json()
    orig_name = orig.get('name') or orig.get('driver', {}).get('name')
    assert orig_name == 'Sarah Johnson', orig
    r = requests.put(f'{BASE_URL}/drivers/4', json={'name': EVIL}, headers=h)
    assert r.status_code == 200, r.text
    yield h
    r = requests.put(f'{BASE_URL}/drivers/4', json={'name': orig_name}, headers=h)
    assert r.status_code == 200


class TestExport:
    def test_csv_formula_escaped_and_quoted(self, renamed_driver):
        r = requests.get(f'{BASE_URL}/reports/export', params={'format': 'csv', 'driverId': 4}, headers=renamed_driver)
        assert r.status_code == 200 and 'text/csv' in r.headers['Content-Type']
        lines = r.text.split('\n')
        assert lines[0].startswith('Trip ID,Driver,Employee ID')
        expected = '"\'' + EVIL.replace('"', '""') + '"'
        assert len(lines) >= 2
        for ln in lines[1:]:
            assert expected in ln, ln
            assert ',=' not in ln and ',"=' not in ln

    def test_xlsx_formula_escaped(self, renamed_driver):
        r = requests.get(f'{BASE_URL}/reports/export', params={'format': 'xlsx', 'driverId': 4}, headers=renamed_driver)
        assert r.status_code == 200
        z = zipfile.ZipFile(io.BytesIO(r.content))
        sheet = z.read('xl/worksheets/sheet1.xml').decode()
        strings = z.read('xl/sharedStrings.xml').decode() if 'xl/sharedStrings.xml' in z.namelist() else ''
        assert '<f>' not in sheet  # no formula cells
        import html
        blob = html.unescape(sheet + strings)
        # XLSX stores the name as a plain text cell (no formula, no visible apostrophe).
        assert EVIL in blob

    def test_dispatcher_can_export_driver_forbidden(self):
        d = login('/auth/login', DISPATCH)
        assert requests.get(f'{BASE_URL}/reports/export', params={'format': 'csv'}, headers={'Authorization': 'Bearer ' + d['accessToken']}).status_code == 200
        dr = login('/auth/driver/login', DRIVER)
        assert requests.get(f'{BASE_URL}/reports/export', params={'format': 'csv'}, headers={'Authorization': 'Bearer ' + dr['accessToken']}).status_code == 403


# --- Auth regression ---
class TestAuthRegression:
    def test_refresh_rotates_and_works(self, admin):
        r = requests.post(f'{BASE_URL}/auth/refresh', json={'refreshToken': admin['refreshToken']})
        assert r.status_code == 200
        new = r.json()
        assert requests.get(f'{BASE_URL}/auth/me', headers={'Authorization': 'Bearer ' + new['accessToken']}).status_code == 200

    def test_main_endpoints(self, admin):
        h = {'Authorization': 'Bearer ' + admin['accessToken']}
        for p in ['/drivers', '/vehicles', '/trips', '/reports/summary', '/drivers/stops-board', '/users']:
            assert requests.get(f'{BASE_URL}{p}', headers=h).status_code == 200, p
