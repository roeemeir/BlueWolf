"""HTTP transport around the canonical Python Core worker.

This file lives outside `bluewolf_core` on purpose: networking belongs to the
service/orchestrator layer, never to the algorithm package itself.
"""

from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Mapping

from bluewolf_core.worker import CoreWorker


class Handler(BaseHTTPRequestHandler):
    worker = CoreWorker()

    def _json(self, status: int, payload: Mapping[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            try:
                payload = self.worker.handle({"command": "hello"})
                self._json(HTTPStatus.OK, {"ok": True, **payload})
            except Exception as exc:  # pragma: no cover - transport boundary
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": type(exc).__name__, "message": str(exc)})
            return
        self._json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/rpc":
            self._json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "not found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(size).decode("utf-8"))
            if not isinstance(request, Mapping):
                raise ValueError("request must be a JSON object")
            payload = self.worker.handle(request)
            self._json(HTTPStatus.OK, {"ok": True, "id": request.get("id"), **payload})
        except Exception as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": type(exc).__name__, "message": str(exc)})

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Blue Wolf Python Core HTTP transport")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
