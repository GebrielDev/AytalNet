"""
Emergent deploy bridge for the STS fleet API.

The real API is the Node.js + PostgreSQL server on Railway
(https://api.startechsolutions.us). Emergent's runtime only starts a Python
app (`uvicorn server:app`), so this small server answers the health check and
forwards every /api request - including Socket.IO live updates - to Railway.

Settings (environment):
  FLEET_API_UPSTREAM   Railway API origin (default https://api.startechsolutions.us)
  UPSTREAM_SOCKET_PATH Socket.IO path on Railway (default /socket.io)
  BRIDGE_SHARED_SECRET Same value as on Railway: lets Railway trust the client IP
                       this bridge reports (for login attempt limits)
  BRIDGE_TRUSTED_HOPS  Proxies in front of this bridge that append to
                       X-Forwarded-For (default 1, Emergent's ingress)
"""
import asyncio
import os

import httpx
import websockets
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

UPSTREAM = os.environ.get("FLEET_API_UPSTREAM", "https://api.startechsolutions.us").rstrip("/")
SOCKET_PATH = "/" + os.environ.get("UPSTREAM_SOCKET_PATH", "/socket.io").strip("/")
WS_UPSTREAM = UPSTREAM.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
SHARED_SECRET = os.environ.get("BRIDGE_SHARED_SECRET", "")
TRUSTED_HOPS = max(1, int(os.environ.get("BRIDGE_TRUSTED_HOPS", "1") or 1))

# Headers that belong to one connection only and must not be passed along.
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers",
    "transfer-encoding", "upgrade", "host", "content-length", "content-encoding",
}
# Set by this server itself; Railway's copies would be duplicates.
OWN_RESPONSE_HEADERS = {"date", "server"}
# Never accepted from the outside.
BRIDGE_HEADERS = {"x-bridge-secret", "x-bridge-client-ip"}

app = FastAPI(title="STS fleet API bridge", docs_url=None, redoc_url=None, openapi_url=None)
# Browsers talk to this bridge, not to Railway, so CORS is answered here.
# Sign-in uses a bearer token header (no cookies), so any origin is safe.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], expose_headers=["*"])

client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0), follow_redirects=False)


@app.on_event("shutdown")
async def _close_client() -> None:
    await client.aclose()


@app.get("/health")
@app.get("/api/health")
async def health() -> JSONResponse:
    # Answers on its own so the deploy stays up even if Railway is briefly down.
    return JSONResponse({"status": "ok", "service": "fleet-api-bridge"})


def _target(path: str) -> str:
    if path == "socket.io" or path.startswith("socket.io/"):
        return UPSTREAM + SOCKET_PATH + path[len("socket.io"):]
    return f"{UPSTREAM}/api/{path}"


def client_ip(headers, peer: str) -> str:
    """The caller's IP: the entry Emergent's ingress added to X-Forwarded-For (clients can fake earlier ones)."""
    chain = [p.strip() for p in (headers.get("x-forwarded-for") or "").split(",") if p.strip()]
    return chain[-TRUSTED_HOPS] if len(chain) >= TRUSTED_HOPS else (chain[0] if chain else peer)


def _forward_headers(request: Request) -> dict:
    skip = HOP_BY_HOP | BRIDGE_HEADERS | {"origin", "x-forwarded-for"}
    headers = {k: v for k, v in request.headers.items() if k.lower() not in skip}
    ip = client_ip(request.headers, request.client.host if request.client else "")
    if ip:
        headers["x-forwarded-for"] = ip
    if SHARED_SECRET and ip:
        # Railway counts login attempts per this IP instead of per bridge.
        headers["x-bridge-secret"] = SHARED_SECRET
        headers["x-bridge-client-ip"] = ip
    return headers


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy(path: str, request: Request) -> Response:
    try:
        upstream = await client.request(
            request.method,
            _target(path),
            params=list(request.query_params.multi_items()),
            headers=_forward_headers(request),
            content=await request.body(),
        )
    except httpx.HTTPError:
        return JSONResponse({"error": "The fleet server could not be reached. Please try again."}, status_code=502)
    response = Response(content=upstream.content, status_code=upstream.status_code)
    # multi_items keeps repeated headers (e.g. several Set-Cookie) separate.
    for key, value in upstream.headers.multi_items():
        k = key.lower()
        if k in HOP_BY_HOP or k in OWN_RESPONSE_HEADERS or k.startswith("access-control-"):
            continue
        response.headers.append(key, value)
    return response


@app.websocket("/api/socket.io/")
async def socket_bridge(ws: WebSocket) -> None:
    """Relays Socket.IO's websocket transport to Railway, frame by frame."""
    query = ws.scope.get("query_string", b"").decode()
    url = f"{WS_UPSTREAM}{SOCKET_PATH}/" + (f"?{query}" if query else "")
    ip = client_ip(ws.headers, ws.client.host if ws.client else "")
    extra = {"x-forwarded-for": ip} if ip else {}
    if SHARED_SECRET and ip:
        extra.update({"x-bridge-secret": SHARED_SECRET, "x-bridge-client-ip": ip})
    # Reach Railway BEFORE accepting: if it is down, the handshake fails and
    # socket.io's client keeps retrying (an accepted-then-closed socket makes
    # it give up for good).
    try:
        upstream = await websockets.connect(url, open_timeout=10, max_size=None, additional_headers=extra)
    except (OSError, asyncio.TimeoutError, websockets.exceptions.WebSocketException):
        await ws.close(code=1011)
        return
    await ws.accept()
    close_code = 1000
    try:
        async with upstream:

            async def to_upstream() -> None:
                while True:
                    message = await ws.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    if message.get("text") is not None:
                        await upstream.send(message["text"])
                    elif message.get("bytes") is not None:
                        await upstream.send(message["bytes"])

            async def to_client() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await ws.send_bytes(message)
                    else:
                        await ws.send_text(message)

            tasks = [asyncio.create_task(to_upstream()), asyncio.create_task(to_client())]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            for task in done:
                error = task.exception()
                if isinstance(error, (OSError, websockets.exceptions.WebSocketException)):
                    # Railway dropped mid-session: tell the client it was an error.
                    close_code = 1011
    except WebSocketDisconnect:
        pass
    except (OSError, asyncio.TimeoutError, websockets.exceptions.WebSocketException):
        # Railway unreachable: tell the client so socket.io reconnects.
        close_code = 1011
    finally:
        try:
            await ws.close(code=close_code)
        except RuntimeError:
            pass
