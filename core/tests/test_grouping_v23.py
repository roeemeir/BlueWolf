from __future__ import annotations

import math
import unittest
from types import SimpleNamespace

from bluewolf_core.application_analysis_v23 import (
    MAX_SO_TURN_CONNECTION_LEGS,
    _si_components,
    _so_components,
    so_pair_compatibility,
)


def single_geometry(center_x: float, center_y: float, axis_deg: float, *, direction: int = 1, leg: float = 100.0) -> dict:
    return {
        "kind": "single",
        "center": {"x": center_x, "y": center_y},
        "radius": 20.0,
        "legLength": leg,
        "rotationDeg": axis_deg,
        "direction": direction,
    }


def connected_geometry(shared_x: float, shared_y: float, axis_deg: float, *, direction: int = 1, leg: float = 100.0) -> dict:
    angle = math.radians(axis_deg)
    ux, uy = math.cos(angle), math.sin(angle)
    # `_segments` places turns at center +/- axis * leg/2. Choose a center so
    # the minus endpoint is exactly the requested shared turn.
    return single_geometry(
        shared_x + ux * leg / 2.0,
        shared_y + uy * leg / 2.0,
        axis_deg,
        direction=direction,
        leg=leg,
    )


def track(vehicle_id: int, geometry: dict, direction: int = 1):
    return SimpleNamespace(vehicle_id=vehicle_id, kind="single", geometry=geometry, direction=direction)


class GroupingV23Tests(unittest.TestCase):
    def test_so_axis_angle_over_ninety_is_not_a_grouping_gate(self) -> None:
        first = single_geometry(0.0, 0.0, 0.0, direction=1)
        second = connected_geometry(50.0, 0.0, 120.0, direction=1)
        evidence = so_pair_compatibility(first, second, {"maxAngleDeg": 20.0})
        self.assertTrue(evidence["valid"])
        self.assertGreater(evidence["angleDiffDeg"], 90.0)
        self.assertLessEqual(evidence["turnDistanceLegs"], MAX_SO_TURN_CONNECTION_LEGS)
        self.assertTrue(evidence["frontAligned"])

    def test_so_close_turn_with_opposite_front_is_not_grouped(self) -> None:
        first = single_geometry(0.0, 0.0, 0.0, direction=1)
        second = connected_geometry(50.0, 0.0, 120.0, direction=-1)
        evidence = so_pair_compatibility(first, second, {"maxAngleDeg": 20.0})
        self.assertFalse(evidence["valid"])
        self.assertFalse(evidence["frontAligned"])

    def test_two_independent_so_components_are_both_kept(self) -> None:
        first_a = track(101, single_geometry(0.0, 0.0, 0.0, direction=1))
        first_b = track(102, connected_geometry(50.0, 0.0, 135.0, direction=1))
        second_a = track(201, single_geometry(2000.0, 0.0, 15.0, direction=1))
        # One turn of second_b coincides with the positive turn of second_a.
        shared_angle = math.radians(15.0)
        shared_x = 2000.0 + math.cos(shared_angle) * 50.0
        shared_y = math.sin(shared_angle) * 50.0
        second_b = track(202, connected_geometry(shared_x, shared_y, 150.0, direction=1))

        components, _evidence = _so_components(
            [first_a, first_b, second_a, second_b],
            {"maxAngleDeg": 20.0},
        )
        member_sets = [sorted(item.vehicle_id for item in component) for component in components]
        self.assertEqual(member_sets, [[101, 102], [201, 202]])

    def test_multiple_si_components_are_kept_largest_first(self) -> None:
        def circle(vehicle_id: int, x: float, y: float, radius: float, direction: int = 1):
            return SimpleNamespace(
                vehicle_id=vehicle_id,
                direction=direction,
                fit=SimpleNamespace(center={"x": x, "y": y}, minor_span=radius * 2.0),
            )

        circles = [
            circle(1, 0.0, 0.0, 100.0),
            circle(2, 4.0, 2.0, 90.0),
            circle(3, -3.0, 1.0, 110.0),
            circle(11, 2000.0, 0.0, 80.0),
            circle(12, 2004.0, 1.0, 75.0),
        ]
        components = _si_components(circles)
        member_sets = [sorted(item.vehicle_id for item in component) for component in components]
        self.assertEqual(member_sets, [[1, 2, 3], [11, 12]])


if __name__ == "__main__":
    unittest.main()
