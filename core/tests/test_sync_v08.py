from __future__ import annotations

import unittest

from bluewolf_core.sync_v08 import (
    circular_cycle_distance,
    double_as_single,
    double_quarter,
    double_quarter_relation,
    si_pair_angle_error_deg,
    si_tangent_error_deg,
    so_relation_phase_error,
    so_turn_weighted_error,
)
from bluewolf_core.v08_core import Point2D, Rotation, SoRelation


class SiSynchronizationPrimitiveTests(unittest.TestCase):
    def test_pair_angle_is_undirected(self) -> None:
        self.assertEqual(si_pair_angle_error_deg(240, 120), 0)
        self.assertEqual(si_pair_angle_error_deg(90, 120), 30)

    def test_velocity_tangent_error_uses_rotation(self) -> None:
        position = Point2D(100, 0)
        center = Point2D(0, 0)
        self.assertAlmostEqual(
            si_tangent_error_deg(position, center, 0, 10, Rotation.CCW) or 0,
            0,
            places=6,
        )
        self.assertAlmostEqual(
            si_tangent_error_deg(position, center, 0, -10, Rotation.CW) or 0,
            0,
            places=6,
        )
        self.assertGreater(
            si_tangent_error_deg(position, center, 10, 0, Rotation.CCW) or 0,
            80,
        )

    def test_stationary_velocity_does_not_fake_heading(self) -> None:
        self.assertIsNone(
            si_tangent_error_deg(Point2D(100, 0), Point2D(0, 0), 0, 0, Rotation.CCW)
        )


class SoSynchronizationPrimitiveTests(unittest.TestCase):
    def test_same_opposite_mixed_phase_errors(self) -> None:
        self.assertAlmostEqual(so_relation_phase_error(0.10, 0.10, SoRelation.SAME), 0)
        self.assertAlmostEqual(so_relation_phase_error(0.10, 0.60, SoRelation.OPPOSITE), 0)
        self.assertAlmostEqual(so_relation_phase_error(0.10, 0.35, SoRelation.MIXED), 0)
        self.assertGreater(so_relation_phase_error(0.10, 0.30, SoRelation.OPPOSITE), 0.25)

    def test_double_quarter_semantics(self) -> None:
        self.assertEqual(double_quarter(0.01), 0)
        self.assertEqual(double_quarter(0.26), 1)
        self.assertEqual(double_quarter_relation(0.02, 0.28), SoRelation.MIXED)
        self.assertEqual(double_quarter_relation(0.02, 0.52), SoRelation.OPPOSITE)
        self.assertEqual(double_quarter_relation(0.02, 0.12), SoRelation.SAME)

    def test_double_maps_to_two_opposite_single_cycles(self) -> None:
        first = double_as_single(0.20)
        second = double_as_single(0.70)
        self.assertAlmostEqual(first.local_single_phase, 0.40)
        self.assertAlmostEqual(second.local_single_phase, 0.40)
        self.assertEqual(first.relation_to_first_half, SoRelation.SAME)
        self.assertEqual(second.relation_to_first_half, SoRelation.OPPOSITE)

    def test_turn_timing_is_emphasized_without_new_weight(self) -> None:
        normal = so_turn_weighted_error(0.10, 0.50, ((0.05, 0.15),))
        turn = so_turn_weighted_error(0.10, 0.10, ((0.05, 0.15),))
        self.assertAlmostEqual(normal, 0.10)
        self.assertAlmostEqual(turn, 0.15)

    def test_cycle_distance_wraps(self) -> None:
        self.assertAlmostEqual(circular_cycle_distance(0.98, 0.02), 0.04)


if __name__ == "__main__":
    unittest.main()
