from __future__ import annotations

import asyncio
from datetime import timedelta
import unittest

from bluewolf_runtime_adapter.service import RuntimeSnapshotStore, create_app

from test_runtime_service import NOW, _request, _snapshot


class RuntimeHistoryStoreTests(unittest.TestCase):
    def test_history_is_bounded_sorted_and_same_timestamp_replaces(self) -> None:
        store = RuntimeSnapshotStore(history_limit=3)
        first = _snapshot(observed_at=NOW - timedelta(seconds=15))
        second = _snapshot(observed_at=NOW - timedelta(seconds=10))
        third = _snapshot(observed_at=NOW - timedelta(seconds=5))
        fourth = _snapshot(observed_at=NOW)

        store.publish(second)
        store.publish(first)
        store.publish(third)
        replacement = _snapshot(observed_at=NOW - timedelta(seconds=5))
        replacement["status"] = "replacement"
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
        self.assertEqual(history[1]["status"], "replacement")
        self.assertEqual(store.get("1")["observedAt"], fourth["observedAt"])

    def test_older_correction_does_not_replace_latest_snapshot(self) -> None:
        store = RuntimeSnapshotStore(history_limit=5)
        latest = _snapshot(observed_at=NOW)
        store.publish(latest)
        older = _snapshot(observed_at=NOW - timedelta(seconds=30))
        older["status"] = "late correction"
        store.publish(older)

        self.assertEqual(store.get("1")["observedAt"], latest["observedAt"])
        history = store.history("1")
        self.assertEqual([row["status"] for row in history], ["late correction", latest["status"]])


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
        self.assertEqual(payload["serverId"], "1")
        self.assertEqual(len(payload["snapshots"]), 2)
        self.assertEqual(payload["snapshots"][-1]["observedAt"], _snapshot()["observedAt"])

    def test_history_endpoint_returns_empty_list_before_first_publication(self) -> None:
        app = create_app(RuntimeSnapshotStore(), clock=lambda: NOW)
        status, _, payload = asyncio.run(
            _request(app, "/v1/live-runtime/history", query="serverId=1")
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["snapshots"], [])

    def test_history_endpoint_rejects_invalid_limit(self) -> None:
        app = create_app(RuntimeSnapshotStore(), clock=lambda: NOW)
        for value in ("0", "-1", "1001", "abc"):
            status, _, payload = asyncio.run(
                _request(app, "/v1/live-runtime/history", query=f"serverId=1&limit={value}")
            )
            self.assertEqual(status, 400)
            self.assertIn("limit", payload["error"])


if __name__ == "__main__":
    unittest.main()
