# Round 26: bridge client-IP forwarding (x-bridge-secret / x-bridge-client-ip), per-IP login limits,
# repeated Set-Cookie, single date/server header, websocket 1011 on dead upstream. Run with
#   BRIDGE_URL=http://127.0.0.1:8019 (secret, -> 8002)  ECHO_BRIDGE_URL=http://127.0.0.1:8021 (secret, -> echo 8022)
#   NOSECRET_BRIDGE_URL=http://127.0.0.1:8023 (-> 8002)  NOSECRET_ECHO_URL=http://127.0.0.1:8024 (-> echo 8022)
#   DOWN_BRIDGE_URL=http://127.0.0.1:8031 (-> :9)  UPSTREAM_URL=http://127.0.0.1:8002
import http.client
import os
import subprocess
import uuid
from urllib.parse import urlparse

import pytest
import requests
from websockets.sync.client import connect as ws_connect

BRIDGE = os.environ["BRIDGE_URL"].rstrip("/")
ECHO = os.environ["ECHO_BRIDGE_URL"].rstrip("/")
NS_BRIDGE = os.environ["NOSECRET_BRIDGE_URL"].rstrip("/")
NS_ECHO = os.environ["NOSECRET_ECHO_URL"].rstrip("/")
DOWN = os.environ["DOWN_BRIDGE_URL"].rstrip("/")
UP = os.environ["UPSTREAM_URL"].rstrip("/")
SECRET = [l.split("=", 1)[1].strip() for l in open("/app/backend/.env") if l.startswith("BRIDGE_SHARED_SECRET=")][0]
EMAIL, PW = "james@fleet.com", "DriverTest123!"


def clear():
    subprocess.run(["su", "postgres", "-c", "psql -d fleet_test -c 'delete from auth_rate_limits'"], capture_output=True)


@pytest.fixture(autouse=True)
def _clear_limits():
    clear()
    yield
    clear()


def login(base, headers, pw=PW, email=EMAIL):
    return requests.post(f"{base}/api/auth/driver/login", json={"email": email, "password": pw}, headers=headers, timeout=20)


def fail_n(base, headers_fn, n=11):
    return [login(base, headers_fn(i), pw="wrong-" + str(i)).status_code for i in range(n)]


# Bridge header rewriting seen by the upstream (echo)
class TestForwardedHeaders:
    def test_secret_bridge_sets_trusted_headers_and_strips_spoofed(self):
        r = requests.get(f"{ECHO}/api/x", headers={"x-forwarded-for": "1.1.1.1, 9.9.9.9", "x-bridge-secret": "spoof",
                                                   "x-bridge-client-ip": "6.6.6.6"}, timeout=10)
        h = r.json()["headers"]
        assert h["x-forwarded-for"] == "9.9.9.9"
        assert h["x-bridge-client-ip"] == "9.9.9.9"
        assert h["x-bridge-secret"] == SECRET

    def test_secret_bridge_no_xff_uses_peer(self):
        h = requests.get(f"{ECHO}/api/x", timeout=10).json()["headers"]
        assert h["x-forwarded-for"] == "127.0.0.1" and h["x-bridge-client-ip"] == "127.0.0.1"

    def test_nosecret_bridge_strips_bridge_headers(self):
        h = requests.get(f"{NS_ECHO}/api/x", headers={"x-forwarded-for": "1.1.1.1, 8.8.4.4", "x-bridge-secret": SECRET,
                                                      "x-bridge-client-ip": "6.6.6.6"}, timeout=10).json()["headers"]
        assert "x-bridge-secret" not in h and "x-bridge-client-ip" not in h
        assert h["x-forwarded-for"] == "8.8.4.4"


# Response headers: repeated Set-Cookie kept, single date/server
class TestResponseHeaders:
    def test_set_cookie_and_single_date_server(self):
        u = urlparse(ECHO)
        c = http.client.HTTPConnection(u.hostname, u.port, timeout=10)
        c.request("GET", "/api/cookie")
        resp = c.getresponse(); resp.read()
        hs = resp.getheaders()
        cookies = [v for k, v in hs if k.lower() == "set-cookie"]
        assert sorted(cookies) == ["a=1; Path=/", "b=2; Path=/"], hs
        assert sum(1 for k, _ in hs if k.lower() == "date") == 1, hs
        assert sum(1 for k, _ in hs if k.lower() == "server") == 1, hs
        assert any(k.lower() == "x-upstream-custom" for k, _ in hs)


# Per-client-IP login limits through the bridge (with secret)
class TestRateLimitPerIp:
    def test_ip_a_locked_ip_b_still_logs_in(self):
        codes = fail_n(BRIDGE, lambda i: {"x-forwarded-for": "10.26.0.1"})
        assert codes[:10] == [401] * 10 and codes[10] == 429, codes
        assert login(BRIDGE, {"x-forwarded-for": "10.26.0.1"}).status_code == 429
        r = login(BRIDGE, {"x-forwarded-for": "10.26.0.2"})
        assert r.status_code == 200 and r.json().get("accessToken")

    def test_xff_last_entry_used(self):
        # Client-prepended entries vary; the ingress-added last entry is constant -> same bucket
        codes = fail_n(BRIDGE, lambda i: {"x-forwarded-for": f"7.7.{i}.1, 10.26.0.3"})
        assert codes[10] == 429, codes

    def test_spoofed_bridge_headers_ignored(self):
        codes = fail_n(BRIDGE, lambda i: {"x-forwarded-for": "10.26.0.4", "x-bridge-secret": "bogus",
                                          "x-bridge-client-ip": f"5.5.5.{i}"})
        assert codes[10] == 429, codes


# Direct calls to Node: wrong secret ignores x-bridge-client-ip, right secret honours it
class TestNodeDirect:
    def test_wrong_secret_ignores_client_ip(self):
        codes = fail_n(UP, lambda i: {"x-bridge-secret": "wrong", "x-bridge-client-ip": f"4.4.4.{i}"})
        assert codes[10] == 429, codes

    def test_right_secret_honours_client_ip(self):
        codes = fail_n(UP, lambda i: {"x-bridge-secret": SECRET, "x-bridge-client-ip": f"4.4.5.{i}"})
        assert 429 not in codes, codes


# Bridge without BRIDGE_SHARED_SECRET: falls back to plain X-Forwarded-For (trust proxy 1)
class TestNoSecretFallback:
    def test_fallback_per_xff_ip(self):
        codes = fail_n(NS_BRIDGE, lambda i: {"x-forwarded-for": "10.26.1.1"})
        assert codes[10] == 429, codes
        assert login(NS_BRIDGE, {"x-forwarded-for": "10.26.1.2"}).status_code == 200

    def test_fallback_varied_ips_not_shared(self):
        codes = fail_n(NS_BRIDGE, lambda i: {"x-forwarded-for": f"10.26.2.{i}"})
        assert 429 not in codes, codes


# Websocket with upstream down -> handshake refused (round 27: bridge connects upstream before accept)
class TestWsDown:
    def test_ws_down_handshake_refused(self):
        from websockets.exceptions import InvalidStatus
        url = DOWN.replace("http://", "ws://") + "/api/socket.io/?EIO=4&transport=websocket"
        with pytest.raises(InvalidStatus) as exc:
            ws_connect(url, open_timeout=15)
        assert exc.value.response.status_code == 403
