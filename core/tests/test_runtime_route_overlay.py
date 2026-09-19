from __future__ import annotations

import unittest

from bluewolf_runtime_adapter.producer import DisplayedScoreValue, LiveRuntimeProducer
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore

from test_live_so_scoring import _route
from test_runtime_producer import _Session, _binding, _group, _poll, _runtime


class RuntimeRouteOverlayTests(unittest.TestCase):
    def test_live_group_publishes_confirmed_route_centerline_from_core(self) -> None:
        route = _route(period_s=100.0)
        group = _group("g1", 1, 2, route)
        session = _Session((group,), {(1, 1): route, (1, 2): route})
        producer = LiveRuntimeProducer(
            server_id=1,
            session=session,  # type: ignore[arg-type]
            runtime=_runtime(),
            store=RuntimeSnapshotStore(),
            binding_resolver=lambda _group: _binding("g1", 1, 2, route),
            displayed_score_resolver=lambda _group_id, _when: DisplayedScoreValue(90.0, True),
        )
        producer.publish_poll(_poll((group,), route, 0))
        result = producer.publish_poll(_poll((group,), route, 5))
        assert result.snapshot is not None
        live_group = result.snapshot["groupList"][0]
        routes = live_group["detectedRoutes"]
        self.assertEqual(len(routes), 1)
        evidence = routes[0]
        self.assertEqual(evidence["routeInstanceId"], "r1")
        self.assertEqual(evidence["routeId"], route.route_id)
        self.assertEqual(evidence["subtype"], route.subtype.value)
        self.assertEqual(len(evidence["centerline"]), len(route.canonical_points))
        self.assertTrue(all(-90 <= point["latitude"] <= 90 for point in evidence["centerline"]))
        self.assertTrue(all(-180 <= point["longitude"] <= 180 for point in evidence["centerline"]))


if __name__ == "__main__":
    unittest.main()
