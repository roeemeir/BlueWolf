from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core.application_analysis_v22 import analyze_navigation_dataset


START = datetime(2026, 9, 7, 0, 0, tzinfo=UTC)


def _config() -> dict:
    return {
        "thresholds": {},
        "weights": {},
        "groupingSettings": {"maxParallelLegs": 1.5, "maxLateralLegs": 0.35, "maxAngleDeg": 20},
    }


def _line(a: tuple[float, float], b: tuple[float, float], count: int) -> list[tuple[float, float]]:
    return [
        (a[0] + (b[0] - a[0]) * index / max(1, count - 1), a[1] + (b[1] - a[1]) * index / max(1, count - 1))
        for index in range(count)
    ]


def _arc(center: tuple[float, float], radius: float, start: float, end: float, count: int) -> list[tuple[float, float]]:
    return [
        (
            center[0] + radius * math.cos(start + (end - start) * index / max(1, count - 1)),
            center[1] + radius * math.sin(start + (end - start) * index / max(1, count - 1)),
        )
        for index in range(count)
    ]


def _figure8_points() -> list[tuple[float, float]]:
    left_x, right_x, radius = -100.0, 100.0, 30.0
    return (
        _line((left_x, radius), (right_x, -radius), 42)
        + _arc((right_x, 0.0), radius, -math.pi / 2, math.pi / 2, 42)[1:]
        + _line((right_x, radius), (left_x, -radius), 42)[1:]
        + _arc((left_x, 0.0), radius, -math.pi / 2, -3 * math.pi / 2, 42)[1:]
    )


def _non_crossing_bent_points() -> list[tuple[float, float]]:
    """A continuous bent SO loop that stays about one radius from its centre."""
    radius = 28.0
    left = (-120.0, 0.0)
    right = (105.0, 55.0)
    top_left = (left[0], radius)
    top_mid = (0.0, radius)
    top_right = (right[0], right[1] + radius)
    bottom_right = (right[0], right[1] - radius)
    bottom_mid = (0.0, -radius)
    bottom_left = (left[0], -radius)
    return (
        _line(top_left, top_mid, 24)
        + _line(top_mid, top_right, 24)[1:]
        + _arc(right, radius, math.pi / 2, -math.pi / 2, 36)[1:]
        + _line(bottom_right, bottom_mid, 24)[1:]
        + _line(bottom_mid, bottom_left, 24)[1:]
        + _arc(left, radius, -math.pi / 2, -3 * math.pi / 2, 36)[1:]
    )


def _point_on_polyline(points: list[tuple[float, float]], phase: float) -> tuple[float, float]:
    lengths = [
        math.hypot(points[(index + 1) % len(points)][0] - points[index][0], points[(index + 1) % len(points)][1] - points[index][1])
        for index in range(len(points))
    ]
    total = sum(lengths)
    target = (phase % 1.0) * total
    for index, length in enumerate(lengths):
        if target <= length or index == len(lengths) - 1:
            a = points[index]
            b = points[(index + 1) % len(points)]
            ratio = target / max(length, 1e-9)
            return a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio
        target -= length
    return points[0]


def _dataset(points: list[tuple[float, float]], vehicle_id: int = 611) -> dict:
    samples: list[dict] = []
    period = 180.0
    for second in range(0, 361, 2):
        timestamp = START + timedelta(seconds=second)
        phase = second / period
        x, y = _point_on_polyline(points, phase)
        nx, ny = _point_on_polyline(points, phase + 0.25 / period)
        samples.append({
            "source": "simulation",
            "serverId": "3",
            "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
            "vehicleId": vehicle_id,
            "active": True,
            "latitude": 31.8 + y / 111_320.0,
            "longitude": 34.8 + x / (111_320.0 * math.cos(math.radians(31.8))),
            "altitude": None,
            "velocityNorth": (ny - y) / 0.25,
            "velocityEast": (nx - x) / 0.25,
            "x": x,
            "y": y,
        })
    return {
        "samples": samples,
        "provenance": {
            "source": "simulation",
            "serverId": "3",
            "from": samples[0]["timestamp"],
            "to": samples[-1]["timestamp"],
            "latestSampleAt": samples[-1]["timestamp"],
            "sampleCount": len(samples),
            "vehicleCount": 1,
            "samplingMedianSeconds": 2.0,
            "completenessPct": 100.0,
            "freshnessSeconds": 0.0,
            "warnings": [],
        },
    }


class StructuralTopologyV22Tests(unittest.TestCase):
    def test_crossed_leg_hippodrome_still_classifies_as_figure8(self) -> None:
        analysis = analyze_navigation_dataset(_dataset(_figure8_points()), _config())
        self.assertEqual(analysis["routes"][0]["kind"], "figure8")

    def test_non_crossing_bent_route_is_not_promoted_to_figure8(self) -> None:
        analysis = analyze_navigation_dataset(_dataset(_non_crossing_bent_points()), _config())
        self.assertNotEqual(analysis["routes"][0]["kind"], "figure8")


if __name__ == "__main__":
    unittest.main()
