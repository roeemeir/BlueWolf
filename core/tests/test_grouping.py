from __future__ import annotations

import math
import unittest

from bluewolf_core.config import GroupingConfig
from bluewolf_core.geometry import local_m_to_wgs84
from bluewolf_core.grouping import (
    GroupObservation,
    StableGroupingEngine,
    StructuralGroup,
    base_period_seconds,
    discover_structural_groups,
    routes_compatible,
)
from bluewolf_core.models import (
    CanonicalPoint,
    ClosedRoute,
    Direction,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
)


BASE_LATITUDE = 32.0
BASE_LONGITUDE = 34.0


def _route(
    *,
    vehicle: int,
    family: RouteFamily,
    subtype: RouteSubtype,
    topology: RouteTopology,
    center_east_m: float = 0.0,
    center_north_m: float = 0.0,
    long_axis_m: float = 100.0,
    short_axis_m: float = 100.0,
    orientation_deg: float = 0.0,
    period_s: float = 120.0,
    direction: Direction = Direction.COUNTERCLOCKWISE,
) -> ClosedRoute:
    latitude, longitude = local_m_to_wgs84(
        CanonicalPoint(center_east_m, center_north_m),
        BASE_LATITUDE,
        BASE_LONGITUDE,
    )
    angle = math.radians(orientation_deg)
    cosine = math.cos(angle)
    sine = math.sin(angle)
    points = []
    for index in range(32):
        phase = 2.0 * math.pi * index / 32.0
        x = long_axis_m * math.cos(phase)
        y = short_axis_m * math.sin(phase)
        points.append(
            CanonicalPoint(
                x * cosine - y * sine,
                x * sine + y * cosine,
            )
        )
    perimeter = 0.0
    for index, point in enumerate(points):
        nxt = points[(index + 1) % len(points)]
        perimeter += math.hypot(nxt.x_m - point.x_m, nxt.y_m - point.y_m)
    return ClosedRoute(
        route_id=f"route-{vehicle}",
        family=family,
        subtype=subtype,
        topology=topology,
        canonical_points=tuple(points),
        center_latitude_deg=latitude,
        center_longitude_deg=longitude,
        length_m=perimeter,
        long_axis_a_m=long_axis_m,
        short_axis_b_m=short_axis_m,
        orientation_deg=orientation_deg,
        estimated_period_s=period_s,
        direction=direction,
        detection_quality=0.95,
    )


def _si(vehicle: int, **kwargs: object) -> ClosedRoute:
    return _route(
        vehicle=vehicle,
        family=RouteFamily.SI,
        subtype=RouteSubtype.COMPACT,
        topology=RouteTopology.SIMPLE,
        **kwargs,
    )


def _so(vehicle: int, **kwargs: object) -> ClosedRoute:
    return _route(
        vehicle=vehicle,
        family=RouteFamily.SO,
        subtype=RouteSubtype.HIPPODROME,
        topology=RouteTopology.SIMPLE,
        long_axis_m=150.0,
        short_axis_m=50.0,
        **kwargs,
    )


def _observation(vehicle: int, route: ClosedRoute, **kwargs: object) -> GroupObservation:
    return GroupObservation(
        server_id=1,
        vehicle_identifier=vehicle,
        route=route,
        **kwargs,
    )


def _structural(members: tuple[int, ...], *, family: RouteFamily = RouteFamily.SI) -> StructuralGroup:
    return StructuralGroup(
        server_id=1,
        family=family,
        member_keys=tuple((1, member) for member in members),
        route_ids=tuple(f"route-{member}" for member in members),
        base_period_s=120.0,
    )


