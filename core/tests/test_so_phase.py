from __future__ import annotations

import math
import unittest

from bluewolf_core.geometry import closed_polyline_length, project_onto_closed_polyline
from bluewolf_core.models import (
    CanonicalPoint,
    ClosedRoute,
    Direction,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
)
from bluewolf_core.so_phase import (
    AmbiguousSOPhaseProjection,
    UnsupportedSOPhaseGeometry,
    build_so_phase_frame,
    normalize_so_phase,
    project_so_semantic_phase_local,
)


def _route(
    route_id: str,
    points: tuple[CanonicalPoint, ...],
    *,
    orientation_deg: float = 0.0,
    family: RouteFamily = RouteFamily.SO,
    subtype: RouteSubtype = RouteSubtype.HIPPODROME,
    topology: RouteTopology = RouteTopology.SIMPLE,
) -> ClosedRoute:
    return ClosedRoute(
        route_id=route_id,
        family=family,
        subtype=subtype,
        topology=topology,
        canonical_points=points,
        center_latitude_deg=32.0,
        center_longitude_deg=34.8,
        length_m=closed_polyline_length(points),
        long_axis_a_m=10.0,
        short_axis_b_m=4.0,
        orientation_deg=orientation_deg,
        estimated_period_s=120.0,
        direction=Direction.UNKNOWN,
        detection_quality=1.0,
    )


def _diamond() -> tuple[CanonicalPoint, ...]:
    return (
        CanonicalPoint(10.0, 0.0),
        CanonicalPoint(0.0, 4.0),
        CanonicalPoint(-10.0, 0.0),
        CanonicalPoint(0.0, -4.0),
    )


def _figure_eight() -> tuple[CanonicalPoint, ...]:
    return (
        CanonicalPoint(8.0, 0.0),
        CanonicalPoint(4.0, 3.0),
        CanonicalPoint(0.0, 0.0),
        CanonicalPoint(-4.0, 3.0),
        CanonicalPoint(-8.0, 0.0),
        CanonicalPoint(-4.0, -3.0),
        CanonicalPoint(0.0, 0.0),
        CanonicalPoint(4.0, -3.0),
    )


def _figure_eight_route() -> ClosedRoute:
    return _route(
        "figure8",
        _figure_eight(),
        subtype=RouteSubtype.FIGURE_EIGHT,
        topology=RouteTopology.SELF_CROSSING,
    )


def _raw_phase(route: ClosedRoute, point: CanonicalPoint) -> float:
    return project_onto_closed_polyline(route.canonical_points, point).phase


def _semantic_at(route: ClosedRoute, point: CanonicalPoint) -> float:
    return normalize_so_phase(route, _raw_phase(route, point))


def _rotated_diamond(angle_deg: float) -> tuple[CanonicalPoint, ...]:
    angle = math.radians(angle_deg)
    u = (math.cos(angle), math.sin(angle))
    v = (-math.sin(angle), math.cos(angle))
    return (
        CanonicalPoint(10.0 * u[0], 10.0 * u[1]),
        CanonicalPoint(4.0 * v[0], 4.0 * v[1]),
        CanonicalPoint(-10.0 * u[0], -10.0 * u[1]),
        CanonicalPoint(-4.0 * v[0], -4.0 * v[1]),
    )


