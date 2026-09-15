"""ASGI wrapper adding truth-backed QA execution to the operational runtime."""
from __future__ import annotations

import asyncio
import hmac
import json
import os
from typing import Any, Mapping

from . import service
from .qa_runner import run_deterministic_qa

_MAX_BODY_BYTES = 64 * 1024


def _json_bytes(payload: Mapping[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class QaEnabledASGI:
    """Handle ``POST /v1/qa/run`` and delegate every other path unchanged."""

    def __init__(self, base_app, *, token: str | None = None) -> None:
        self.base_app = base_app
        self.token = token.strip() if token else None

    def _authorized(self, headers: Mapping[bytes, bytes]) -> bool:
        if self.token is None:
            return True
        raw = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")
        return hmac.compare_digest(raw, f"Bearer {self.token}")

    @staticmethod
    async def _send_json(send, status: int, payload: Mapping[str, Any]) -> None:
        body = _json_bytes(payload)
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json; charset=utf-8"),
                    (b"cache-control", b"no-store"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"x-bluewolf-qa", b"python-core"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    @staticmethod
    async def _read_json(receive) -> dict[str, Any]:
        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message.get("type") != "http.request":
                continue
            chunk = bytes(message.get("body", b""))
            size += len(chunk)
            if size > _MAX_BODY_BYTES:
                raise ValueError("QA request body is too large")
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        if not chunks or not b"".join(chunks).strip():
            return {}
        parsed = json.loads(b"".join(chunks).decode("utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("QA request must be a JSON object")
        return parsed

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http" or scope.get("path") != "/v1/qa/run":
            await self.base_app(scope, receive, send)
            return
        method = str(scope.get("method", "GET")).upper()
        if method != "POST":
            await self._send_json(send, 405, {"error": "method not allowed"})
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        if not self._authorized(headers):
            await self._send_json(send, 401, {"error": "unauthorized"})
            return
        try:
            request = await self._read_json(receive)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            await self._send_json(send, 400, {"error": str(error)})
            return
        try:
            result = await asyncio.to_thread(run_deterministic_qa, request)
        except Exception as error:  # QA execution must fail closed, never synthesize a pass.
            await self._send_json(
                send,
                500,
                {"status": "error", "error": f"QA execution failed: {type(error).__name__}: {error}"},
            )
            return
        await self._send_json(send, 200, result)


app = QaEnabledASGI(
    service.app,
    token=os.environ.get("BLUEWOLF_CORE_API_TOKEN"),
)


def main() -> None:
    """Run the operational loop with live runtime and QA endpoints in one process."""

    try:
        import uvicorn
    except ImportError as exc:  # pragma: no cover - deployment-only guard.
        raise SystemExit("Install the runtime service extra: pip install -e '.[service]'") from exc

    from .runtime_host import host_from_environment

    host = os.environ.get("BLUEWOLF_RUNTIME_HOST", "0.0.0.0")
    port = int(os.environ.get("BLUEWOLF_RUNTIME_PORT", "8080"))
    service.operational_host = host_from_environment(service.runtime_store)
    if service.operational_host is not None:
        service.operational_host.start()
    try:
        uvicorn.run(app, host=host, port=port, workers=1)
    finally:
        if service.operational_host is not None:
            service.operational_host.stop()
        service.operational_host = None


__all__ = ["QaEnabledASGI", "app", "main"]
