from __future__ import annotations

import unittest
from datetime import UTC, datetime

from bluewolf_core import Direction, RouteFamily, RouteSubtype, RouteTopology
from bluewolf_core.double_hippodrome import detect_double_hippodrome
from bluewolf_core.simulator import (
    SimulatedVehicle,
    generate_double_hippodrome_samples,
    generate_si_circle_samples,
)


class DoubleHippodromeDetectionTests(unittest.TestCase):
    def test_rotated_double_is_confirmed_from_two_opposite_winding_lobes(self) -> None:
        samples = generate_double_hippodrome_samples(
            start_time_utc=datetime(2026, 1, 1, tzinfo=UTC),
            duration_seconds=180,
            vehicles=(SimulatedVehicle(7, 707, 0),),
            single_long_axis_m=80,
            short_axis_m=20,
            single_period_seconds=90,
            orientation_deg=27,
        )

        detected = detect_double_hippodrome(samples)

        self.assertIsNotNone(detected)
        assert detected is not None
        self.assertEqual(detected.effective.family, RouteFamily.SO)
        self.assertEqual(detected.effective.subtype, RouteSubtype.DOUBLE_HIPPODROME)
        self.assertEqual(detected.effective.topology, RouteTopology.DOUBLE)
        self.assertEqual(detected.effective.direction, Direction.UNKNOWN)
        self.assertAlmostEqual(detected.effective.estimated_period_s, 180.0, delta=10.0)
        self.assertAlmostEqual(detected.effective.orientation_deg, 27.0, delta=6.0)
        self.assertGreaterEqual(detected.fit_fraction, 0.78)
        self.assertGreaterEqual(detected.coverage_fraction, 0.82)
        self.assertNotEqual(detected.lobes[0].direction, detected.lobes[1].direction)
        self.assertAlmostEqual(
            (detected.connection_time_utc - detected.cycle_start_utc).total_seconds(),
            90.0,
            delta=2.0,
        )
        self.assertAlmostEqual(
            (detected.cycle_end_utc - detected.connection_time_utc).total_seconds(),
            90.0,
            delta=2.0,
        )

    def test_one_lobe_is_not_enough_to_confirm_double(self) -> None:
        samples = generate_double_hippodrome_samples(
            start_time_utc=datetime(2026, 1, 1, tzinfo=UTC),
            duration_seconds=90,
            vehicles=(SimulatedVehicle(7, 707, 0),),
            single_long_axis_m=80,
            short_axis_m=20,
            single_period_seconds=90,
        )

        self.assertIsNone(detect_double_hippodrome(samples))

    def test_si_cycle_cannot_fake_double_topology(self) -> None:
        samples = generate_si_circle_samples(
            start_time_utc=datetime(2026, 1, 1, tzinfo=UTC),
            duration_seconds=200,
            vehicles=(SimulatedVehicle(7, 707, 0),),
            radius_m=80,
            period_seconds=90,
        )

        self.assertIsNone(detect_double_hippodrome(samples))


if __name__ == "__main__":
    unittest.main()