class SOPhaseNormalizationTests(unittest.TestCase):
    def test_hard_geometry_frame_maps_cardinal_quarters(self) -> None:
        route = _route("r", _diamond())
        self.assertAlmostEqual(_semantic_at(route, CanonicalPoint(10.0, 0.0)), 0.0)
        self.assertAlmostEqual(_semantic_at(route, CanonicalPoint(0.0, 4.0)), 0.25)
        self.assertAlmostEqual(_semantic_at(route, CanonicalPoint(-10.0, 0.0)), 0.50)
        self.assertAlmostEqual(_semantic_at(route, CanonicalPoint(0.0, -4.0)), 0.75)

    def test_reversing_polyline_order_preserves_semantic_phase(self) -> None:
        forward = _route("forward", _diamond())
        reversed_route = _route(
            "reversed",
            (
                CanonicalPoint(10.0, 0.0),
                CanonicalPoint(0.0, -4.0),
                CanonicalPoint(-10.0, 0.0),
                CanonicalPoint(0.0, 4.0),
            ),
        )
        for point in _diamond():
            with self.subTest(point=point):
                self.assertAlmostEqual(
                    _semantic_at(forward, point),
                    _semantic_at(reversed_route, point),
                )

    def test_cyclic_raw_zero_shift_does_not_change_semantic_phase(self) -> None:
        original = _route("original", _diamond())
        shifted = _route(
            "shifted",
            (
                CanonicalPoint(0.0, 4.0),
                CanonicalPoint(-10.0, 0.0),
                CanonicalPoint(0.0, -4.0),
                CanonicalPoint(10.0, 0.0),
            ),
        )
        frame = build_so_phase_frame(shifted)
        self.assertAlmostEqual(frame.anchor_phase, 0.75)
        for point in _diamond():
            with self.subTest(point=point):
                self.assertAlmostEqual(_semantic_at(original, point), _semantic_at(shifted, point))

    def test_reference_axis_aligns_route_instances_across_sign_boundary(self) -> None:
        first_angle = 134.9
        second_angle = 135.1
        first = _route("first", _rotated_diamond(first_angle), orientation_deg=first_angle)
        second = _route("second", _rotated_diamond(second_angle), orientation_deg=second_angle)

        first_frame = build_so_phase_frame(first)
        second_without_reference = build_so_phase_frame(second)
        second_frame = build_so_phase_frame(
            second,
            reference_major_axis=first_frame.major_axis,
        )

        standalone_dot = (
            first_frame.major_east * second_without_reference.major_east
            + first_frame.major_north * second_without_reference.major_north
        )
        aligned_dot = (
            first_frame.major_east * second_frame.major_east
            + first_frame.major_north * second_frame.major_north
        )
        self.assertLess(standalone_dot, 0.0)
        self.assertGreater(aligned_dot, 0.99)

        second_q0 = _rotated_diamond(second_angle)[0]
        raw = _raw_phase(second, second_q0)
        self.assertAlmostEqual(second_frame.normalize(raw), 0.0)

    def test_double_hippodrome_uses_same_semantic_frame_contract(self) -> None:
        route = _route(
            "double",
            _diamond(),
            subtype=RouteSubtype.DOUBLE_HIPPODROME,
            topology=RouteTopology.DOUBLE,
        )
        frame = build_so_phase_frame(route)
        self.assertAlmostEqual(frame.normalize(_raw_phase(route, CanonicalPoint(10.0, 0.0))), 0.0)

    def test_figure_eight_can_normalize_an_already_known_raw_phase(self) -> None:
        route = _figure_eight_route()
        frame = build_so_phase_frame(route)
        self.assertAlmostEqual(frame.normalize(_raw_phase(route, CanonicalPoint(8.0, 0.0))), 0.0)

    def test_figure_eight_crossing_requires_heading(self) -> None:
        route = _figure_eight_route()
        with self.assertRaises(AmbiguousSOPhaseProjection):
            project_so_semantic_phase_local(route, CanonicalPoint(0.0, 0.0))

    def test_figure_eight_heading_selects_distinct_crossing_phases(self) -> None:
        route = _figure_eight_route()
        first_branch = project_so_semantic_phase_local(
            route,
            CanonicalPoint(0.0, 0.0),
            velocity_east_mps=-4.0,
            velocity_north_mps=3.0,
        )
        second_branch = project_so_semantic_phase_local(
            route,
            CanonicalPoint(0.0, 0.0),
            velocity_east_mps=4.0,
            velocity_north_mps=-3.0,
        )

        self.assertTrue(first_branch.heading_disambiguated)
        self.assertTrue(second_branch.heading_disambiguated)
        self.assertGreaterEqual(first_branch.candidate_count, 4)
        self.assertGreaterEqual(second_branch.candidate_count, 4)
        self.assertAlmostEqual(first_branch.heading_error_deg or 0.0, 0.0)
        self.assertAlmostEqual(second_branch.heading_error_deg or 0.0, 0.0)
        self.assertAlmostEqual(first_branch.semantic_phase, 0.25)
        self.assertAlmostEqual(second_branch.semantic_phase, 0.75)

    def test_figure_eight_position_only_is_valid_away_from_crossing(self) -> None:
        route = _figure_eight_route()
        result = project_so_semantic_phase_local(route, CanonicalPoint(-2.0, 1.5))
        self.assertFalse(result.heading_disambiguated)
        self.assertEqual(result.candidate_count, 1)
        self.assertAlmostEqual(result.semantic_phase, 0.3125)

    def test_simple_so_projection_does_not_require_velocity(self) -> None:
        route = _route("r", _diamond())
        result = project_so_semantic_phase_local(route, CanonicalPoint(10.0, 0.0))
        self.assertAlmostEqual(result.semantic_phase, 0.0)
        self.assertFalse(result.heading_disambiguated)

    def test_velocity_components_must_be_supplied_together(self) -> None:
        route = _route("r", _diamond())
        with self.assertRaises(ValueError):
            project_so_semantic_phase_local(
                route,
                CanonicalPoint(10.0, 0.0),
                velocity_east_mps=2.0,
            )

    def test_double_figure_eight_remains_explicitly_undefined(self) -> None:
        route = _route(
            "undefined",
            _diamond(),
            subtype=RouteSubtype.DOUBLE_FIGURE_EIGHT,
            topology=RouteTopology.SELF_CROSSING,
        )
        with self.assertRaises(UnsupportedSOPhaseGeometry):
            build_so_phase_frame(route)

    def test_non_so_route_is_rejected(self) -> None:
        route = _route(
            "si",
            _diamond(),
            family=RouteFamily.SI,
            subtype=RouteSubtype.COMPACT,
        )
        with self.assertRaises(UnsupportedSOPhaseGeometry):
            build_so_phase_frame(route)

    def test_zero_reference_axis_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            build_so_phase_frame(_route("r", _diamond()), reference_major_axis=(0.0, 0.0))

    def test_raw_phase_must_be_finite(self) -> None:
        frame = build_so_phase_frame(_route("r", _diamond()))
        with self.assertRaises(ValueError):
            frame.normalize(float("nan"))


if __name__ == "__main__":
    unittest.main()
