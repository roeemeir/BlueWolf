from __future__ import annotations

import unittest

from test_live_so_event_runtime import _members, _runtime
from test_live_so_scoring import _constellation, _route


class LiveSOEventRouteEvidenceTests(unittest.TestCase):
    def test_observation_sink_captures_core_route_snapshot_on_pending_and_scored_frames(self) -> None:
        runtime, _, _ = _runtime()
        captured = []
        runtime.observation_sink = captured.append
        route = _route(period_s=100.0)
        constellation = _constellation()

        warmup_members = _members(route, 0)
        runtime.process_snapshot(
            "g1",
            constellation,
            warmup_members,
            reference_period_s=100.0,
            displayed_group_score=90.0,
            displayed_score_valid=True,
        )
        scored_members = _members(route, 5)
        runtime.process_snapshot(
            "g1",
            constellation,
            scored_members,
            reference_period_s=100.0,
            displayed_group_score=90.0,
            displayed_score_valid=True,
        )

        self.assertEqual(len(captured), 2)
        self.assertEqual(len(captured[0].routes), 1)
        self.assertEqual(captured[0].routes, captured[1].routes)
        evidence = captured[0].routes[0]
        self.assertEqual(evidence.route_instance_id, "r1")
        self.assertEqual(evidence.route_id, route.route_id)
        self.assertEqual(evidence.subtype, route.subtype.value)
        self.assertEqual(len(evidence.centerline_wgs84), len(route.canonical_points))
        self.assertGreater(evidence.length_m, 0.0)
        self.assertGreaterEqual(evidence.detection_quality, 0.0)
        self.assertLessEqual(evidence.detection_quality, 1.0)


if __name__ == "__main__":
    unittest.main()
