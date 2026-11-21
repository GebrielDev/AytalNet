# Round 24 probe: concurrent successful logins (depot burst) and interleaved success+spray behaviour
import os, subprocess
from concurrent.futures import ThreadPoolExecutor
import requests

BASE = os.environ['EXPO_PUBLIC_API_URL'].rstrip('/')
DRIVERS = ['john@fleet.com', 'maria@fleet.com', 'james@fleet.com', 'sarah@fleet.com', 'michael@fleet.com']
PW = 'DriverTest123!'


def clear():
    subprocess.run(['su', 'postgres', '-c', "psql -d fleet_test -c 'delete from auth_rate_limits'"], capture_output=True)


def p(path, body):
    try:
        return requests.post(BASE + path, json=body, timeout=40).status_code
    except Exception as e:
        return 'ERR'


clear()
with ThreadPoolExecutor(20) as ex:
    codes = list(ex.map(lambda i: p('/auth/driver/login', {'email': DRIVERS[i % 5], 'password': PW}), range(60)))
print('concurrent 60 successful (20 parallel):', {c: codes.count(c) for c in set(codes)})

clear()
codes = []
for i in range(60):
    codes.append(p('/auth/login', {'email': f'test_rl24spray_{i}@example.com', 'password': 'x'}))
    p('/auth/login', {'email': 'dispatcher@fleet.com', 'password': 'DispatchTest123!'})
print('60 spray failures interleaved with successes:', {c: codes.count(c) for c in set(codes)})
clear()
