# Round 30: preview proxy hardening — malformed URI 400 w/o crash, missing asset 404, SPA fallback, traversal, prefix matching
import os
import re
import subprocess
import time
import pytest
import requests

BASE = os.environ.get("PREVIEW_URL", "https://162fb2ea-1243-4414-ad3a-72d383847f45.preview.emergentagent.com").rstrip("/")
API = BASE + "/api"
LEAK = ("MONGO_URL", "DATABASE_URL", "root:x:", "JWT_SECRET", "BEGIN PRIVATE")


def _pid():
    out = subprocess.run(["sudo", "supervisorctl", "status", "fleet-preview-proxy"], capture_output=True, text=True).stdout
    m = re.search(r"pid (\d+)", out)
    return m.group(1) if m else out


# Malformed percent-encoding -> 400 and proxy stays up (same pid)
@pytest.mark.parametrize("p", ["/api/dashboard/%FF", "/api/dashboard/%C0%AF", "/api/dashboard/%E0%A4%A", "/api/dashboard/%",
                               "/api/dashboard/assets/%FF.js", "/api/dashboard/%FF?x=1"])
def test_malformed_returns_400_no_crash(p):
    import http.client
    from urllib.parse import urlparse
    before = _pid()
    # raw path: requests would re-quote invalid '%' sequences to '%25'
    conn = http.client.HTTPSConnection(urlparse(BASE).hostname, timeout=30)
    conn.request("GET", p)
    status = conn.getresponse().status
    conn.close()
    time.sleep(1.0)
    after = _pid()
    assert status == 400, f"{p} -> {status}"
    assert before == after, f"proxy restarted {before} -> {after}"


def test_burst_malformed_then_healthy():
    before = _pid()
    for _ in range(10):
        requests.get(BASE + "/api/dashboard/%FF", timeout=30)
    time.sleep(1.0)
    assert _pid() == before
    assert requests.get(f"{API}/dashboard/", timeout=30).status_code == 200


# Missing build files -> 404 (not index.html)
@pytest.mark.parametrize("ext", ["js", "css", "map", "png", "svg", "ico", "json"])
def test_missing_asset_404(ext):
    r = requests.get(f"{API}/dashboard/assets/missing.{ext}", timeout=30)
    assert r.status_code == 404 and "<div id=\"root\"" not in r.text


# SPA deep links still served index.html
@pytest.mark.parametrize("p", ["/api/dashboard/stops", "/api/dashboard/drivers/3", "/api/dashboard", "/api/dashboard?x=1", "/api/dashboard/assets"])
def test_spa_fallback(p):
    r = requests.get(BASE + p, timeout=30)
    assert r.status_code == 200 and "<div id=\"root\"" in r.text and "text/html" in r.headers["content-type"]


# Real assets (all js/css referenced from index.html) load with right type
def test_real_assets():
    html = requests.get(f"{API}/dashboard/", timeout=30).text
    refs = re.findall(r'(?:src|href)="([^"]+\.(?:js|css))"', html)
    assert refs
    for ref in refs:
        url = BASE + ref if ref.startswith("/") else f"{API}/dashboard/{ref}"
        r = requests.get(url, timeout=30)
        assert r.status_code == 200, ref
        assert ("javascript" if ref.endswith(".js") else "text/css") in r.headers["content-type"], ref


# Traversal variants still blocked
@pytest.mark.parametrize("p", ["/api/dashboard/%2e%2e/%2e%2e/backend/.env", "/api/dashboard/..%2f..%2fbackend%2f.env",
                               "/api/dashboard/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd", "/api/dashboard/..%5c..%5cbackend%5c.env",
                               "/api/dashboard/%2e%2e/dist-evil/x.js", "/api/dashboard/%2e%2e%2fweb-dashboard%2fpackage.json",
                               "/api/dashboard/%00", "/api/dashboard/index.html%00.js"])
def test_traversal_blocked(p):
    r = requests.get(BASE + p, timeout=30)
    assert r.status_code in (200, 400, 404)
    assert not any(k in r.text for k in LEAK)
    assert '"devDependencies"' not in r.text


# /api/dashboardfoo is NOT dashboard -> goes to API
def test_dashboardfoo_not_dashboard():
    r = requests.get(f"{API}/dashboardfoo", timeout=30)
    assert "<div id=\"root\"" not in r.text and r.status_code in (401, 404)


# Regular API proxying still works
def test_api_still_proxied():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@fleet.com", "password": "AdminTest123!"}, timeout=30)
    assert r.status_code == 200 and r.json().get("accessToken")
