from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core import ChangeKind, CoreSession, Direction, detect_closed_route
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

    def test_session_replaces_confirmed_route_without_fixed_change_timer(self) -> None:
        _, old_samples = _detected_circle(radius_m=100, period_s=120)
        transition = START + timedelta(seconds=241)
        _, new_samples = _detected_circle(
            radius_m=140,
            period_s=120,
            start=transition,
        )

        result = CoreSession().process_batch(old_samples + new_samples)
        confirmations = [
            change
            for change in result.changes
            if change.kind is ChangeKind.ROUTE_CONFIRMED
        ]
        replacements = [
            change for change in confirmations if bool(change.details.get("replacement"))
        ]

        self.assertGreaterEqual(len(confirmations), 2)
        self.assertEqual(len(replacements), 1)
        replacement = replacements[0]
        self.assertGreaterEqual(replacement.change_time_utc, transition)
        self.assertLessEqual(
            replacement.change_time_utc,
            transition + timedelta(seconds=5),
        )
        self.assertTrue(bool(replacement.details["retroactive_onset"]))
        self.assertIn("long_axis", replacement.details["change_reasons"])
        self.assertIn("short_axis", replacement.details["change_reasons"])
        detection_time = datetime.fromisoformat(
            str(replacement.details["detection_time_utc"]).replace("Z", "+00:00")
        )
        self.assertGreater(detection_time, replacement.change_time_utc)
        # Evidence determines latency: no legacy 120-second change hold is used.
        self.assertLess(
            (detection_time - transition).total_seconds(),
            180.0,
        )

    def test_period_only_change_is_detected_and_attributed_retroactively(self) -> None:
        _, old_samples = _detected_circle(radius_m=100, period_s=120)
        transition = START + timedelta(seconds=241)
        _, new_samples = _detected_circle(
            radius_m=100,
            period_s=180,
            start=transition,
        )

        result = CoreSession().process_batch(old_samples + new_samples)
        replacements = [
            change
            for change in result.changes
            if change.kind is ChangeKind.ROUTE_CONFIRMED
            and bool(change.details.get("replacement"))
        ]

        self.assertEqual(len(replacements), 1)
        replacement = replacements[0]
        self.assertIn("period", replacement.details["change_reasons"])
        self.assertGreaterEqual(replacement.change_time_utc, transition)
        self.assertLessEqual(
            replacement.change_time_utc,
            transition + timedelta(seconds=5),
        )
        detection_time = datetime.fromisoformat(
            str(replacement.details["detection_time_utc"]).replace("Z", "+00:00")
        )
        self.assertGreater(detection_time, replacement.change_time_utc)
        self.assertTrue(bool(replacement.details["retroactive_onset"]))

    def test_route_replacement_survives_checkpoint_mid_change(self) -> None:
        _, old_samples = _detected_circle(radius_m=100, period_s=120)
        transition = START + timedelta(seconds=241)
        _, new_samples = _detected_circle(
            radius_m=140,
            period_s=120,
            start=transition,
        )
        all_samples = old_samples + new_samples
        checkpoint_at = transition + timedelta(seconds=60)
        first_part = tuple(
            sample for sample in all_samples if sample.sample_time_utc <= checkpoint_at
        )
        second_part = tuple(
            sample for sample in all_samples if sample.sample_time_utc > checkpoint_at
        )

        uninterrupted = CoreSession()
        first_result = uninterrupted.process_batch(first_part)
        self.assertFalse(
            any(
                change.kind is ChangeKind.ROUTE_CONFIRMED
                and bool(change.details.get("replacement"))
                for change in first_result.changes
            )
        )
        expected_tail = uninterrupted.process_batch(second_part)

        before_restart = CoreSession()
        before_restart.process_batch(first_part)
        restored = CoreSession.from_checkpoint(before_restart.export_checkpoint())
        actual_tail = restored.process_batch(second_part)

        self.assertEqual(actual_tail, expected_tail)
        replacements = [
            change
            for change in actual_tail.changes
            if change.kind is ChangeKind.ROUTE_CONFIRMED
            and bool(change.details.get("replacement"))
        ]
        self.assertEqual(len(replacements), 1)
        self.assertGreaterEqual(replacements[0].change_time_utc, transition)
        self.assertLessEqual(
            replacements[0].change_time_utc,
            transition + timedelta(seconds=5),
        )
        self.assertEqual(restored.debug_state(), uninterrupted.debug_state())
        self.assertEqual(restored.export_checkpoint(), uninterrupted.export_checkpoint())

    def test_stable_confirmed_route_does_not_emit_replacement(self) -> None:
        stable = generate_si_circle_samples(
            start_time_utc=START,
            duration_seconds=480,
            vehicles=VEHICLE,
            radius_m=100,
            period_seconds=120,
            direction=Direction.COUNTERCLOCKWISE,
            position_noise_std_m=1.0,
            seed=4242,
        )

        result = CoreSession().process_batch(stable)
        replacements = [
            change
            for change in result.changes
            if change.kind is ChangeKind.ROUTE_CONFIRMED
            and bool(change.details.get("replacement"))
        ]

        self.assertEqual(replacements, [])


if __name__ == "__main__":
    unittest.main()
