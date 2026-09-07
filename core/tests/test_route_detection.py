from __future__ import annotations

import math
import unittest
from dataclasses import replace
from datetime import UTC, datetime, timedelta

from bluewolf_core import (
    Direction,
    RouteFamily,
    RouteSubtype,
    detect_closed_route,
)
from bluewolf_core.geometry import local_m_to_wgs84, wgs84_to_local_m
from bluewolf_core.models import CanonicalPoint, VehicleSample
from bluewolf_core.simulator import SimulatedVehicle, generate_si_circle_samples


class RouteDetectionTests(unittest.TestCase):
    def test_si_circle_is_detected_and_transient_bump_does_not_bend_effective_route(self) -> None:
        samples = list(
            generate_si_circle_samples(
                start_time_utc=datetime(2026, 9, 1, tzinfo=UTC),
                duration_seconds=240,
                vehicles=(SimulatedVehicle(1, 101, 0),),
                radius_m=100,
                period_seconds=120,
                direction=Direction.CLOCKWISE,
            )
        )
        bump_index = 120
        original = samples[bump_index]
        local = wgs84_to_local_m(
            float(original.latitude_deg),
            float(original.longitude_deg),
            31.8,
            34.8,
        )
        bumped_lat, bumped_lon = local_m_to_wgs84(
            CanonicalPoint(local.x_m + 120.0, local.y_m),
            31.8,
            34.8,
        )
        samples[bump_index] = replace(
            original,
            latitude_deg=bumped_lat,
            longitude_deg=bumped_lon,
        )

        detected = detect_closed_route(samples)

        self.assertIsNotNone(detected)
        assert detected is not None
        self.assertEqual(detected.effective.family, RouteFamily.SI)
        self.assertEqual(detected.effective.subtype, RouteSubtype.COMPACT)
        self.assertEqual(detected.effective.direction, Direction.CLOCKWISE)
        self.assertEqual(detected.outlier_count, 1)
        self.assertGreater(
            detected.observed.long_axis_a_m,
            detected.effective.long_axis_a_m * 1.2,
        )
        self.assertAlmostEqual(detected.effective.long_axis_a_m, 100.0, delta=3.0)
        self.assertAlmostEqual(detected.effective.short_axis_b_m, 100.0, delta=3.0)
        self.assertAlmostEqual(detected.effective.estimated_period_s, 120.0, delta=4.0)
        self.assertGreaterEqual(detected.fit_fraction, 0.95)
        self.assertGreaterEqual(detected.coverage_fraction, 0.90)
        self.assertLess(
            float(detected.diagnostics["observation_seconds"]),
            300.0,
        )

    def test_rotated_hippodrome_is_detected_as_so(self) -> None:
        samples = _hippodrome_samples(
            long_axis_m=150,
            short_axis_m=40,
            period_s=240,
            cycles=2,
            orientation_deg=25,
        )

        detected = detect_closed_route(samples)

        self.assertIsNotNone(detected)
        assert detected is not None
        self.assertEqual(detected.effective.family, RouteFamily.SO)
        self.assertEqual(detected.effective.subtype, RouteSubtype.HIPPODROME)
        self.assertEqual(detected.effective.direction, Direction.COUNTERCLOCKWISE)
        self.assertGreater(
            detected.effective.long_axis_a_m / detected.effective.short_axis_b_m,
            1.5,
        )
        self.assertAlmostEqual(detected.effective.long_axis_a_m, 150.0, delta=7.0)
        self.assertAlmostEqual(detected.effective.short_axis_b_m, 40.0, delta=4.0)
        self.assertAlmostEqual(detected.effective.estimated_period_s, 240.0, delta=12.0)
        self.assertGreaterEqual(detected.fit_fraction, 0.90)
        self.assertGreaterEqual(detected.coverage_fraction, 0.90)

    def test_partial_route_is_candidate_but_not_confirmed(self) -> None:
        samples = generate_si_circle_samples(
            start_time_utc=datetime(2026, 9, 1, tzinfo=UTC),
            duration_seconds=115,
            vehicles=(SimulatedVehicle(1, 101, 0),),
            radius_m=100,
            period_seconds=120,
        )

        self.assertIsNone(detect_closed_route(samples))
        candidate = detect_closed_route(samples, require_confirmation=False)
        self.assertIsNotNone(candidate)
        assert candidate is not None
        self.assertGreaterEqual(candidate.coverage_fraction, 0.45)
        self.assertFalse(bool(candidate.diagnostics["confirmation_ready"]))

    def test_sub_five_minute_route_is_confirmed_without_fixed_wait(self) -> None:
        samples = generate_si_circle_samples(
            start_time_utc=datetime(2026, 9, 1, tzinfo=UTC),
            duration_seconds=240,
            vehicles=(SimulatedVehicle(1, 101, 0),),
            radius_m=100,
            period_seconds=120,
        )

        detected = detect_closed_route(samples)
        self.assertIsNotNone(detected)
        assert detected is not None
        self.assertLess(float(detected.diagnostics["observation_seconds"]), 300.0)
        self.assertGreaterEqual(detected.coverage_fraction, 0.82)
        self.assertTrue(bool(detected.diagnostics["closure_ok"]))

    def test_center_is_stable_for_non_integer_cycle_window(self) -> None:
        center_lat = 31.8123
        center_lon = 34.7456
        samples = generate_si_circle_samples(
            start_time_utc=datetime(2026, 9, 1, tzinfo=UTC),
            duration_seconds=150,
            vehicles=(SimulatedVehicle(1, 101, 0),),
            center_latitude_deg=center_lat,
            center_longitude_deg=center_lon,
            radius_m=100,
            period_seconds=120,
            direction=Direction.COUNTERCLOCKWISE,
        )

        detected = detect_closed_route(samples)

        self.assertIsNotNone(detected)
        assert detected is not None
        offset = wgs84_to_local_m(
            detected.effective.center_latitude_deg,
            detected.effective.center_longitude_deg,
            center_lat,
            center_lon,
        )
        self.assertLess(math.hypot(offset.x_m, offset.y_m), 3.0)
        canonical_center_x = sum(
            point.x_m for point in detected.effective.canonical_points
        ) / len(detected.effective.canonical_points)
        canonical_center_y = sum(
            point.y_m for point in detected.effective.canonical_points
        ) / len(detected.effective.canonical_points)
        self.assertAlmostEqual(canonical_center_x, 0.0, places=6)
        self.assertAlmostEqual(canonical_center_y, 0.0, places=6)

    def test_long_cycle_uses_geometry_instead_of_short_fixed_timer(self) -> None:
        samples = generate_si_circle_samples(
            start_time_utc=datetime(2026, 9, 1, tzinfo=UTC),
            duration_seconds=930,
            vehicles=(SimulatedVehicle(1, 101, 0),),
            radius_m=100,
            period_seconds=900,
        )

        early = tuple(samples[:300])
        self.assertIsNone(detect_closed_route(early))
        detected = detect_closed_route(samples)
        self.assertIsNotNone(detected)
        assert detected is not None
        self.assertAlmostEqual(detected.effective.estimated_period_s, 900.0, delta=20.0)
        self.assertGreaterEqual(detected.coverage_fraction, 0.90)

    def test_detector_rejects_mixed_vehicle_streams(self) -> None:
        samples = list(
            generate_si_circle_samples(
                start_time_utc=datetime(2026, 9, 1, tzinfo=UTC),
                duration_seconds=120,
                vehicles=(
                    SimulatedVehicle(1, 101, 0),
                    SimulatedVehicle(2, 102, 120),
                ),
            )
        )
        with self.assertRaises(ValueError):
            detect_closed_route(samples)


