from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import bluewolf_runtime_adapter.service as service_module
from bluewolf_runtime_adapter.contract import LIVE_RUNTIME_SCHEMA_VERSION
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore, create_app


NOW = datetime(2026, 9, 9, 15, 0, tzinfo=UTC)


def _snapshot(*, server_id: str = "1", observed_at: datetime = NOW):
    return {
        "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
        "serverId": server_id,
        "arena": "North",
        "status": "1 קבוצת SO · 2 רכבים",
        "observedAt": observed_at.isoformat().replace("+00:00", "Z"),
        "source": {
            "kind": "python-core",
            "health": "healthy",
            "detail": "test runtime",
        },
        "groups": {
            "so": {
                "key": "so",
                "id": "g1",
                "name": "קבוצה g1",
                "family": "SO",
                "subtitle": "Python Core · SO",
                "total": 80.0,
                "sync": 82.0,
                "route": 78.0,
                "confidence": 95.0,
                "color": "#4378e8",
                "members": [],
                "templateId": "t1",
                "reason": "Python Core runtime",
                "success": "Python Core סיפק snapshot תקף.",
                "scoreValid": True,
                "observedAt": observed_at.isoformat().replace("+00:00", "Z"),
            }
        },
    }


async def _request(app, path: str, *, query: str = "", token: str | None = None):
    messages = []
    headers = [(b"host", b"test")]
    if token is not None:
        headers.append((b"authorization", f"Bearer {token}".encode("utf-8")))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": query.encode("utf-8"),
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("test", 80),
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    await app(scope, receive, send)
    start = next(message for message in messages if message["type"] == "http.response.start")
    body = b"".join(
        message.get("body", b"")
        for message in messages
        if message["type"] == "http.response.body"
    )
    headers_out = {key.decode(): value.decode() for key, value in start["headers"]}
    return start["status"], headers_out, json.loads(body.decode("utf-8"))


class RuntimeSnapshotStoreTests(unittest.TestCase):
    def test_publish_is_defensive_and_keyed_by_server(self) -> None:
        store = RuntimeSnapshotStore()
        payload = _snapshot(server_id="srv_1")
        store.publish(payload)
        payload["status"] = "mutated outside store"

        stored = store.get("srv_1")
        assert stored is not None
        self.assertEqual(stored["status"], "1 קבוצת SO · 2 רכבים")
        stored["status"] = "mutated returned copy"
        self.assertNotEqual(store.get("srv_1")["status"], stored["status"])

    def test_rejects_wrong_schema_and_non_core_source(self) -> None:
        store = RuntimeSnapshotStore()
        wrong_schema = _snapshot()
        wrong_schema["schemaVersion"] = "other"
        with self.assertRaisesRegex(ValueError, "unsupported"):
            store.publish(wrong_schema)

        wrong_source = _snapshot()
        wrong_source["source"]["kind"] = "simulation"
        with self.assertRaisesRegex(ValueError, "python-core"):
            store.publish(wrong_source)


