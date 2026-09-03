from __future__ import annotations

import math
import unittest

from bluewolf_core import (
    circular_phase_distance,
    closed_polyline_length,
    curvature_at_phase,
    normalized_curvature_error,
    point_at_phase,
    project_onto_closed_polyline,
    resample_closed_polyline,
    tangent_error_deg,
)
from bluewolf_core.geometry import local_m_to_wgs84, wgs84_to_local_m
from bluewolf_core.models import CanonicalPoint


SQUARE = (
    CanonicalPoint(0, 0),
    CanonicalPoint(10, 0),
    CanonicalPoint(10, 10),
    CanonicalPoint(0, 10),
)


class ClosedGeometryTests(unittest.TestCase):
    def test_phase_is_arc_length_not_point_index(self) -> None:
        point, segment, fraction = point_at_phase(SQUARE, 0.125)
        self.assertEqual(point, CanonicalPoint(5, 0))
        self.assertEqual(segment, 0)
        self.assertEqual(fraction, 0.5)
        self.assertEqual(closed_polyline_length(SQUARE), 40)

    def test_projection_returns_phase_distance_and_tangent(self) -> None:
        projection = project_onto_closed_polyline(SQUARE, CanonicalPoint(5, 2))
        self.assertAlmostEqual(projection.phase, 0.125)
        self.assertAlmostEqual(projection.distance_m, 2)
        self.assertEqual(projection.projected, CanonicalPoint(5, 0))
        self.assertEqual((projection.tangent_east, projection.tangent_north), (1, 0))

    def test_closing_segment_is_part_of_the_same_cycle(self) -> None:
        projection = project_onto_closed_polyline(SQUARE, CanonicalPoint(-2, 5))
        self.assertAlmostEqual(projection.phase, 0.875)
        self.assertAlmostEqual(projection.distance_m, 2)
        self.assertEqual((projection.tangent_east, projection.tangent_north), (0, -1))

    def test_resampling_produces_uniform_arc_length_points(self) -> None:
        points = resample_closed_polyline(SQUARE, 8)
        self.assertEqual(
            points,
            (
                CanonicalPoint(0, 0),
                CanonicalPoint(5, 0),
                CanonicalPoint(10, 0),
                CanonicalPoint(10, 5),
                CanonicalPoint(10, 10),
                CanonicalPoint(5, 10),
                CanonicalPoint(0, 10),
                CanonicalPoint(0, 5),
            ),
        )

    def test_phase_distance_wraps_at_cycle_boundary(self) -> None:
        self.assertAlmostEqual(circular_phase_distance(0.98, 0.02), 0.04)
        self.assertAlmostEqual(circular_phase_distance(0.2, 0.7), 0.5)

    def test_tangent_error_honors_phase_direction(self) -> None:
        projection = project_onto_closed_polyline(SQUARE, CanonicalPoint(5, 1))
        self.assertEqual(tangent_error_deg(projection, 10, 0, phase_sign=1), 0)
        self.assertEqual(tangent_error_deg(projection, 10, 0, phase_sign=-1), 180)

    def test_curvature_error_is_invariant_to_route_scale(self) -> None:
        small = normalized_curvature_error(0.15, 0.10, 2 * math.pi * 10)
        large = normalized_curvature_error(0.015, 0.010, 2 * math.pi * 100)
        self.assertAlmostEqual(small, 0.5)
        self.assertAlmostEqual(large, 0.5)

    def test_polygon_curvature_approximates_its_circle(self) -> None:
        circle = tuple(
            CanonicalPoint(10 * math.cos(2 * math.pi * index / 64), 10 * math.sin(2 * math.pi * index / 64))
            for index in range(64)
        )
        self.assertAlmostEqual(abs(curvature_at_phase(circle, 0.2)), 0.1, delta=0.005)

    def test_local_projection_round_trip_is_stable(self) -> None:
        original = CanonicalPoint(123.4, -56.7)
        latitude, longitude = local_m_to_wgs84(original, 31.8, 34.8)
        reconstructed = wgs84_to_local_m(latitude, longitude, 31.8, 34.8)
        self.assertAlmostEqual(reconstructed.x_m, original.x_m, places=6)
        self.assertAlmostEqual(reconstructed.y_m, original.y_m, places=6)


if __name__ == "__main__":
    unittest.main()
