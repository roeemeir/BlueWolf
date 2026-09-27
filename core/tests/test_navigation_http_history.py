"""End-to-end HTTP provenance from TEST navigation through real Core and runtime.

Only source GPS/velocity is simulated. No route, group, event, score or HTTP
payload is supplied by a mock. Auth, history and restart-shaped restoration
are checked against the actual ASGI transport rather than fabricated snapshots.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_runtime_adapter.family_environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.history_contract import (
    compact_runtime_history_point,
    normalize_runtime_history_point,
)
from bluewolf_runtime_adapter.service import BlueWolfRuntimeASGI, RuntimeSnapshotStore
from test_navigation_simulation_pipeline import _config

START = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)


async def _get(app: BlueWolfRuntimeASGI, path: str, query: str, *, token: str | None = None):
    responses = []
    headers = [] if token is None else [(b"authorization", f"Bearer {token}".encode("utf-8"))]
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "query_string": query.encode("utf-8"),
        "headers": headers,
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        responses.append(message)

    await app(scope, receive, send)
    self_status = next(message["status"] for message in responses if message["type"] == "http.response.start")
    body = b"".join(message.get("body", b"") for message in responses if message["type"] == "http.response.body")
    return self_status, json.loads(body)


class NavigationHttpHistoryTests(unittest.TestCase):
    def test_real_core_simulation_is_explicit_in_authenticated_latest_history_and_restored_history(self):
        with tempfile.TemporaryDirectory() as directory:
            config = _config(str(Path(directory) / "navigation.sqlite"))
            config["servers"] = config["servers"][:1]
            config["polling"]["idleProbeSeconds"] = 5  # Test cadence; product still uses configured scheduler.
            config["siVehicleTypes"][0]["workSpeedMps"] = 2.0 * 3.141592653589793 * 100.0 / 60.0
            for vehicle in config["navigationSource"]["vehicles"]:
                vehicle["periodSeconds"] = 60.0
                vehicle["radiusMeters"] = 100.0
            store = RuntimeSnapshotStore()
            with patch.dict(os.environ, {
                "BLUEWOLF_TEST_MODE": "1",
                "BLUEWOLF_TEST_STORAGE_ROOT": directory,
                "BLUEWOLF_SAMPLE_ARCHIVE_PATH": "",
                "BLUEWOLF_OPERATIONAL_STATE_PATH": "",
                "BLUEWOLF_WORKSPACE_DB": "",
            }):
                loop = build_operational_runtime(config, store)
            adapter = loop.pipelines[0].coordinator.reader.adapter
            for elapsed in range(10, 171, 5):
                now = START + timedelta(seconds=elapsed)
                adapter.clock = lambda current=now: current
                tick = loop.tick(now)
                self.assertEqual(tick.errors, {}, f"real runtime failed at t={elapsed}: {tick.errors}")
            latest = store.get("1")
            self.assertIsNotNone(latest, "real Core failed to publish after route confirmation")
            self.assertTrue(latest["groupList"])
            api = BlueWolfRuntimeASGI(store, token="test-only-token", clock=lambda: START + timedelta(seconds=171))
            status, unauthorized = asyncio.run(_get(api, "/v1/live-runtime", "serverId=1"))
            self.assertEqual(status, 401)
            self.assertEqual(unauthorized["error"], "unauthorized")
            status, current = asyncio.run(_get(api, "/v1/live-runtime", "serverId=1", token="test-only-token"))
            self.assertEqual(status, 200)
            self.assertEqual(current["source"]["kind"], "python-core")
            self.assertEqual(current["source"]["navigationOrigin"], "simulation")
            self.assertIs(current["source"]["syntheticNavigation"], True)
            self.assertEqual(current["groupList"], latest["groupList"])
            status, timeline = asyncio.run(_get(api, "/v1/live-runtime/history", "serverId=1", token="test-only-token"))
            self.assertEqual(status, 200)
            self.assertEqual(timeline["serverId"], "1")
            self.assertTrue(timeline["points"])
            self.assertTrue(any(point["groups"] for point in timeline["points"]))
            for point in timeline["points"]:
                self.assertEqual(point["source"], {
                    "kind": "python-core",
                    "navigationOrigin": "simulation",
                    "syntheticNavigation": True,
                })
            restored = RuntimeSnapshotStore()
            restored.restore_history("1", timeline["points"])
            self.assertEqual(restored.history("1"), timeline["points"])
            # A production-Core snapshot has no synthetic source annotation.
            real = {**latest, "source": {"kind": "python-core", "health": "healthy"}}
            self.assertNotIn("source", compact_runtime_history_point(real))
            # Invalid provenance must not be silently normalized into a TEST marker.
            corrupted = {**timeline["points"][-1], "source": {
                "kind": "python-core", "navigationOrigin": "simulation", "syntheticNavigation": False,
            }}
            with self.assertRaisesRegex(ValueError, "simulation source"):
                normalize_runtime_history_point(corrupted)


if __name__ == "__main__":
    unittest.main()
