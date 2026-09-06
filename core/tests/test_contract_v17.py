from __future__ import annotations

import math
import unittest
from dataclasses import fields

import bluewolf_core
from bluewolf_core import (
    CanonicalPoint,
    ClosedRoute,
    CoreConfig,
    CoreSession,
    Direction,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
    VehicleSample,
    closed_polyline_length,
    point_at_phase,
    project_onto_closed_polyline,
)


class V17ArchitectureContractTests(unittest.TestCase):
    def test_python_is_current_canonical_contract(self) -> None:
        self.assertEqual(bluewolf_core.CORE_API_VERSION, "1.0.0")
        self.assertEqual(bluewolf_core.IMPLEMENTATION_LANGUAGE, "python")

    def test_work_mode_timing_defaults_are_locked(self) -> None:
        config = CoreConfig()
        self.assertEqual(config.timing.logical_grid_seconds, 1)
        self.assertEqual(config.timing.live_batch_seconds, 5)
        self.assertEqual(config.timing.checkpoint_seconds, 300)
        self.assertEqual(config.grouping.membership_confirmation_seconds, 120)

    def test_vehicle_sample_contract_has_no_ttag(self) -> None:
        names = {item.name.lower() for item in fields(VehicleSample)}
        self.assertNotIn("ttag", names)
        self.assertFalse(any("ttag" in name for name in names))

    def test_closed_route_contract_is_not_limited_to_64_points(self) -> None:
        points = tuple(
            CanonicalPoint(
                100.0 * math.cos(2.0 * math.pi * i / 80.0),
                100.0 * math.sin(2.0 * math.pi * i / 80.0),
            )
            for i in range(80)
        )
        route = ClosedRoute(
            route_id="generic-80",
            family=RouteFamily.FREE,
            subtype=RouteSubtype.UNKNOWN,
            topology=RouteTopology.SIMPLE,
            canonical_points=points,
            center_latitude_deg=31.7,
            center_longitude_deg=34.8,
            length_m=closed_polyline_length(points),
            long_axis_a_m=200.0,
            short_axis_b_m=200.0,
            orientation_deg=0.0,
            estimated_period_s=120.0,
            direction=Direction.CLOCKWISE,
            detection_quality=1.0,
        )
        self.assertEqual(len(route.canonical_points), 80)

    def test_octagon_uses_generic_arc_length_phase(self) -> None:
        points = tuple(
            CanonicalPoint(
                100.0 * math.cos(2.0 * math.pi * i / 8.0),
                100.0 * math.sin(2.0 * math.pi * i / 8.0),
            )
            for i in range(8)
        )
        quarter, segment, fraction = point_at_phase(points, 0.25)
        self.assertIn(segment, range(8))
        self.assertGreaterEqual(fraction, 0.0)
        self.assertLessEqual(fraction, 1.0)
        projection = project_onto_closed_polyline(points, quarter)
        self.assertAlmostEqual(projection.phase, 0.25, places=7)
        self.assertAlmostEqual(projection.distance_m, 0.0, places=7)

    def test_checkpoint_roundtrip_uses_core_state_not_navigation_archive(self) -> None:
        config = CoreConfig()
        session = CoreSession(config=config)
        checkpoint = session.export_checkpoint()
        restored = CoreSession.from_checkpoint(checkpoint, config=config)
        self.assertIsNone(restored.processed_until_utc)
        self.assertEqual(restored.debug_state()["vehicles"], [])
        self.assertEqual(restored.debug_state()["routes"], [])


if __name__ == "__main__":
    unittest.main()
