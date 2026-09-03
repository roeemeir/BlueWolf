from __future__ import annotations

import unittest

from bluewolf_core import PrimitiveMetrics, RouteFamily
from bluewolf_core.config import ErrorBand, ScoringConfig
from bluewolf_core.scoring import aggregate_group_scores, score_error, score_vehicle


def ideal_metrics(**overrides: object) -> PrimitiveMetrics:
    values: dict[str, object] = {
        "family": RouteFamily.SI,
        "position_error": 0.0,
        "period_error_ratio": 0.0,
        "movement_error_ratio": 0.0,
        "distance_error_b_ratio": 0.0,
        "tangent_error_deg": 0.0,
        "curvature_error_ratio": 0.0,
        "reliability": 1.0,
        "speed_fraction": 1.0,
    }
    values.update(overrides)
    return PrimitiveMetrics(**values)


class ScoreLawTests(unittest.TestCase):
    def test_error_band_is_flat_then_linear_then_zero(self) -> None:
        band = ErrorBand(10, 30)
        self.assertEqual(score_error(0, band), 100)
        self.assertEqual(score_error(10, band), 100)
        self.assertEqual(score_error(20, band), 50)
        self.assertEqual(score_error(30, band), 0)
        self.assertEqual(score_error(300, band), 0)

    def test_negative_error_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            score_error(-0.1, ErrorBand(10, 30))


class VehicleScoreTests(unittest.TestCase):
    def test_ideal_si_vehicle_receives_full_scores(self) -> None:
        score = score_vehicle(ideal_metrics())
        self.assertTrue(score.valid)
        self.assertEqual(score.sync, 100)
        self.assertEqual(score.route, 100)
        self.assertEqual(score.total, 100)
        self.assertIsNone(score.primary_reason)

    def test_approved_weights_are_applied_per_vehicle(self) -> None:
        score = score_vehicle(ideal_metrics(position_error=20.0))
        self.assertEqual(score.components.sync_position, 50)
        self.assertEqual(score.sync, 70)
        self.assertEqual(score.route, 100)
        self.assertEqual(score.total, 77.5)
        self.assertEqual(score.primary_reason, "phase_alignment")

    def test_so_position_error_uses_cycle_fraction(self) -> None:
        score = score_vehicle(
            ideal_metrics(family=RouteFamily.SO, position_error=0.15)
        )
        self.assertEqual(score.components.sync_position, 50)

    def test_low_speed_skips_directional_route_components(self) -> None:
        score = score_vehicle(
            ideal_metrics(
                speed_fraction=0.20,
                distance_error_b_ratio=0.175,
                tangent_error_deg=180.0,
                curvature_error_ratio=5.0,
            )
        )
        self.assertEqual(score.components.route_distance, 50)
        self.assertIsNone(score.components.route_tangent)
        self.assertIsNone(score.components.route_curvature)
        self.assertEqual(score.route, 50)

    def test_si_wrong_direction_for_a_minute_forces_sync_to_zero(self) -> None:
        score = score_vehicle(ideal_metrics(wrong_direction_seconds=60))
        self.assertEqual(score.sync, 0)
        self.assertEqual(score.route, 100)
        self.assertEqual(score.total, 25)
        self.assertEqual(score.primary_reason, "wrong_direction")

    def test_low_reliability_has_no_valid_score(self) -> None:
        score = score_vehicle(ideal_metrics(reliability=0.59))
        self.assertFalse(score.valid)
        self.assertIsNone(score.total)
        self.assertEqual(score.primary_reason, "low_reliability")

    def test_group_score_is_only_the_mean_of_valid_vehicle_scores(self) -> None:
        first = score_vehicle(ideal_metrics())
        second = score_vehicle(ideal_metrics(position_error=20.0))
        invalid = score_vehicle(ideal_metrics(active=False))
        group = aggregate_group_scores((first, second, invalid))
        self.assertTrue(group.valid)
        self.assertEqual(group.valid_vehicle_count, 2)
        self.assertEqual(group.sync, 85)
        self.assertEqual(group.route, 100)
        self.assertEqual(group.total, 88.75)

    def test_one_valid_vehicle_does_not_publish_a_group_score(self) -> None:
        group = aggregate_group_scores((score_vehicle(ideal_metrics()),))
        self.assertFalse(group.valid)
        self.assertEqual(group.valid_vehicle_count, 1)
        self.assertEqual(group.primary_reason, "insufficient_coverage")

    def test_config_round_trip_preserves_scoring_behavior(self) -> None:
        config = ScoringConfig()
        score = score_vehicle(ideal_metrics(position_error=20), config)
        self.assertEqual(score.total, 77.5)


if __name__ == "__main__":
    unittest.main()
