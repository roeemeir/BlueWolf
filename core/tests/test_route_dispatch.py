from __future__ import annotations

import unittest
from datetime import UTC, datetime

from bluewolf_core import RouteSubtype, RouteTopology, detect_closed_route
from bluewolf_core.simulator import (
    SimulatedVehicle,
    generate_double_hippodrome_samples,
    generate_figure_eight_samples,
)


START = datetime(2026, 1, 1, tzinfo=UTC)


class RouteDispatcherTests(unittest.TestCase):
    def test_public_detector_prefers_confirmed_double_topology(self) -> None:
        samples = generate_double_hippodrome_samples(
            start_time_utc=START,
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
            start_time_utc=START,
            duration_seconds=90,
            vehicles=(SimulatedVehicle(7, 707, 0),),
            single_long_axis_m=80,
            short_axis_m=20,
            single_period_seconds=90,
        )
        self.assertIsNone(detect_closed_route(samples))

    def test_public_detector_prefers_confirmed_figure_eight_topology(self) -> None:
        samples = generate_figure_eight_samples(
            start_time_utc=START,
            duration_seconds=180,
            vehicles=(SimulatedVehicle(7, 707, 0),),
            long_extent_m=100,
            short_extent_m=50,
            period_seconds=180,
            orientation_deg=31,
        )

        detected = detect_closed_route(samples)

        self.assertIsNotNone(detected)
        assert detected is not None
        self.assertEqual(detected.effective.subtype, RouteSubtype.FIGURE_EIGHT)
        self.assertEqual(detected.effective.topology, RouteTopology.SELF_CROSSING)
        self.assertTrue(bool(detected.diagnostics["self_crossing_topology"]))
        self.assertAlmostEqual(detected.effective.estimated_period_s, 180.0, delta=3.0)

    def test_half_figure_eight_is_not_confirmed_as_any_simple_route(self) -> None:
        samples = generate_figure_eight_samples(
            start_time_utc=START,
            duration_seconds=90,
            vehicles=(SimulatedVehicle(7, 707, 0),),
            period_seconds=180,
        )
        self.assertIsNone(detect_closed_route(samples))


if __name__ == "__main__":
    unittest.main()
