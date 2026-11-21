#!/usr/bin/env bash
# Go-live check: run from any computer after each step in RAILWAY_GO_LIVE.md.
#
#   API=https://api.startechsolutions.us \
#   BRIDGE=https://<your-app>.emergent.host \
#   DEMO_EMAIL=play.review@startechsolutions.us DEMO_PASSWORD='...' \
#   bash docs/check-go-live.sh
#
# BRIDGE and the demo login are optional; each check prints PASS / FAIL.
set -u
API=${API:-https://api.startechsolutions.us}
BRIDGE=${BRIDGE:-}
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=1; }
FAILED=0

code=$(curl -s -o /tmp/golive_health.json -w '%{http_code}' "$API/health")
[ "$code" = 200 ] && pass "Railway API is up ($API/health)" || fail "Railway API /health returned $code"

# New code adds the driver live-update channel; old code answers 'Invalid namespace'.
ns=$(curl -s "$API/socket.io/?EIO=4&transport=polling" | head -c 200)
case "$ns" in 0\{*) pass "Live updates answer on $API/socket.io" ;; *) fail "Live updates not reachable: $ns" ;; esac

# 1.1.0 adds the '/driver' live-update channel; older code answers "Invalid namespace".
sock_check() { # $1 = socket.io base URL
  local sid reply
  sid=$(curl -s "$1/?EIO=4&transport=polling" | sed -n 's/.*"sid":"\([^"]*\)".*/\1/p')
  [ -z "$sid" ] && { echo "no handshake"; return; }
  curl -s -X POST "$1/?EIO=4&transport=polling&sid=$sid" -H 'Content-Type: text/plain' -d '40/driver,' >/dev/null
  reply=$(curl -s "$1/?EIO=4&transport=polling&sid=$sid" | head -c 200)
  case "$reply" in *"Invalid namespace"*) echo "old" ;; *"/driver,"*) echo "new" ;; *) echo "unknown: $reply" ;; esac
}
v=$(sock_check "$API/socket.io")
[ "$v" = new ] && pass "Railway runs the 1.1.0 code (driver live channel exists)" || fail "Railway is on older code ($v) — deploy the current backend"

# Login attempt limits exist only in the new code: a wrong password returns 401 (not 500).
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/auth/driver/login" -H 'Content-Type: application/json' -d '{"email":"go-live-check@invalid.example","password":"wrong"}')
[ "$code" = 401 ] && pass "Driver login rejects a bad password (401)" || fail "Driver login with a bad password returned $code"

if [ -n "${DEMO_EMAIL:-}" ] && [ -n "${DEMO_PASSWORD:-}" ]; then
  body=$(curl -s -X POST "$API/api/auth/driver/login" -H 'Content-Type: application/json' -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}")
  token=$(printf '%s' "$body" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
  if [ -n "$token" ]; then
    pass "Reviewer demo account signs in"
    code=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/drivers/my-notes" -H "Authorization: Bearer $token")
    [ "$code" = 200 ] && pass "New endpoints are live (/api/drivers/my-notes)" || fail "/api/drivers/my-notes returned $code — Railway still on old code?"
  else
    fail "Reviewer demo account could not sign in: $body"
  fi
fi

if [ -n "$BRIDGE" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BRIDGE/api/health")
  [ "$code" = 200 ] && pass "Emergent bridge is up ($BRIDGE/api/health)" || fail "Emergent bridge /api/health returned $code"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BRIDGE/api/auth/driver/login" -H 'Content-Type: application/json' -d '{"email":"go-live-check@invalid.example","password":"wrong"}')
  [ "$code" = 401 ] && pass "Bridge forwards to Railway (bad login → 401)" || fail "Bridge login check returned $code"
  ns=$(curl -s "$BRIDGE/api/socket.io/?EIO=4&transport=polling" | head -c 200)
  case "$ns" in 0\{*) pass "Live updates work through the bridge" ;; *) fail "Live updates through the bridge: $ns" ;; esac
  v=$(sock_check "$BRIDGE/api/socket.io")
  [ "$v" = new ] && pass "Driver live channel works through the bridge" || fail "Driver live channel through the bridge: $v"
fi

[ "$FAILED" = 0 ] && echo "All checks passed." || echo "Some checks failed — see FAIL lines above."
exit "$FAILED"
