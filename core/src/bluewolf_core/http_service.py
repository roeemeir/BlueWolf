"""Minimal HTTP transport for the canonical Python Core.

The production orchestrator talks to the language-neutral CoreWorker envelope.
This module intentionally uses only the Python standard library so Windows and
OpenShift deployments do not need a web-framework dependency merely to expose
Core RPC.  It does not query Influx or persist checkpoints itself.
"""

from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Mapping

from .worker import CoreWorker


class _Handler(BaseHTTPRequestHandler):
    worker = CoreWorker()

    def _json(self, status: int, payload: Mapping[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path == "/health":
            try:
                payload = self.worker.handle({"command": "hello"})
                self._json(HTTPStatus.OK, {"ok": True, **payload})
            except Exception as exc:  # pragma: no cover - transport boundary
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": type(exc).__name__, "message": str(exc)})
            return
        self._json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path != "/rpc":
            self._json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "not found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(size)
            request = json.loads(raw.decode("utf-8"))
            if not isinstance(request, Mapping):
                raise ValueError("request must be a JSON object")
            request_id = request.get("id")
            payload = self.worker.handle(request)
            self._json(HTTPStatus.OK, {"ok": True, "id": request_id, **payload})
        except Exception as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": type(exc).__name__, "message": str(exc)})

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        # Keep CI/operational logs concise. The supervising service owns access logs.
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Blue Wolf canonical Python Core HTTP transport")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), _Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
