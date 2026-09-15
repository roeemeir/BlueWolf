"""ASGI wrapper adding truth-backed QA and investigation execution.

The wrapper delegates live-runtime paths unchanged. QA executes the real Core
self-test. Investigation reads immutable SO event observations and lifecycle
evidence captured by the Core; no demo fallback is allowed.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
import hmac
import json
import os
from typing import Any, Mapping
from urllib.parse import parse_qs

from bluewolf_core.event_recompute import recompute_so_event

from . import service
from .event_archive_binding import attach_event_archives, operational_config_fingerprint
from .event_lifecycle_archive import SOEventLifecycleArchive
from .event_observation_archive import SOEventObservationArchive
from .qa_runner import run_deterministic_qa

_MAX_BODY_BYTES = 64 * 1024

event_archive: SOEventObservationArchive | None = None
event_lifecycle_archive: SOEventLifecycleArchive | None = None


def _json_bytes(payload: Mapping[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _code_version() -> str | None:
    value = os.environ.get("BLUEWOLF_CODE_SHA", "").strip() or os.environ.get("GITHUB_SHA", "").strip()
    return value or None


def _config_version() -> str | None:
    host = service.operational_host
    if host is not None:
        value = getattr(host.loop, "config_fingerprint", None)
        if isinstance(value, str) and value:
            return value
    config_path = os.environ.get("BLUEWOLF_OPERATIONAL_CONFIG", "").strip()
    if not config_path:
        return None
    return operational_config_fingerprint(config_path)


def _pipeline_for_server(server_id: int):
    host = service.operational_host
    if host is None:
        return None
    for pipeline in host.loop.pipelines:
        if pipeline.server_id == server_id:
            return pipeline
    return None


def _resolved_lifecycle_archive(archive: SOEventObservationArchive | None) -> SOEventLifecycleArchive | None:
    """Return lifecycle storage for the same SQLite file as observation evidence.

    Existing tests/integration hooks historically injected only ``event_archive``.
    The fallback keeps those callers compatible while still using the exact same
    durable SQLite path; production normally supplies both archives explicitly.
    """

    if event_lifecycle_archive is not None:
        return event_lifecycle_archive
    if archive is None:
        return None
    return SOEventLifecycleArchive(archive.path)


def _optional_query_time(query: Mapping[str, list[str]], name: str) -> datetime | None:
    values = query.get(name, [])
    if not values:
        return None
    if len(values) != 1 or not values[0].strip():
        raise ValueError(f"{name} must appear once as an ISO-8601 timestamp")
    try:
        parsed = datetime.fromisoformat(values[0].strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{name} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{name} must include a timezone")
    return parsed.astimezone(UTC)


class QaEnabledASGI:
    """Handle QA/investigation endpoints and delegate every other path unchanged."""

    def __init__(self, base_app, *, token: str | None = None) -> None:
        self.base_app = base_app
        self.token = token.strip() if token else None

    def _authorized(self, headers: Mapping[bytes, bytes]) -> bool:
        if self.token is None:
            return True
        raw = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")
        return hmac.compare_digest(raw, f"Bearer {self.token}")

    @staticmethod
    async def _send_json(send, status: int, payload: Mapping[str, Any], *, surface: bytes = b"python-core") -> None:
        body = _json_bytes(payload)
        await send({
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"cache-control", b"no-store"),
                (b"content-length", str(len(body)).encode("ascii")),
                (b"x-bluewolf-source", surface),
            ],
        })
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
                raise ValueError("request body is too large")
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        if not chunks or not b"".join(chunks).strip():
            return {}
        parsed = json.loads(b"".join(chunks).decode("utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("request must be a JSON object")
        return parsed

    @staticmethod
    def _query(scope) -> dict[str, list[str]]:
        return parse_qs(bytes(scope.get("query_string", b"")).decode("utf-8", errors="strict"), keep_blank_values=True)

    async def _handle_qa(self, scope, receive, send) -> None:
        method = str(scope.get("method", "GET")).upper()
        if method != "POST":
            await self._send_json(send, 405, {"error": "method not allowed"})
            return
        try:
            request = await self._read_json(receive)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            await self._send_json(send, 400, {"error": str(error)})
            return
        try:
            result = await asyncio.to_thread(run_deterministic_qa, request)
        except Exception as error:
            await self._send_json(send, 500, {"status": "error", "error": f"QA execution failed: {type(error).__name__}: {error}"})
            return
        await self._send_json(send, 200, result)

    async def _handle_events(self, scope, send) -> None:
        if str(scope.get("method", "GET")).upper() != "GET":
            await self._send_json(send, 405, {"error": "method not allowed"})
            return
        archive = event_archive
        lifecycle_archive = _resolved_lifecycle_archive(archive)
        if archive is None or lifecycle_archive is None:
            await self._send_json(send, 503, {"status": "unavailable", "error": "SO event evidence archive is not configured"}, surface=b"core-event-archive")
            return
        try:
            query = self._query(scope)
            raw_server = query.get("serverId", [])
            if len(raw_server) != 1:
                raise ValueError("one serverId is required")
            server_id = int(raw_server[0])
            if server_id < 0:
                raise ValueError("serverId must be a non-negative integer")
            from_utc = _optional_query_time(query, "from")
            to_utc = _optional_query_time(query, "to")
            if from_utc is not None and to_utc is not None and from_utc > to_utc:
                raise ValueError("from must not be after to")
        except (UnicodeDecodeError, ValueError) as error:
            await self._send_json(send, 400, {"error": str(error)})
            return
        try:
            events = await asyncio.to_thread(archive.list_events, server_id, from_utc=from_utc, to_utc=to_utc)
            enriched_events = []
            for event in events:
                enriched_events.append({**event, "lifecycle": await asyncio.to_thread(lifecycle_archive.event_lifecycle, str(event["eventId"]))})
        except ValueError as error:
            await self._send_json(send, 400, {"error": str(error)})
            return
        pipeline = _pipeline_for_server(server_id)
        templates = []
        if pipeline is not None:
            templates = [{"id": entry.template.template_id, "name": entry.template.name} for entry in pipeline.producer.runtime.bank.entries]
        await self._send_json(
            send,
            200,
            {"schemaVersion": "bluewolf.investigation-events.v1", "serverId": server_id, "templates": templates, "events": enriched_events},
            surface=b"core-event-archive",
        )

    async def _handle_recompute(self, scope, receive, send) -> None:
        if str(scope.get("method", "GET")).upper() != "POST":
            await self._send_json(send, 405, {"error": "method not allowed"})
            return
        archive = event_archive
        lifecycle_archive = _resolved_lifecycle_archive(archive)
        if archive is None or lifecycle_archive is None:
            await self._send_json(send, 503, {"status": "unavailable", "error": "SO event evidence archive is not configured"}, surface=b"core-event-archive")
            return
        try:
            request = await self._read_json(receive)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            await self._send_json(send, 400, {"error": str(error)})
            return
        event_id = str(request.get("eventId") or "").strip()
        template_id = str(request.get("templateId") or "").strip()
        scenario_id = str(request.get("scenarioId") or event_id).strip()
        if not event_id or not template_id:
            await self._send_json(send, 400, {"error": "eventId and templateId are required"})
            return
        frames = await asyncio.to_thread(archive.read_event, event_id)
        if not frames:
            await self._send_json(send, 404, {"error": "event evidence was not found"})
            return
        server_ids = {frame.server_id for frame in frames}
        if len(server_ids) != 1:
            await self._send_json(send, 500, {"error": "event evidence spans multiple servers"})
            return
        server_id = next(iter(server_ids))
        pipeline = _pipeline_for_server(server_id)
        if pipeline is None:
            await self._send_json(send, 503, {"status": "unavailable", "error": "operational Core runtime is unavailable for event server"})
            return
        template = pipeline.producer.runtime.bank.template_by_id(template_id)
        if template is None:
            await self._send_json(send, 404, {"error": "template is not present in the active Core template bank"})
            return
        code_version = _code_version()
        config_version = _config_version()
        if code_version is None or config_version is None:
            await self._send_json(send, 503, {"status": "unavailable", "error": "code/config provenance is unavailable"})
            return
        try:
            result = await asyncio.to_thread(
                recompute_so_event,
                event_id=event_id,
                template=template,
                frames=frames,
                code_version=code_version,
                config_version=config_version,
                scenario_id=scenario_id,
                config=pipeline.producer.runtime.scorer.scoring_config,
                minimum_valid_vehicles=pipeline.producer.runtime.scorer.minimum_valid_vehicles,
            )
            result = {**result, "lifecycle": await asyncio.to_thread(lifecycle_archive.event_lifecycle, event_id)}
            await asyncio.to_thread(archive.record_recompute, result, created_at_utc=datetime.now(UTC))
        except (TypeError, ValueError) as error:
            await self._send_json(send, 422, {"status": "error", "error": f"event recomputation rejected: {error}"}, surface=b"core-event-archive")
            return
        await self._send_json(send, 200, result, surface=b"core-event-archive")

    async def __call__(self, scope, receive, send) -> None:
        path = str(scope.get("path", ""))
        if scope.get("type") != "http" or path not in {"/v1/qa/run", "/v1/investigation/events", "/v1/investigation/recompute"}:
            await self.base_app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        if not self._authorized(headers):
            await self._send_json(send, 401, {"error": "unauthorized"})
            return
        if path == "/v1/qa/run":
            await self._handle_qa(scope, receive, send)
        elif path == "/v1/investigation/events":
            await self._handle_events(scope, send)
        else:
            await self._handle_recompute(scope, receive, send)


app = QaEnabledASGI(service.app, token=os.environ.get("BLUEWOLF_CORE_API_TOKEN"))


def main() -> None:
    """Run the operational loop with live, QA and investigation endpoints."""

    global event_archive, event_lifecycle_archive
    try:
        import uvicorn
    except ImportError as exc:
        raise SystemExit("Install the runtime service extra: pip install -e '.[service]'") from exc

    from .runtime_host import host_from_environment

    host = os.environ.get("BLUEWOLF_RUNTIME_HOST", "0.0.0.0")
    port = int(os.environ.get("BLUEWOLF_RUNTIME_PORT", "8080"))
    service.operational_host = host_from_environment(service.runtime_store)
    config_path = os.environ.get("BLUEWOLF_OPERATIONAL_CONFIG", "").strip()
    if service.operational_host is not None and config_path:
        attached = attach_event_archives(service.operational_host.loop, config_path=config_path)
        if attached is None:
            event_archive = None
            event_lifecycle_archive = None
        else:
            event_archive, event_lifecycle_archive = attached
    else:
        event_archive = None
        event_lifecycle_archive = None
    if service.operational_host is not None:
        service.operational_host.start()
    try:
        uvicorn.run(app, host=host, port=port, workers=1)
    finally:
        if service.operational_host is not None:
            service.operational_host.stop()
        service.operational_host = None
        event_archive = None
        event_lifecycle_archive = None


__all__ = ["QaEnabledASGI", "app", "event_archive", "event_lifecycle_archive", "main"]