def _hippodrome_samples(
    *,
    long_axis_m: float,
    short_axis_m: float,
    period_s: int,
    cycles: int,
    orientation_deg: float,
) -> tuple[VehicleSample, ...]:
    center_lat = 31.8
    center_lon = 34.8
    orientation = math.radians(orientation_deg)
    perimeter = 4.0 * (long_axis_m - short_axis_m) + 2.0 * math.pi * short_axis_m
    speed = perimeter / period_s
    start = datetime(2026, 9, 1, tzinfo=UTC)
    output = []

    for second in range(period_s * cycles + 1):
        distance = speed * second
        local = _stadium_point_at_distance(
            distance,
            long_axis_m=long_axis_m,
            radius_m=short_axis_m,
        )
        next_local = _stadium_point_at_distance(
            distance + speed,
            long_axis_m=long_axis_m,
            radius_m=short_axis_m,
        )
        point = _rotate(local, orientation)
        next_point = _rotate(next_local, orientation)
        latitude, longitude = local_m_to_wgs84(point, center_lat, center_lon)
        output.append(
            VehicleSample(
                sample_time_utc=start + timedelta(seconds=second),
                server_id=1,
                vehicle_number=7,
                vehicle_identifier=707,
                active=True,
                latitude_deg=latitude,
                longitude_deg=longitude,
                velocity_north_mps=next_point.y_m - point.y_m,
                velocity_east_mps=next_point.x_m - point.x_m,
                reliability=1.0,
            )
        )
    return tuple(output)


def _stadium_point_at_distance(
    distance_m: float,
    *,
    long_axis_m: float,
    radius_m: float,
) -> CanonicalPoint:
    half_straight = long_axis_m - radius_m
    turn = math.pi * radius_m
    straight = 2.0 * half_straight
    perimeter = 2.0 * turn + 2.0 * straight
    distance = distance_m % perimeter

    if distance < turn:
        angle = -math.pi / 2.0 + distance / radius_m
        return CanonicalPoint(
            half_straight + radius_m * math.cos(angle),
            radius_m * math.sin(angle),
        )
    distance -= turn

    if distance < straight:
        return CanonicalPoint(
            half_straight - distance,
            radius_m,
        )
    distance -= straight

    if distance < turn:
        angle = math.pi / 2.0 + distance / radius_m
        return CanonicalPoint(
            -half_straight + radius_m * math.cos(angle),
            radius_m * math.sin(angle),
        )
    distance -= turn

    return CanonicalPoint(
        -half_straight + distance,
        -radius_m,
    )


def _rotate(point: CanonicalPoint, angle_rad: float) -> CanonicalPoint:
    cosine = math.cos(angle_rad)
    sine = math.sin(angle_rad)
    return CanonicalPoint(
        point.x_m * cosine - point.y_m * sine,
        point.x_m * sine + point.y_m * cosine,
    )


if __name__ == "__main__":
    unittest.main()
