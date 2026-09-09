from __future__ import annotations

import asyncio
from datetime import timedelta
import unittest

from bluewolf_runtime_adapter.history_contract import LIVE_RUNTIME_HISTORY_SCHEMA_VERSION
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore, create_app

from test_runtime_service import NOW, _request, _snapshot


class RuntimeHistoryStoreTests(unittest.TestCase):
    def test_history_is_compact_bounded_sorted_and_same_timestamp_replaces(self) -> None:
        store = RuntimeSnapshotStore(history_limit=3)
        first = _snapshot(observed_at=NOW - timedelta(seconds=15))
        second = _snapshot(observed_at=NOW - timedelta(seconds=10))
        third = _snapshot(observed_at=NOW - timedelta(seconds=5))
        fourth = _snapshot(observed_at=NOW)

        store.publish(second)
        store.publish(first)
        store.publish(third)
        replacement = _snapshot(observed_at=NOW - timedelta(seconds=5))
        replacement["groups"]["so"]["total"] = 75.0
        store.publish(replacement)
        store.publish(fourth)

        history = store.history("1")
        self.assertEqual(len(history), 3)
        self.assertEqual(
            [item["observedAt"] for item in history],
            [
                second["observedAt"],
                replacement["observedAt"],
                fourth["observedAt"],
            ],
        )
        self.assertEqual(history[1]["groups"][0]["total"], 75.0)
        self.assertEqual(history[0]["schemaVersion"], LIVE_RUNTIME_HISTORY_SCHEMA_VERSION)
        self.assertNotIn("members", history[0]["groups"][0])
        self.assertNotIn("arena", history[0])
        self.assertNotIn("status", history[0])
        self.assertEqual(store.get("1")["observedAt"], fourth["observedAt"])

    def test_history_window_is_time_based_and_keeps_exact_boundary(self) -> None:
        store = RuntimeSnapshotStore(history_limit=100, history_window_seconds=1800)
        outside = _snapshot(observed_at=NOW - timedelta(seconds=1801))
        boundary = _snapshot(observed_at=NOW - timedelta(seconds=1800))
        middle = _snapshot(observed_at=NOW - timedelta(seconds=900))
        latest = _snapshot(observed_at=NOW)

        for snapshot in (middle, outside, boundary, latest):
            store.publish(snapshot)

        self.assertEqual(
            [row["observedAt"] for row in store.history("1")],
            [boundary["observedAt"], middle["observedAt"], latest["observedAt"]],
        )

    def test_late_correction_older_than_window_is_not_reintroduced(self) -> None:
        store = RuntimeSnapshotStore(history_limit=100, history_window_seconds=1800)
        latest = _snapshot(observed_at=NOW)
        inside = _snapshot(observed_at=NOW - timedelta(seconds=1200))
        store.publish(inside)
        store.publish(latest)

        too_old = _snapshot(observed_at=NOW - timedelta(seconds=1900))
        too_old["groups"]["so"]["total"] = 61.0
        store.publish(too_old)

        history = store.history("1")
        self.assertEqual(
            [row["observedAt"] for row in history],
            [inside["observedAt"], latest["observedAt"]],
        )
        self.assertEqual(store.get("1")["observedAt"], latest["observedAt"])

    def test_older_correction_does_not_replace_latest_snapshot(self) -> None:
        store = RuntimeSnapshotStore(history_limit=5)
        latest = _snapshot(observed_at=NOW)
        store.publish(latest)
        older = _snapshot(observed_at=NOW - timedelta(seconds=30))
        older["groups"]["so"]["total"] = 63.0
        store.publish(older)

        self.assertEqual(store.get("1")["observedAt"], latest["observedAt"])
        history = store.history("1")
        self.assertEqual(
            [row["groups"][0]["total"] for row in history],
            [63.0, 80.0],
        )

    def test_restore_history_migrates_legacy_full_snapshots(self) -> None:
        store = RuntimeSnapshotStore(history_limit=5)
        legacy = [
            _snapshot(observed_at=NOW - timedelta(seconds=5)),
            _snapshot(observed_at=NOW),
        ]
        legacy[0]["groups"]["so"]["total"] = 71.0
        store.restore_history("1", legacy)

        history = store.history("1")
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["schemaVersion"], LIVE_RUNTIME_HISTORY_SCHEMA_VERSION)
        self.assertEqual(history[0]["groups"][0]["total"], 71.0)
        self.assertIsNone(store.get("1"))

    def test_history_hard_cap_is_validated(self) -> None:
        with self.assertRaisesRegex(ValueError, "history_limit must be <= 5000"):
            RuntimeSnapshotStore(history_limit=5001)
        with self.assertRaisesRegex(ValueError, "history_window_seconds must be positive"):
            RuntimeSnapshotStore(history_window_seconds=0)


class RuntimeHistoryServiceTests(unittest.TestCase):
    def test_history_endpoint_requires_auth_and_respects_limit(self) -> None:
        store = RuntimeSnapshotStore(history_limit=5)
        for seconds in (20, 15, 10, 5, 0):
            store.publish(_snapshot(observed_at=NOW - timedelta(seconds=seconds)))
        app = create_app(store, token="secret", clock=lambda: NOW)

        status, _, _ = asyncio.run(
            _request(app, "/v1/live-runtime/history", query="serverId=1&limit=2")
        )
        self.assertEqual(status, 401)

        status, headers, payload = asyncio.run(
            _request(
                app,
                "/v1/live-runtime/history",
                query="serverId=1&limit=2",
                token="secret",
            )
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["cache-control"], "no-store")
        self.assertEqual(payload["schemaVersion"], LIVE_RUNTIME_HISTORY_SCHEMA_VERSION)
        self.assertEqual(payload["serverId"], "1")
        self.assertEqual(len(payload["points"]), 2)
        self.assertEqual(payload["points"][-1]["observedAt"], _snapshot()["observedAt"])
        self.assertNotIn("members", payload["points"][-1]["groups"][0])

    def test_history_endpoint_returns_empty_list_before_first_publication(self) -> None:
        app = create_app(RuntimeSnapshotStore(), clock=lambda: NOW)
        status, _, payload = asyncio.run(
            _request(app, "/v1/live-runtime/history", query="serverId=1")
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["schemaVersion"], LIVE_RUNTIME_HISTORY_SCHEMA_VERSION)
        self.assertEqual(payload["points"], [])

    def test_history_endpoint_rejects_invalid_limit(self) -> None:
        app = create_app(RuntimeSnapshotStore(), clock=lambda: NOW)
        for value in ("0", "-1", "5001", "abc"):
            status, _, payload = asyncio.run(
                _request(app, "/v1/live-runtime/history", query=f"serverId=1&limit={value}")
            )
            self.assertEqual(status, 400)
            self.assertIn("limit", payload["error"])


if __name__ == "__main__":
    unittest.main()
