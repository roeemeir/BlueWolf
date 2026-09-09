"""Dependency-light ASGI service for the Blue Wolf live runtime contract.

The service is application-facing and remains outside ``bluewolf_core``.
Validated producers publish snapshots into ``RuntimeSnapshotStore``; the ASGI
transport exposes the latest snapshot and a bounded live-history cache.

The history cache is deliberately a live-operator facility, not the after-action
archive. It is bounded, process-local, ordered by ``observedAt`` and supports
same-timestamp replacement so a corrected publication does not create duplicate
points. Operational restart persistence may serialize this cache separately.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
import hmac
import json
import os
import re
from threading import RLock
from typing import Any, Callable, Mapping
from urllib.parse import parse_qs

from .contract import LIVE_RUNTIME_SCHEMA_VERSION

_SERVER_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_MAX_HISTORY_REQUEST = 1000


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _parse_utc(value: object) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError("runtime observedAt must be a non-empty string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("runtime observedAt is not ISO-8601") from exc
    if parsed.tzinfo is None:
        raise ValueError("runtime observedAt must be timezone-aware")
    return parsed.astimezone(UTC)


def _positive_seconds(name: str, value: float) -> float:
    numeric = float(value)
    if numeric <= 0.0:
        raise ValueError(f"{name} must be positive")
    return numeric


def _positive_integer(name: str, value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _validate_snapshot(snapshot: Mapping[str, Any]) -> tuple[str, datetime]:
    if snapshot.get("schemaVersion") != LIVE_RUNTIME_SCHEMA_VERSION:
        raise ValueError("unsupported live runtime schema")
    server_id = snapshot.get("serverId")
    if not isinstance(server_id, str) or not _SERVER_PATTERN.fullmatch(server_id):
        raise ValueError("runtime snapshot has an invalid serverId")
    observed_at = _parse_utc(snapshot.get("observedAt"))
    source = snapshot.get("source")
    if not isinstance(source, Mapping) or source.get("kind") != "python-core":
        raise ValueError("runtime source must be python-core")
    groups = snapshot.get("groups")
    if not isinstance(groups, Mapping):
        raise ValueError("runtime groups must be an object")
    return server_id, observed_at


class RuntimeSnapshotStore:
    """Thread-safe latest snapshot plus bounded live history per server."""

    def __init__(self, *, history_limit: int = 360) -> None:
        self.history_limit = _positive_integer("history_limit", history_limit)
        self._lock = RLock()
        self._snapshots: dict[str, dict[str, Any]] = {}
        self._history: dict[str, list[dict[str, Any]]] = {}

    def publish(self, snapshot: Mapping[str, Any]) -> None:
        server_id, observed_at = _validate_snapshot(snapshot)
        frozen = deepcopy(dict(snapshot))
        with self._lock:
            history = self._history.setdefault(server_id, [])
            replaced = False
            for index in range(len(history) - 1, -1, -1):
                existing_time = _parse_utc(history[index]["observedAt"])
                if existing_time == observed_at:
                    history[index] = deepcopy(frozen)
                    replaced = True
                    break
            if not replaced:
                history.append(deepcopy(frozen))
                history.sort(key=lambda item: _parse_utc(item["observedAt"]))
            if len(history) > self.history_limit:
                del history[: len(history) - self.history_limit]

            current = self._snapshots.get(server_id)
            if current is None or observed_at >= _parse_utc(current["observedAt"]):
                self._snapshots[server_id] = frozen

    def get(self, server_id: str) -> dict[str, Any] | None:
        if not _SERVER_PATTERN.fullmatch(server_id):
            raise ValueError("invalid serverId")
        with self._lock:
            snapshot = self._snapshots.get(server_id)
            return None if snapshot is None else deepcopy(snapshot)

    def history(self, server_id: str, *, limit: int | None = None) -> list[dict[str, Any]]:
        if not _SERVER_PATTERN.fullmatch(server_id):
            raise ValueError("invalid serverId")
        requested = self.history_limit if limit is None else _positive_integer("limit", limit)
        if requested > _MAX_HISTORY_REQUEST:
            raise ValueError(f"limit must be <= {_MAX_HISTORY_REQUEST}")
        with self._lock:
            rows = self._history.get(server_id, [])
            return deepcopy(rows[-requested:])

    def clear(self, server_id: str | None = None) -> None:
        with self._lock:
            if server_id is None:
                self._snapshots.clear()
                self._history.clear()
            else:
                self._snapshots.pop(server_id, None)
                self._history.pop(server_id, None)


def _json_bytes(payload: Mapping[str, Any]) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


ReadinessProbe = Callable[[], Mapping[str, Any]]


class BlueWolfRuntimeASGI:
    """Minimal ASGI transport around ``RuntimeSnapshotStore``."""

    def __init__(
        self,
        store: RuntimeSnapshotStore,
        *,
        token: str | None = None,
        stale_after_seconds: float = 15.0,
        expire_after_seconds: float = 60.0,
        clock: Callable[[], datetime] = _utc_now,
        readiness_probe: ReadinessProbe | None = None,
    ) -> None:
        self.store = store
        self.token = token.strip() if token else None
        self.stale_after_seconds = _positive_seconds(
            "stale_after_seconds", stale_after_seconds
        )
        self.expire_after_seconds = _positive_seconds(
            "expire_after_seconds", expire_after_seconds
        )
        if self.expire_after_seconds <= self.stale_after_seconds:
            raise ValueError("expire_after_seconds must exceed stale_after_seconds")
        self.clock = clock
        self.readiness_probe = readiness_probe

    def _authorized(self, headers: Mapping[bytes, bytes]) -> bool:
        if self.token is None:
            return True
        raw = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")
        expected = f"Bearer {self.token}"
        return hmac.compare_digest(raw, expected)

    async def _send_json(
        self,
        send,
        status: int,
        payload: Mapping[str, Any],
        *,
        runtime_health: str | None = None,
    ) -> None:
        body = _json_bytes(payload)
        headers = [
            (b"content-type", b"application/json; charset=utf-8"),
            (b"cache-control", b"no-store"),
            (b"content-length", str(len(body)).encode("ascii")),
        ]
        if runtime_health is not None:
            headers.append((b"x-bluewolf-runtime-health", runtime_health.encode("ascii")))
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": body})

    @staticmethod
    def _query(scope) -> dict[str, list[str]]:
        return parse_qs(
            bytes(scope.get("query_string", b"")).decode("utf-8", errors="strict"),
            keep_blank_values=True,
        )

    @staticmethod
    def _server_id(query: Mapping[str, list[str]]) -> str:
        values = query.get("serverId", [])
        return values[0] if len(values) == 1 else ""

    async def __call__(self, scope, receive, send) -> None:
        del receive
        if scope.get("type") != "http":
            return
        method = str(scope.get("method", "GET")).upper()
        path = str(scope.get("path", ""))
        headers = {key.lower(): value for key, value in scope.get("headers", [])}

        if path == "/healthz":
            if method != "GET":
                await self._send_json(send, 405, {"error": "method not allowed"})
                return
            await self._send_json(
                send,
                200,
                {
                    "ok": True,
                    "service": "bluewolf-runtime",
                    "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
                },
            )
            return

        if path == "/readyz":
            if method != "GET":
                await self._send_json(send, 405, {"error": "method not allowed"})
                return
            readiness = (
                {"ok": True, "mode": "transport-only"}
                if self.readiness_probe is None
                else dict(self.readiness_probe())
            )
            ready = readiness.get("ok") is True
            payload = {
                "service": "bluewolf-runtime",
                "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
                **readiness,
            }
            await self._send_json(send, 200 if ready else 503, payload)
            return

        if path not in {"/v1/live-runtime", "/v1/live-runtime/history"}:
            await self._send_json(send, 404, {"error": "not found"})
            return
        if method != "GET":
            await self._send_json(send, 405, {"error": "method not allowed"})
            return
        if not self._authorized(headers):
            await self._send_json(send, 401, {"error": "unauthorized"})
            return

        query = self._query(scope)
        server_id = self._server_id(query)
        if not _SERVER_PATTERN.fullmatch(server_id):
            await self._send_json(send, 400, {"error": "valid serverId is required"})
            return

        if path == "/v1/live-runtime/history":
            raw_limit = query.get("limit", [])
            try:
                limit = self.store.history_limit
                if raw_limit:
                    if len(raw_limit) != 1:
                        raise ValueError("limit must be singular")
                    limit = int(raw_limit[0])
                snapshots = self.store.history(server_id, limit=limit)
            except (TypeError, ValueError):
                await self._send_json(
                    send,
                    400,
                    {"error": f"limit must be an integer in [1,{_MAX_HISTORY_REQUEST}]"},
                )
                return
            await self._send_json(
                send,
                200,
                {
                    "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
                    "serverId": server_id,
                    "snapshots": snapshots,
                },
            )
            return

        snapshot = self.store.get(server_id)
        if snapshot is None:
            await self._send_json(
                send,
                404,
                {
                    "error": "runtime snapshot is not available for this server",
                    "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
                    "serverId": server_id,
                },
                runtime_health="unavailable",
            )
            return

        observed_at = _parse_utc(snapshot["observedAt"])
        now = self.clock()
        if now.tzinfo is None:
            raise ValueError("runtime service clock must be timezone-aware")
        age_seconds = max(0.0, (now.astimezone(UTC) - observed_at).total_seconds())

        if age_seconds > self.expire_after_seconds:
            await self._send_json(
                send,
                503,
                {
                    "error": "runtime snapshot expired",
                    "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
                    "serverId": server_id,
                    "observedAt": snapshot["observedAt"],
                    "ageSeconds": age_seconds,
                },
                runtime_health="unavailable",
            )
            return

        source = snapshot.setdefault("source", {})
        existing_health = source.get("health")
        health = "stale" if age_seconds > self.stale_after_seconds else "healthy"
        if existing_health == "unavailable":
            health = "unavailable"
        elif existing_health == "stale":
            health = "stale"
        source["health"] = health
        source["ageSeconds"] = age_seconds
        if health == "stale":
            detail = str(source.get("detail") or "Python Core runtime")
            source["detail"] = f"{detail} · stale snapshot"

        await self._send_json(send, 200, snapshot, runtime_health=health)


def create_app(
    store: RuntimeSnapshotStore | None = None,
    *,
    token: str | None = None,
    stale_after_seconds: float | None = None,
    expire_after_seconds: float | None = None,
    clock: Callable[[], datetime] = _utc_now,
    readiness_probe: ReadinessProbe | None = None,
) -> BlueWolfRuntimeASGI:
    """Create the runtime ASGI app from explicit args or environment defaults."""

    stale = (
        float(os.environ.get("BLUEWOLF_RUNTIME_STALE_SECONDS", "15"))
        if stale_after_seconds is None
        else stale_after_seconds
    )
    expire = (
        float(os.environ.get("BLUEWOLF_RUNTIME_EXPIRE_SECONDS", "60"))
        if expire_after_seconds is None
        else expire_after_seconds
    )
    resolved_token = (
        os.environ.get("BLUEWOLF_CORE_API_TOKEN") if token is None else token
    )
    return BlueWolfRuntimeASGI(
        store or RuntimeSnapshotStore(),
        token=resolved_token,
        stale_after_seconds=stale,
        expire_after_seconds=expire,
        clock=clock,
        readiness_probe=readiness_probe,
    )


def _history_limit_from_environment() -> int:
    raw = os.environ.get("BLUEWOLF_RUNTIME_HISTORY_LIMIT", "360")
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError("BLUEWOLF_RUNTIME_HISTORY_LIMIT must be an integer") from exc
    return _positive_integer("BLUEWOLF_RUNTIME_HISTORY_LIMIT", value)


runtime_store = RuntimeSnapshotStore(history_limit=_history_limit_from_environment())
operational_host: Any | None = None


def _operational_readiness() -> Mapping[str, Any]:
    requested = bool(
        os.environ.get("BLUEWOLF_OPERATIONAL_FACTORY", "").strip()
        or os.environ.get("BLUEWOLF_OPERATIONAL_CONFIG", "").strip()
    )
    if not requested:
        return {"ok": True, "mode": "transport-only"}
    host = operational_host
    if host is None:
        return {
            "ok": False,
            "mode": "operational",
            "error": "operational runtime host is not started",
        }
    snapshot = host.snapshot()
    if snapshot.thread_error is not None:
        return {
            "ok": False,
            "mode": "operational",
            "running": snapshot.running,
            "tickCount": snapshot.tick_count,
            "error": snapshot.thread_error,
        }
    if not snapshot.running:
        return {
            "ok": False,
            "mode": "operational",
            "running": False,
            "tickCount": snapshot.tick_count,
            "error": "operational runtime host is not running",
        }
    if snapshot.tick_count < 1:
        return {
            "ok": False,
            "mode": "operational",
            "running": True,
            "tickCount": 0,
            "error": "operational runtime has not completed its first tick",
        }
    return {
        "ok": True,
        "mode": "operational",
        "running": True,
        "tickCount": snapshot.tick_count,
        "lastTickUtc": (
            None
            if snapshot.last_tick_utc is None
            else snapshot.last_tick_utc.isoformat().replace("+00:00", "Z")
        ),
        "serverErrors": [
            {"serverId": server_id, "error": error}
            for server_id, error in snapshot.last_errors
        ],
    }


app = create_app(runtime_store, readiness_probe=_operational_readiness)


def main() -> None:
    """Run the process-local operational loop and ASGI transport."""

    global operational_host

    try:
        import uvicorn
    except ImportError as exc:  # pragma: no cover - deployment-only guard.
        raise SystemExit(
            "Install the runtime service extra: pip install -e '.[service]'"
        ) from exc

    from .runtime_host import host_from_environment

    host = os.environ.get("BLUEWOLF_RUNTIME_HOST", "0.0.0.0")
    port = int(os.environ.get("BLUEWOLF_RUNTIME_PORT", "8080"))
    operational_host = host_from_environment(runtime_store)
    if operational_host is not None:
        operational_host.start()
    try:
        uvicorn.run(app, host=host, port=port, workers=1)
    finally:
        if operational_host is not None:
            operational_host.stop()
        operational_host = None


__all__ = [
    "BlueWolfRuntimeASGI",
    "ReadinessProbe",
    "RuntimeSnapshotStore",
    "app",
    "create_app",
    "main",
    "operational_host",
    "runtime_store",
]
