from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core import ChangeKind, CoreSession, Direction, detect_closed_route
from bluewolf_core.config import DetectionConfig
from bluewolf_core.geometry import local_m_to_wgs84
from bluewolf_core.models import (
    CanonicalPoint,
    ClosedRoute,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
    VehicleSample,
)
from bluewolf_core.route_change import (
    compare_routes,
    estimate_change_onset,
    route_change_suspected,
)
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


def _clockwise_square_route() -> ClosedRoute:
    # Canonical points are deliberately ordered clockwise, matching the V2
    # contract where centerline order follows observed phase/time.
    return ClosedRoute(
        route_id="cw-square",
        family=RouteFamily.SI,
        subtype=RouteSubtype.COMPACT,
        topology=RouteTopology.SIMPLE,
        canonical_points=(
            CanonicalPoint(10.0, 10.0),
            CanonicalPoint(10.0, -10.0),
            CanonicalPoint(-10.0, -10.0),
            CanonicalPoint(-10.0, 10.0),
        ),
        center_latitude_deg=32.0,
        center_longitude_deg=34.8,
        length_m=80.0,
        long_axis_a_m=10.0,
        short_axis_b_m=10.0,
        orientation_deg=0.0,
        estimated_period_s=40.0,
        direction=Direction.CLOCKWISE,
        detection_quality=1.0,
    )


def _clockwise_tangent_sample() -> VehicleSample:
    latitude, longitude = local_m_to_wgs84(
        CanonicalPoint(10.0, 0.0),
        32.0,
        34.8,
    )
    # Right-hand leg of the clockwise canonical square points south.
    return VehicleSample(
        sample_time_utc=START,
        server_id=1,
        vehicle_number=1,
        vehicle_identifier=101,
        active=True,
        latitude_deg=latitude,
        longitude_deg=longitude,
        velocity_east_mps=0.0,
        velocity_north_mps=-2.0,
        reliability=1.0,
    )


class AdaptiveRouteChangeTests(unittest.TestCase):
    def test_clockwise_canonical_tangent_is_not_flipped_twice(self) -> None:
        self.assertFalse(
            route_change_suspected(
                _clockwise_tangent_sample(),
                _clockwise_square_route(),
                DetectionConfig(),
            )
        )

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

        diagnostics = [
            {
                "time": change.change_time_utc.isoformat(),
                "detection_time": change.details.get("detection_time_utc"),
                "old_period": change.details.get("previous_estimated_period_s"),
                "new_period": change.details.get("estimated_period_s"),
                "reasons": change.details.get("change_reasons"),
                "window_start": change.details.get("evidence_window_start_utc"),
                "window_seconds": change.details.get("evidence_window_seconds"),
                "metrics": change.details.get("change_metrics"),
            }
            for change in replacements
        ]
        self.assertEqual(len(replacements), 1, diagnostics)
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
