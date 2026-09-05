from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core import RouteSubtype, RouteTopology, VehicleSample, detect_closed_route
from bluewolf_core.geometry import local_m_to_wgs84


START = datetime(2026, 1, 1, tzinfo=UTC)
ORIGIN_LAT = 31.8
ORIGIN_LON = 34.8


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _point_on_loop(points: list[tuple[float, float]], phase: float) -> tuple[float, float]:
    lengths = [_distance(points[i], points[(i + 1) % len(points)]) for i in range(len(points))]
    total = sum(lengths)
    target = (phase % 1.0) * total
    for i, length in enumerate(lengths):
        if target <= length or i == len(lengths) - 1:
            a, b = points[i], points[(i + 1) % len(points)]
            ratio = 0.0 if length == 0 else min(1.0, max(0.0, target / length))
            return a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio
        target -= length
    return points[0]


def _samples(points: list[tuple[float, float]], *, period_s: float = 120.0, duration_s: int = 360) -> tuple[VehicleSample, ...]:
    output: list[VehicleSample] = []
    for second in range(0, duration_s + 1, 2):
        x, y = _point_on_loop(points, second / period_s)
        lat, lon = local_m_to_wgs84(
            # local_m_to_wgs84 accepts a CanonicalPoint through structural data
            # only at runtime, so import lazily to keep this helper readable.
            __import__("bluewolf_core.models", fromlist=["CanonicalPoint"]).CanonicalPoint(x, y),
            ORIGIN_LAT,
            ORIGIN_LON,
        )
        next_x, next_y = _point_on_loop(points, (second + 0.5) / period_s)
        output.append(VehicleSample(
            sample_time_utc=START + timedelta(seconds=second),
            server_id=1,
            vehicle_number=1,
            vehicle_identifier=101,
            active=True,
            latitude_deg=lat,
            longitude_deg=lon,
            velocity_east_mps=(next_x - x) / 0.5,
            velocity_north_mps=(next_y - y) / 0.5,
            reliability=1.0,
        ))
    return tuple(output)


def _double_so() -> list[tuple[float, float]]:
    # One continuous articulated dog-bone with a narrow waist. No crossing.
    return [
        (-178, 18), (-168, -34), (-132, -76), (-82, -88), (-43, -58), (-17, -25),
        (0, -10), (23, -36), (63, -75), (116, -83), (166, -47), (184, 4),
        (166, 53), (116, 84), (65, 72), (28, 39), (3, 14), (-22, 38),
        (-63, 80), (-118, 89), (-163, 62),
    ]


def _figure_eight(count: int = 120) -> list[tuple[float, float]]:
    return [
        (145.0 * math.sin(t), 75.0 * math.sin(2.0 * t))
        for t in (2.0 * math.pi * i / count for i in range(count))
    ]


class ProductionTopologyIntegrationTests(unittest.TestCase):
    def test_continuous_double_so_is_not_flattened_to_single_hippodrome(self) -> None:
        detection = detect_closed_route(_samples(_double_so(), period_s=140, duration_s=420))
        self.assertIsNotNone(detection)
        assert detection is not None
        self.assertEqual(detection.effective.subtype, RouteSubtype.DOUBLE_HIPPODROME)
        self.assertEqual(detection.effective.topology, RouteTopology.DOUBLE)
        self.assertLessEqual(len(detection.effective.canonical_points), 64)
        self.assertGreaterEqual(detection.fit_fraction, 0.75)

    def test_figure_eight_keeps_self_crossing_topology(self) -> None:
        detection = detect_closed_route(_samples(_figure_eight(), period_s=120, duration_s=360))
        self.assertIsNotNone(detection)
        assert detection is not None
        self.assertEqual(detection.effective.subtype, RouteSubtype.FIGURE_EIGHT)
        self.assertEqual(detection.effective.topology, RouteTopology.SELF_CROSSING)
        self.assertLessEqual(len(detection.effective.canonical_points), 64)
        self.assertGreaterEqual(detection.fit_fraction, 0.75)


if __name__ == "__main__":
    unittest.main()
