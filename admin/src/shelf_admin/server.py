import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from shelf_admin import yamlio
from shelf_admin.model import load_yaml, validate, write_site

WEB = Path(__file__).parent / "web"
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}
HOSTS = {"localhost", "127.0.0.1", "[::1]"}


def make_server(port: int, data_path: Path, bgg_path: Path, site: Path, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    lock = threading.Lock()

    def snapshot() -> dict:
        return {"data": load_yaml(data_path), "version": yamlio.version(data_path)}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, code: int, body, ctype: str = "application/json"):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def guard(self) -> bool:
            if self.headers.get("Host", "").rsplit(":", 1)[0] not in HOSTS:
                self.send(403, {"error": "admin only answers on localhost"})
                return False
            return True

        def payload(self):
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                self.send(415, {"error": "expected application/json"})
                return None
            try:
                return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            except ValueError:
                self.send(400, {"error": "invalid JSON"})
                return None

        def do_GET(self):
            if not self.guard():
                return
            path = urlsplit(self.path).path
            if path == "/api/collection":
                return self.send(200, snapshot())
            root, rel = (site, path[len("/site/"):]) if path.startswith("/site/") else (WEB, path.lstrip("/") or "admin.html")
            f = (root / rel).resolve()
            if not f.is_file() or not f.is_relative_to(root.resolve()):
                return self.send(404, {"error": "not found"})
            self.send(200, f.read_bytes(), TYPES.get(f.suffix, "application/octet-stream"))

        def do_POST(self):
            if not self.guard():
                return
            if urlsplit(self.path).path != "/api/validate":
                return self.send(404, {"error": "not found"})
            body = self.payload()
            if body is not None:
                errors, warnings = validate(body.get("data") or {})
                self.send(200, {"errors": errors, "warnings": warnings})

        def do_PUT(self):
            if not self.guard():
                return
            if urlsplit(self.path).path != "/api/collection":
                return self.send(404, {"error": "not found"})
            body = self.payload()
            if body is None:
                return
            data = body.get("data") or {}
            with lock:
                if body.get("version") != yamlio.version(data_path):
                    return self.send(409, {"error": "collection.yaml changed on disk"} | snapshot())
                errors, warnings = validate(data)
                if errors:
                    return self.send(422, {"errors": errors, "warnings": warnings})
                yamlio.save(data_path, data)
                write_site(load_yaml(data_path), bgg_path, site / "collection.json")
                self.send(200, snapshot() | {"warnings": warnings})

    return ThreadingHTTPServer((host, port), Handler)
