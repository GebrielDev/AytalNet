# Round 25: tiny echo "upstream" so the bridge's forwarding (path, repeated query params, headers, raw body) can be checked byte for byte
import hashlib
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Echo(BaseHTTPRequestHandler):
    def _handle(self):
        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n) if n else b""
        out = json.dumps({
            "method": self.command,
            "path": self.path,
            "headers": {k.lower(): v for k, v in self.headers.items()},
            "body_len": len(body),
            "body_sha256": hashlib.sha256(body).hexdigest(),
        }).encode()
        status = int(self.headers.get("x-echo-status") or 200)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.send_header("X-Upstream-Custom", "kept")
        self.send_header("Set-Cookie", "a=1; Path=/")
        self.send_header("Set-Cookie", "b=2; Path=/")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(out)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = _handle

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Echo).serve_forever()
