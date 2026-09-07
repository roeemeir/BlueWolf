from __future__ import annotations

import unittest
from datetime import UTC, datetime

from bluewolf_core import Direction, RouteFamily, RouteSubtype, RouteTopology
from bluewolf_core.figure_eight import detect_figure_eight
from bluewolf_core.simulator import (
    SimulatedVehicle,
    generate_double_hippodrome_samples,
    generate_figure_eight_samples,
    generate_si_circle_samples,
)


START = datetime(2026, 1, 1, tzinfo=UTC)


class FigureEightDetectionTests(unittest.TestCase):
    def test_rotated_figure_eight_preserves_geometry_but_uses_so_family(self) -> None:
        samples = generate_figure_eight_samples(
            start_time_utc=START,
            duration_seconds=180,
            vehicles=(SimulatedVehicle(7, 707, 0),),
            long_extent_m=100,
            short_extent_m=50,
            period_seconds=180,
            orientation_deg=31,
        )

        detected = detect_figure_eight(samples)

        self.assertIsNotNone(detected)
        assert detected is not None
        route = detected.effective
        self.assertEqual(route.family, RouteFamily.SO)
        self.assertEqual(route.subtype, RouteSubtype.FIGURE_EIGHT)
        self.assertEqual(route.topology, RouteTopology.SELF_CROSSING)
        self.assertEqual(route.direction, Direction.UNKNOWN)
        self.assertAlmostEqual(route.estimated_period_s, 180.0, delta=3.0)
        self.assertAlmostEqual(route.orientation_deg, 31.0, delta=5.0)
        self.assertAlmostEqual(detected.crossing_angle_deg, 90.0, delta=5.0)
        self.assertAlmostEqual(
            (detected.crossing_time_utc - detected.cycle_start_utc).total_seconds(),
            90.0,
            delta=2.0,
        )
        self.assertAlmostEqual(
            (detected.cycle_end_utc - detected.cycle_start_utc).total_seconds(),
            180.0,
            delta=2.0,
        )
        self.assertGreaterEqual(detected.fit_fraction, 0.90)
        self.assertEqual(detected.coverage_fraction, 1.0)

    def test_one_lobe_is_not_enough_to_confirm_figure_eight(self) -> None:
        samples = generate_figure_eight_samples(
            start_time_utc=START,
            duration_seconds=90,
            vehicles=(SimulatedVehicle(7, 707, 0),),
            period_seconds=180,
        )
        self.assertIsNone(detect_figure_eight(samples))

    def test_double_hippodrome_is_not_figure_eight(self) -> None:
        samples = generate_double_hippodrome_samples(
            start_time_utc=START,
            duration_seconds=180,
            vehicles=(SimulatedVehicle(7, 707, 0),),
            single_long_axis_m=80,
            short_axis_m=20,
            single_period_seconds=90,
        )
        self.assertIsNone(detect_figure_eight(samples))

    def test_si_circle_is_not_figure_eight(self) -> None:
        samples = generate_si_circle_samples(
            start_time_utc=START,
            duration_seconds=180,
            vehicles=(SimulatedVehicle(7, 707, 0),),
            radius_m=80,
            period_seconds=90,
        )
        self.assertIsNone(detect_figure_eight(samples))


if __name__ == "__main__":
    unittest.main()
