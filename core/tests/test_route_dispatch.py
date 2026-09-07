from __future__ import annotations

import unittest
from datetime import UTC, datetime

from bluewolf_core import RouteSubtype, detect_closed_route
from bluewolf_core.simulator import SimulatedVehicle, generate_double_hippodrome_samples


class RouteDispatcherTests(unittest.TestCase):
    def test_public_detector_prefers_confirmed_double_topology(self) -> None:
        samples = generate_double_hippodrome_samples(
            start_time_utc=datetime(2026, 1, 1, tzinfo=UTC),
            duration_seconds=180,
            vehicles=(SimulatedVehicle(7, 707, 0),),
            single_long_axis_m=80,
            short_axis_m=20,
            single_period_seconds=90,
            orientation_deg=27,
        )

        detected = detect_closed_route(samples)

        self.assertIsNotNone(detected)
        assert detected is not None
        self.assertEqual(detected.effective.subtype, RouteSubtype.DOUBLE_HIPPODROME)
        self.assertTrue(bool(detected.diagnostics["double_topology"]))
        self.assertAlmostEqual(detected.effective.estimated_period_s, 180.0, delta=10.0)

    def test_half_double_is_not_confirmed_as_simple_hippodrome(self) -> None:
        samples = generate_double_hippodrome_samples(
            start_time_utc=datetime(2026, 1, 1, tzinfo=UTC),
            duration_seconds=90,
            vehicles=(SimulatedVehicle(7, 707, 0),),
            single_long_axis_m=80,
            short_axis_m=20,
            single_period_seconds=90,
        )

        self.assertIsNone(detect_closed_route(samples))


if __name__ == "__main__":
    unittest.main()