class RuntimeServiceTests(unittest.TestCase):
    def test_health_is_available_without_runtime_snapshot(self) -> None:
        app = create_app(RuntimeSnapshotStore(), token="secret", clock=lambda: NOW)
        status, _, payload = asyncio.run(_request(app, "/healthz"))
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["schemaVersion"], LIVE_RUNTIME_SCHEMA_VERSION)

    def test_readiness_defaults_to_transport_only_when_no_probe_is_supplied(self) -> None:
        app = create_app(RuntimeSnapshotStore(), token="secret", clock=lambda: NOW)
        status, _, payload = asyncio.run(_request(app, "/readyz"))
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["mode"], "transport-only")
        self.assertEqual(payload["schemaVersion"], LIVE_RUNTIME_SCHEMA_VERSION)

    def test_readiness_returns_503_when_operational_probe_is_not_ready(self) -> None:
        app = create_app(
            RuntimeSnapshotStore(),
            clock=lambda: NOW,
            readiness_probe=lambda: {
                "ok": False,
                "mode": "operational",
                "error": "polling thread stopped",
            },
        )
        status, _, payload = asyncio.run(_request(app, "/readyz"))
        self.assertEqual(status, 503)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["mode"], "operational")
        self.assertEqual(payload["error"], "polling thread stopped")

    def test_readiness_reports_running_operational_probe(self) -> None:
        app = create_app(
            RuntimeSnapshotStore(),
            clock=lambda: NOW,
            readiness_probe=lambda: {
                "ok": True,
                "mode": "operational",
                "running": True,
                "tickCount": 3,
            },
        )
        status, _, payload = asyncio.run(_request(app, "/readyz"))
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["running"])
        self.assertEqual(payload["tickCount"], 3)

    def test_builtin_operational_readiness_waits_for_first_completed_tick(self) -> None:
        class Host:
            def __init__(self, tick_count: int) -> None:
                self.tick_count = tick_count

            def snapshot(self):
                return SimpleNamespace(
                    thread_error=None,
                    running=True,
                    tick_count=self.tick_count,
                    last_tick_utc=NOW if self.tick_count else None,
                    last_errors=(),
                )

        with patch.dict(os.environ, {"BLUEWOLF_OPERATIONAL_CONFIG": "runtime.json"}, clear=True):
            with patch.object(service_module, "operational_host", Host(0)):
                pending = service_module._operational_readiness()
            with patch.object(service_module, "operational_host", Host(1)):
                ready = service_module._operational_readiness()

        self.assertFalse(pending["ok"])
        self.assertEqual(pending["tickCount"], 0)
        self.assertIn("first tick", pending["error"])
        self.assertTrue(ready["ok"])
        self.assertEqual(ready["tickCount"], 1)
        self.assertEqual(ready["lastTickUtc"], NOW.isoformat().replace("+00:00", "Z"))

    def test_live_runtime_requires_bearer_token_when_configured(self) -> None:
        store = RuntimeSnapshotStore()
        store.publish(_snapshot())
        app = create_app(store, token="secret", clock=lambda: NOW)

        status, _, _ = asyncio.run(_request(app, "/v1/live-runtime", query="serverId=1"))
        self.assertEqual(status, 401)
        status, _, payload = asyncio.run(
            _request(app, "/v1/live-runtime", query="serverId=1", token="secret")
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["serverId"], "1")

    def test_missing_server_is_fail_closed_not_demo_data(self) -> None:
        app = create_app(RuntimeSnapshotStore(), clock=lambda: NOW)
        status, headers, payload = asyncio.run(
            _request(app, "/v1/live-runtime", query="serverId=missing")
        )
        self.assertEqual(status, 404)
        self.assertEqual(headers["x-bluewolf-runtime-health"], "unavailable")
        self.assertNotIn("groups", payload)

    def test_marks_old_but_usable_snapshot_stale(self) -> None:
        store = RuntimeSnapshotStore()
        store.publish(_snapshot(observed_at=NOW - timedelta(seconds=20)))
        app = create_app(
            store,
            stale_after_seconds=15,
            expire_after_seconds=60,
            clock=lambda: NOW,
        )
        status, headers, payload = asyncio.run(
            _request(app, "/v1/live-runtime", query="serverId=1")
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["x-bluewolf-runtime-health"], "stale")
        self.assertEqual(payload["source"]["health"], "stale")
        self.assertEqual(payload["source"]["ageSeconds"], 20.0)

    def test_expired_snapshot_returns_503_without_group_scores(self) -> None:
        store = RuntimeSnapshotStore()
        store.publish(_snapshot(observed_at=NOW - timedelta(seconds=61)))
        app = create_app(
            store,
            stale_after_seconds=15,
            expire_after_seconds=60,
            clock=lambda: NOW,
        )
        status, headers, payload = asyncio.run(
            _request(app, "/v1/live-runtime", query="serverId=1")
        )
        self.assertEqual(status, 503)
        self.assertEqual(headers["x-bluewolf-runtime-health"], "unavailable")
        self.assertEqual(payload["error"], "runtime snapshot expired")
        self.assertNotIn("groups", payload)

    def test_invalid_server_id_is_rejected_before_store_lookup(self) -> None:
        app = create_app(RuntimeSnapshotStore(), clock=lambda: NOW)
        status, _, payload = asyncio.run(
            _request(app, "/v1/live-runtime", query="serverId=bad%2Fid")
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "valid serverId is required")


if __name__ == "__main__":
    unittest.main()
