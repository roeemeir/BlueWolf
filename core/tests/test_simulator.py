from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime

from bluewolf_core import Direction, FieldQuality
from bluewolf_core.simulator import (
    EARTH_RADIUS_M,
    SimulatedVehicle,
    SimulatedWind,
    generate_si_circle_samples,
    wind_vector_mps,
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

    def test_gust_component_is_deterministic_and_time_varying(self) -> None:
        wind = SimulatedWind(
            steady_north_mps=1.0,
            steady_east_mps=2.0,
            gust_amplitude_mps=4.0,
            gust_period_seconds=20.0,
            gust_bearing_deg=90.0,
        )
        self.assertEqual(wind_vector_mps(wind, 5.0), wind_vector_mps(wind, 5.0))
        north0, east0 = wind_vector_mps(wind, 0.0)
        north5, east5 = wind_vector_mps(wind, 5.0)
        self.assertAlmostEqual(north0, 1.0, places=6)
        self.assertAlmostEqual(east0, 2.0, places=6)
        self.assertAlmostEqual(north5, 1.0, places=6)
        self.assertAlmostEqual(east5, 6.0, places=6)

    def test_wind_disturbance_changes_navigation_and_sync_geometry(self) -> None:
        center_lat = 31.8
        center_lon = 34.8
        vehicles = (
            SimulatedVehicle(1, 101, 0, wind_response_gain=0.6),
            SimulatedVehicle(2, 102, 180, wind_response_gain=1.4),
        )
        common = {
            "start_time_utc": datetime(2026, 1, 1, tzinfo=UTC),
            "duration_seconds": 0,
            "vehicles": vehicles,
            "center_latitude_deg": center_lat,
            "center_longitude_deg": center_lon,
            "radius_m": 100.0,
            "period_seconds": 120.0,
        }
        clean = generate_si_circle_samples(**common)
        disturbed = generate_si_circle_samples(
            **common,
            wind=SimulatedWind(
                steady_north_mps=8.0,
                position_response_seconds=3.0,
                velocity_coupling=0.4,
            ),
        )

        self.assertNotEqual(clean, disturbed)
        self.assertGreater(
            disturbed[0].velocity_north_mps - clean[0].velocity_north_mps,
            1.0,
        )

        center_lat_rad = math.radians(center_lat)

        def phase_deg(sample) -> float:
            north_m = math.radians(sample.latitude_deg - center_lat) * EARTH_RADIUS_M
            east_m = (
                math.radians(sample.longitude_deg - center_lon)
                * EARTH_RADIUS_M
                * math.cos(center_lat_rad)
            )
            return math.degrees(math.atan2(north_m, east_m)) % 360.0

        clean_delta = abs((phase_deg(clean[0]) - phase_deg(clean[1]) + 180.0) % 360.0 - 180.0)
        disturbed_delta = abs((phase_deg(disturbed[0]) - phase_deg(disturbed[1]) + 180.0) % 360.0 - 180.0)
        self.assertAlmostEqual(clean_delta, 180.0, places=4)
        self.assertLess(disturbed_delta, 175.0)


if __name__ == "__main__":
    unittest.main()
