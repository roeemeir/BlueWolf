from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core import application_analysis as base
from bluewolf_core.application_analysis_v21 import _normalized_signed_area, _topology_kind_v21
from bluewolf_core.v08_core import Point2D, RouteShape, classify_route


START = datetime(2026, 9, 7, tzinfo=UTC)


def _line(a: tuple[float, float], b: tuple[float, float], count: int) -> list[tuple[float, float]]:
    return [
        (a[0] + (b[0] - a[0]) * index / max(1, count - 1), a[1] + (b[1] - a[1]) * index / max(1, count - 1))
        for index in range(count)
    ]


def _figure8() -> list[tuple[float, float]]:
    left_x, right_x, radius = -100.0, 100.0, 30.0
    first_leg = _line((left_x, radius), (right_x, -radius), 36)
    right_turn = [
        (right_x + radius * math.cos(angle), radius * math.sin(angle))
        for angle in (-math.pi / 2 + math.pi * index / 39 for index in range(40))
    ]
    second_leg = _line((right_x, radius), (left_x, -radius), 36)
    left_turn = [
        (left_x + radius * math.cos(angle), radius * math.sin(angle))
        for angle in (-math.pi / 2 - math.pi * index / 39 for index in range(40))
    ]
    return first_leg + right_turn + second_leg + left_turn


def _single_with_incidental_crossing() -> list[tuple[float, float]]:
    # Mostly one ordinary elongated closed loop. The short inward excursion on
    # the top leg crosses the later bottom leg, deliberately producing a
    # segment-intersection signal without turning the route into two lobes.
    top = _line((-100.0, 30.0), (-20.0, 30.0), 18)
    glitch = [(0.0, -45.0), (20.0, 30.0)]
    top_rest = _line((20.0, 30.0), (100.0, 30.0), 18)[1:]
    right = _line((100.0, 30.0), (100.0, -30.0), 18)[1:]
    bottom = _line((100.0, -30.0), (-100.0, -30.0), 36)[1:]
    left = _line((-100.0, -30.0), (-100.0, 30.0), 18)[1:]
    return top + glitch + top_rest + right + bottom + left


def _double() -> list[tuple[float, float]]:
    return [
        (-178, 18), (-168, -34), (-132, -76), (-82, -88), (-43, -58), (-17, -25),
        (0, -10), (23, -36), (63, -75), (116, -83), (166, -47), (184, 4),
        (166, 53), (116, 84), (65, 72), (28, 39), (3, 14), (-22, 38),
        (-63, 80), (-118, 89), (-163, 62),
    ]


def _samples(points: list[tuple[float, float]]) -> list[dict]:
    samples: list[dict] = []
    for index, (x, y) in enumerate(points):
        nx, ny = points[(index + 1) % len(points)]
        samples.append({
            "timestamp": (START + timedelta(seconds=index)).isoformat().replace("+00:00", "Z"),
            "vehicleId": 101,
            "active": True,
            "x": x,
            "y": y,
            "velocityEast": nx - x,
            "velocityNorth": ny - y,
            "latitude": 31.8,
            "longitude": 34.8,
            "altitude": 0.0,
        })
    return samples


class TopologyRefinementV21Tests(unittest.TestCase):
    def test_true_crossed_leg_hippodrome_keeps_figure8_semantics(self) -> None:
        samples = _samples(_figure8())
        fit = base._pca(samples)
        self.assertLessEqual(_normalized_signed_area(samples), 0.012)
        self.assertEqual(_topology_kind_v21(samples, fit), "figure8")

    def test_incidental_intersection_with_material_enclosed_area_is_not_figure8(self) -> None:
        points = _single_with_incidental_crossing()
        samples = _samples(points)
        fit = base._pca(samples)
        legacy = classify_route((Point2D(x, y) for x, y in points), 120.0)
        self.assertEqual(legacy.shape, RouteShape.FIGURE_EIGHT)
        self.assertGreater(_normalized_signed_area(samples), 0.012)
        self.assertEqual(_topology_kind_v21(samples, fit), "single")

    def test_articulated_double_remains_double(self) -> None:
        samples = _samples(_double())
        fit = base._pca(samples)
        self.assertEqual(_topology_kind_v21(samples, fit), "double")


if __name__ == "__main__":
    unittest.main()