class StructuralGroupingTests(unittest.TestCase):
    def test_si_concentric_rings_group_without_size_equality(self) -> None:
        observations = (
            _observation(1, _si(1, long_axis_m=100.0, short_axis_m=100.0)),
            _observation(2, _si(2, long_axis_m=160.0, short_axis_m=160.0)),
        )
        groups = discover_structural_groups(observations)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].member_keys, ((1, 1), (1, 2)))

    def test_si_center_and_period_are_hard_membership_gates(self) -> None:
        near = _observation(1, _si(1, center_east_m=0.0, period_s=120.0))
        compatible = _observation(2, _si(2, center_east_m=25.0, period_s=125.0))
        far = _observation(3, _si(3, center_east_m=40.0, period_s=120.0))
        wrong_period = _observation(4, _si(4, center_east_m=0.0, period_s=160.0))
        self.assertTrue(routes_compatible(near, compatible).compatible)
        self.assertIn("center", routes_compatible(near, far).reasons)
        self.assertIn("period", routes_compatible(near, wrong_period).reasons)

    def test_si_opposite_direction_does_not_group(self) -> None:
        first = _observation(1, _si(1, direction=Direction.CLOCKWISE))
        second = _observation(2, _si(2, direction=Direction.COUNTERCLOCKWISE))
        decision = routes_compatible(first, second)
        self.assertFalse(decision.compatible)
        self.assertIn("direction", decision.reasons)

    def test_si_complete_link_prevents_center_threshold_chaining(self) -> None:
        observations = (
            _observation(1, _si(1, center_east_m=0.0)),
            _observation(2, _si(2, center_east_m=25.0)),
            _observation(3, _si(3, center_east_m=50.0)),
        )
        groups = discover_structural_groups(observations)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].member_keys, ((1, 1), (1, 2)))

    def test_so_neighboring_fronts_group_and_opposite_directions_are_legal(self) -> None:
        first = _observation(
            1,
            _so(1, center_east_m=0.0, direction=Direction.CLOCKWISE),
        )
        second = _observation(
            2,
            _so(2, center_east_m=250.0, direction=Direction.COUNTERCLOCKWISE),
        )
        decision = routes_compatible(first, second)
        self.assertTrue(decision.compatible, decision.reasons)
        self.assertLess(
            float(decision.metrics["neighbor_distance_m"]),
            float(decision.metrics["neighbor_limit_m"]),
        )

    def test_so_far_fronts_do_not_group(self) -> None:
        first = _observation(1, _so(1, center_east_m=0.0))
        second = _observation(2, _so(2, center_east_m=650.0))
        decision = routes_compatible(first, second)
        self.assertFalse(decision.compatible)
        self.assertIn("neighbor", decision.reasons)

    def test_so_connected_components_support_route_instance_chains(self) -> None:
        observations = (
            _observation(1, _so(1, center_east_m=0.0)),
            _observation(2, _so(2, center_east_m=250.0)),
            _observation(3, _so(3, center_east_m=500.0)),
        )
        groups = discover_structural_groups(observations)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].member_keys, ((1, 1), (1, 2), (1, 3)))

    def test_double_so_uses_single_period_basis(self) -> None:
        single = _so(1, center_east_m=0.0, period_s=120.0)
        double = _route(
            vehicle=2,
            family=RouteFamily.SO,
            subtype=RouteSubtype.DOUBLE_HIPPODROME,
            topology=RouteTopology.DOUBLE,
            center_east_m=250.0,
            long_axis_m=150.0,
            short_axis_m=50.0,
            period_s=240.0,
            direction=Direction.COUNTERCLOCKWISE,
        )
        self.assertAlmostEqual(base_period_seconds(double), 120.0)
        self.assertTrue(
            routes_compatible(_observation(1, single), _observation(2, double)).compatible
        )

    def test_low_reliability_and_free_routes_are_excluded(self) -> None:
        good = _observation(1, _si(1))
        low = _observation(2, _si(2), reliability=0.59)
        free = _observation(
            3,
            _route(
                vehicle=3,
                family=RouteFamily.FREE,
                subtype=RouteSubtype.UNKNOWN,
                topology=RouteTopology.SIMPLE,
            ),
        )
        self.assertEqual(discover_structural_groups((good, low, free)), ())

    def test_minimum_vehicle_count_is_configurable(self) -> None:
        config = GroupingConfig(minimum_valid_vehicles=3)
        observations = (_observation(1, _si(1)), _observation(2, _si(2)))
        self.assertEqual(discover_structural_groups(observations, config), ())


class StableIdentityTests(unittest.TestCase):
    def test_group_id_survives_when_sixty_percent_of_old_members_stay_together(self) -> None:
        engine = StableGroupingEngine()
        first = engine.reconcile((_structural((1, 2, 3, 4, 5)),))
        original_id = first.groups[0].group_id
        second = engine.reconcile((_structural((1, 2, 3, 6)),))
        self.assertEqual(second.groups[0].group_id, original_id)

    def test_merge_of_two_groups_creates_new_group_id(self) -> None:
        engine = StableGroupingEngine()
        first = engine.reconcile((_structural((1, 2, 3)), _structural((4, 5, 6))))
        old_ids = {group.group_id for group in first.groups}
        merged = engine.reconcile((_structural((1, 2, 3, 4, 5, 6)),))
        self.assertNotIn(merged.groups[0].group_id, old_ids)

    def test_identity_state_round_trip_is_deterministic(self) -> None:
        engine = StableGroupingEngine()
        first = engine.reconcile((_structural((1, 2, 3)),))
        restored = StableGroupingEngine.from_state(engine.export_state())
        second = restored.reconcile((_structural((1, 2, 3, 4)),))
        self.assertEqual(second.groups[0].group_id, first.groups[0].group_id)
        new_group = restored.reconcile((_structural((7, 8)),))
        self.assertNotEqual(new_group.groups[0].group_id, first.groups[0].group_id)

    def test_grouping_api_has_no_score_input(self) -> None:
        engine = StableGroupingEngine()
        snapshot = engine.update((_observation(1, _si(1)), _observation(2, _si(2))))
        self.assertEqual(len(snapshot.groups), 1)
        self.assertEqual(snapshot.assignments[(1, 1)], snapshot.assignments[(1, 2)])


if __name__ == "__main__":
    unittest.main()
