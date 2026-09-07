from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime

from bluewolf_core import Direction, FieldQuality
from bluewolf_core.geometry import wgs84_to_local_m
from bluewolf_core.simulator import (
    SimulatedVehicle,
    generate_double_hippodrome_samples,
    generate_si_circle_samples,
)


class SimulatorTests(unittest.TestCase):
    def test_same_seed_produces_identical_samples(self) -> None:
        arguments = {
            "start_time_utc": datetime(2026, 1, 1, tzinfo=UTC),
            "duration_seconds": 10,
            "vehicles": (SimulatedVehicle(1, 101, 0),),
            "position_noise_std_m": 2.0,
            "seed": 123,
        }
        self.assertEqual(
            generate_si_circle_samples(**arguments),
            generate_si_circle_samples(**arguments),
        )

    def test_generator_includes_both_ends_and_marks_original_fields(self) -> None:
        samples = generate_si_circle_samples(
            start_time_utc=datetime(2026, 1, 1, tzinfo=UTC),
            duration_seconds=10,
            sample_interval_seconds=5,
            vehicles=(SimulatedVehicle(1, 101, 0), SimulatedVehicle(2, 102, 180)),
        )
        self.assertEqual(len(samples), 6)
        self.assertTrue(
            all(
                sample.field_quality["latitude_deg"] is FieldQuality.ORIGINAL
                for sample in samples
            )
        )

    def test_clockwise_velocity_is_tangent_to_the_circle(self) -> None:
        sample = generate_si_circle_samples(
            start_time_utc=datetime(2026, 1, 1, tzinfo=UTC),
            duration_seconds=0,
            direction=Direction.CLOCKWISE,
            vehicles=(SimulatedVehicle(1, 101, 0),),
            radius_m=100,
            period_seconds=100,
        )[0]
        self.assertAlmostEqual(sample.velocity_north_mps, -2 * math.pi, places=6)
        self.assertAlmostEqual(sample.velocity_east_mps, 0, places=6)

    def test_double_hippodrome_is_continuous_and_period_is_two_single_cycles(self) -> None:
        single_long_axis = 150.0
        short_axis = 40.0
        single_period = 240.0
        samples = generate_double_hippodrome_samples(
            start_time_utc=datetime(2026, 1, 1, tzinfo=UTC),
            duration_seconds=480,
            vehicles=(SimulatedVehicle(1, 101, 0),),
            single_long_axis_m=single_long_axis,
            short_axis_m=short_axis,
            single_period_seconds=single_period,
        )

        self.assertEqual(len(samples), 481)
        local = [
            wgs84_to_local_m(
                float(sample.latitude_deg),
                float(sample.longitude_deg),
                31.8,
                34.8,
            )
            for sample in samples
        ]
        # One single-lobe period returns to the shared middle connection, while
        # the full double period returns after both left and right lobes.
        self.assertLess(
            math.hypot(local[240].x_m - local[0].x_m, local[240].y_m - local[0].y_m),
            0.1,
        )
        self.assertLess(
            math.hypot(local[480].x_m - local[0].x_m, local[480].y_m - local[0].y_m),
            0.1,
        )
        self.assertLess(local[120].x_m, -100.0)
        self.assertGreater(local[360].x_m, 100.0)

        half_straight = single_long_axis - short_axis
        single_length = 4.0 * half_straight + 2.0 * math.pi * short_axis
        expected_speed = single_length / single_period
        for index in (1, 119, 239, 241, 359, 479):
            sample = samples[index]
            speed = math.hypot(
                float(sample.velocity_east_mps),
                float(sample.velocity_north_mps),
            )
            self.assertAlmostEqual(speed, expected_speed, delta=0.03)

        # No teleport is allowed at the middle-lobe transition.
        for first, second in ((239, 240), (240, 241)):
            step = math.hypot(
                local[second].x_m - local[first].x_m,
                local[second].y_m - local[first].y_m,
            )
            self.assertLess(step, expected_speed * 1.1)


if __name__ == "__main__":
    unittest.main()
