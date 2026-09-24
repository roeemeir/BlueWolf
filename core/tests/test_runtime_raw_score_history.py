"""Raw selected-template Core score survives compact history without rewriting alert score."""
from __future__ import annotations

import unittest

from bluewolf_runtime_adapter.history_contract import (
    compact_runtime_history_point,
    normalize_runtime_history_point,
)


class RawCoreHistoryTests(unittest.TestCase):
    def snapshot(self):
        return {
            "schemaVersion": "bluewolf.live-runtime.v1",
            "serverId": "1",
            "observedAt": "2026-09-24T10:00:00Z",
            "source": {
                "kind": "python-core", "health": "healthy",
                "navigationOrigin": "simulation", "syntheticNavigation": True,
            },
            "groupList": [{
                "id": "g1", "name": "SI", "color": "#123456",
                "scoreValid": True, "total": 65.0, "rawTotal": 30.0,
                "sync": 40.0, "route": 80.0,
                "event": {"id": "event-a", "active": True},
            }],
        }

    def test_compact_history_and_checkpoint_keep_distinct_raw_and_alert_totals(self):
        source = self.snapshot()
        point = compact_runtime_history_point(source)
        self.assertEqual(point["groups"][0]["rawTotal"], 30.0)
        self.assertEqual(point["groups"][0]["total"], 65.0)
        self.assertEqual(point["source"]["navigationOrigin"], "simulation")
        self.assertEqual(normalize_runtime_history_point(point), point)
        source["groupList"][0]["rawTotal"] = 99.0
        self.assertEqual(point["groups"][0]["rawTotal"], 30.0)

    def test_raw_evidence_must_be_finite_valid_and_never_fabricated_for_legacy(self):
        for invalid in (float("nan"), float("inf"), -1.0, 101.0, None, True):
            source = self.snapshot()
            source["groupList"][0]["rawTotal"] = invalid
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "rawTotal"):
                compact_runtime_history_point(source)
        source = self.snapshot()
        source["groupList"][0]["scoreValid"] = False
        with self.assertRaisesRegex(ValueError, "invalid history group"):
            compact_runtime_history_point(source)
        source = self.snapshot()
        del source["groupList"][0]["rawTotal"]
        point = compact_runtime_history_point(source)
        self.assertNotIn("rawTotal", normalize_runtime_history_point(point)["groups"][0])


if __name__ == "__main__":
    unittest.main()
