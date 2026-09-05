from __future__ import annotations

import unittest

from bluewolf_core import PrimitiveMetrics, RouteFamily
from bluewolf_core.scoring import score_vehicle


def metrics(angle_error: float) -> PrimitiveMetrics:
    return PrimitiveMetrics(
        family=RouteFamily.SI,
        position_error=angle_error,
        period_error_ratio=0.0,
        movement_error_ratio=0.0,
        distance_error_b_ratio=0.0,
        tangent_error_deg=0.0,
        curvature_error_ratio=0.0,
        reliability=1.0,
        speed_fraction=1.0,
    )


class V09AngleSensitivityRegressionTests(unittest.TestCase):
    def test_si_angle_error_has_strong_monotonic_effect(self) -> None:
        perfect = score_vehicle(metrics(0.0))
        midway = score_vehicle(metrics(20.0))
        zero_band = score_vehicle(metrics(30.0))

        self.assertEqual(perfect.sync, 100.0)
        self.assertEqual(midway.sync, 70.0)
        self.assertEqual(zero_band.sync, 40.0)
        self.assertEqual(perfect.total, 100.0)
        self.assertEqual(midway.total, 77.5)
        self.assertEqual(zero_band.total, 55.0)
        self.assertGreaterEqual(perfect.total - zero_band.total, 45.0)

    def test_larger_angle_error_never_improves_score(self) -> None:
        totals = [score_vehicle(metrics(float(error))).total for error in range(0, 61, 5)]
        self.assertTrue(all(a is not None and b is not None and a >= b for a, b in zip(totals, totals[1:])))


if __name__ == "__main__":
    unittest.main()
