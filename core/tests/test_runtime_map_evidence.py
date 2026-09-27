from __future__ import annotations

import unittest

from bluewolf_runtime_adapter.producer import (
    DisplayedScoreValue,
    LiveRuntimeProducer,
)
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore

from test_runtime_producer import _Session, _binding, _group, _poll, _runtime
from test_live_so_scoring import _route


class RuntimeMapEvidenceTests(unittest.TestCase):
    def test_confirmed_route_is_published_as_wgs84_detected_route_evidence(self) -> None:
        route = _route(period_s=100.0)
        group = _group("g1", 1, 2, route)
        session = _Session((group,), {(1, 1): route, (1, 2): route})
        producer = LiveRuntimeProducer(
            server_id=1,
            session=session,  # type: ignore[arg-type]
            runtime=_runtime(),
            store=RuntimeSnapshotStore(),
            binding_resolver=lambda _group: _binding("g1", 1, 2, route),
            displayed_score_resolver=lambda _group_id, _when: DisplayedScoreValue(88.0, True),
        )

        producer.publish_poll(_poll((group,), route, 0))
        result = producer.publish_poll(_poll((group,), route, 5))
        assert result.snapshot is not None
        runtime_group = result.snapshot["groupList"][0]
        detected = runtime_group["detectedRoutes"]
        self.assertEqual(len(detected), 1)
        evidence = detected[0]
        self.assertEqual(evidence["routeInstanceId"], "r1")
        self.assertEqual(evidence["routeId"], route.route_id)
        self.assertEqual(evidence["subtype"], route.subtype.value)
        self.assertEqual(evidence["direction"], route.direction.value)
        self.assertAlmostEqual(evidence["detectionQuality"], route.detection_quality)
        self.assertEqual(len(evidence["centerline"]), len(route.canonical_points))
        self.assertTrue(all(-90.0 <= point["latitude"] <= 90.0 for point in evidence["centerline"]))
        self.assertTrue(all(-180.0 <= point["longitude"] <= 180.0 for point in evidence["centerline"]))


if __name__ == "__main__":
    unittest.main()
