from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core import Direction, detect_closed_route
from bluewolf_core.config import DetectionConfig
from bluewolf_core.route_change import compare_routes, estimate_change_onset
from bluewolf_core.simulator import SimulatedVehicle, generate_si_circle_samples


START = datetime(2026, 1, 1, tzinfo=UTC)
VEHICLE = (SimulatedVehicle(1, 101, 0),)


def _detected_circle(*, radius_m: float, period_s: int, start: datetime = START):
    samples = generate_si_circle_samples(
        start_time_utc=start,
        duration_seconds=period_s * 2,
        vehicles=VEHICLE,
        radius_m=radius_m,
        period_seconds=period_s,
        direction=Direction.COUNTERCLOCKWISE,
        position_noise_std_m=0.25,
        seed=int(radius_m * 10 + period_s),
    )
    detected = detect_closed_route(samples)
    assert detected is not None
    return detected.effective, tuple(samples)


class AdaptiveRouteChangeTests(unittest.TestCase):
    def test_material_geometry_and_period_change_is_detected(self) -> None:
        config = DetectionConfig()
        old_route, _ = _detected_circle(radius_m=100, period_s=120)
        new_route, _ = _detected_circle(radius_m=140, period_s=180)

        delta = compare_routes(old_route, new_route, config)

        self.assertTrue(delta.changed)
        self.assertIn("long_axis", delta.reasons)
        self.assertIn("short_axis", delta.reasons)
        self.assertIn("period", delta.reasons)
        self.assertGreaterEqual(delta.long_axis_ratio, 0.20)
        self.assertGreaterEqual(delta.period_ratio, 0.20)

    def test_small_refit_drift_does_not_create_route_change(self) -> None:
        config = DetectionConfig()
        old_route, _ = _detected_circle(radius_m=100, period_s=120)
        refit_route, _ = _detected_circle(radius_m=106, period_s=126)

        delta = compare_routes(old_route, refit_route, config)

        self.assertFalse(delta.changed)
        self.assertEqual(delta.reasons, ())

    def test_change_onset_is_retroactive_to_new_geometry(self) -> None:
        config = DetectionConfig()
        old_route, old_samples = _detected_circle(radius_m=100, period_s=120)
        transition = START + timedelta(seconds=241)
        new_route, new_samples = _detected_circle(
            radius_m=140,
            period_s=120,
            start=transition,
        )
        history = old_samples + new_samples

        # Pretend confirmation happened only after enough new-route evidence.
        evidence_start = transition + timedelta(seconds=100)
        onset = estimate_change_onset(
            history,
            old_route,
            new_route,
            evidence_start,
            config,
        )

        self.assertGreaterEqual(onset, transition)
        self.assertLessEqual(onset, transition + timedelta(seconds=3))
        self.assertLess(onset, evidence_start)


if __name__ == "__main__":
    unittest.main()
