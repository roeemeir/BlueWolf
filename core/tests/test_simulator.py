from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime

from bluewolf_core import Direction, FieldQuality
from bluewolf_core.simulator import SimulatedVehicle, generate_si_circle_samples


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


if __name__ == "__main__":
    unittest.main()
