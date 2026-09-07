from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core import (
    ChangeKind,
    CheckpointCompatibilityError,
    CoreConfig,
    CoreSession,
    VehicleSample,
)
from bluewolf_core.config import DetectionConfig, TimingConfig
from bluewolf_core.simulator import SimulatedVehicle, generate_si_circle_samples


START = datetime(2026, 1, 1, tzinfo=UTC)


def one_sample(second: int = 0, *, active: bool | None = True) -> VehicleSample:
    return VehicleSample(
        sample_time_utc=START + timedelta(seconds=second),
        server_id=1,
        vehicle_number=7,
        vehicle_identifier=107,
        active=active,
        latitude_deg=31.8,
        longitude_deg=34.8,
    )


def scenario() -> tuple[VehicleSample, ...]:
    return generate_si_circle_samples(
        start_time_utc=START,
        duration_seconds=30,
        vehicles=(
            SimulatedVehicle(1, 101, 0),
            SimulatedVehicle(2, 102, 120),
            SimulatedVehicle(3, 103, 240),
        ),
        position_noise_std_m=0.75,
        seed=42,
    )


def route_scenario(duration_seconds: int = 180) -> tuple[VehicleSample, ...]:
    return generate_si_circle_samples(
        start_time_utc=START,
        duration_seconds=duration_seconds,
        vehicles=(SimulatedVehicle(1, 101, 0),),
        radius_m=100,
        period_seconds=120,
    )


class SessionDeterminismTests(unittest.TestCase):
    def test_one_batch_and_five_second_batches_are_equivalent(self) -> None:
        samples = scenario()
        one = CoreSession()
        expected = one.process_batch(samples)

        incremental = CoreSession()
        actual_frames = []
        actual_changes = []
        for start_second in range(0, 31, 5):
            end_second = start_second + 5
            part = tuple(
                sample
                for sample in samples
                if start_second <= (sample.sample_time_utc - START).total_seconds() < end_second
            )
            result = incremental.process_batch(part)
            actual_frames.extend(result.frames)
            actual_changes.extend(result.changes)

        self.assertEqual(tuple(actual_frames), expected.frames)
        self.assertEqual(tuple(actual_changes), expected.changes)
        self.assertEqual(incremental.debug_state(), one.debug_state())
        self.assertEqual(incremental.export_checkpoint(), one.export_checkpoint())

    def test_checkpoint_restore_matches_uninterrupted_processing(self) -> None:
        samples = scenario()
        first_half = tuple(sample for sample in samples if sample.sample_time_utc <= START + timedelta(seconds=15))
        second_half = tuple(sample for sample in samples if sample.sample_time_utc > START + timedelta(seconds=15))

        uninterrupted = CoreSession()
        uninterrupted.process_batch(first_half)
        expected_tail = uninterrupted.process_batch(second_half)

        before_restart = CoreSession()
        before_restart.process_batch(first_half)
        restored = CoreSession.from_checkpoint(before_restart.export_checkpoint())
        actual_tail = restored.process_batch(second_half)

        self.assertEqual(actual_tail, expected_tail)
        self.assertEqual(restored.debug_state(), uninterrupted.debug_state())
        self.assertEqual(restored.export_checkpoint(), uninterrupted.export_checkpoint())

    def test_overlapping_query_samples_are_ignored(self) -> None:
        session = CoreSession()
        first = session.process_batch((one_sample(0), one_sample(1)))
        overlap = session.process_batch((one_sample(1), one_sample(2)))
        self.assertEqual(len(first.frames), 2)
        self.assertEqual(len(overlap.frames), 1)
        self.assertEqual(overlap.frames[0].sample_time_utc, START + timedelta(seconds=2))

    def test_data_loss_resume_and_membership_expiry_use_approved_timers(self) -> None:
        session = CoreSession()
        session.process_batch((one_sample(),))
        lost = session.process_batch((), observed_until_utc=START + timedelta(seconds=20))
        self.assertEqual([item.kind for item in lost.changes], [ChangeKind.DATA_LOST])

        resumed = session.process_batch((one_sample(25),))
        self.assertEqual([item.kind for item in resumed.changes], [ChangeKind.DATA_RESUMED])

        expired = session.process_batch((), observed_until_utc=START + timedelta(seconds=325))
        self.assertEqual(
            [item.kind for item in expired.changes],
            [ChangeKind.DATA_LOST, ChangeKind.VEHICLE_EXPIRED],
        )
        self.assertEqual(expired.changes[0].change_time_utc, START + timedelta(seconds=45))
        self.assertEqual(expired.changes[1].change_time_utc, START + timedelta(seconds=325))

    def test_checkpoint_rejects_algorithm_or_configuration_mismatch(self) -> None:
        session = CoreSession()
        session.process_batch((one_sample(),))
        checkpoint = session.export_checkpoint()

        with self.assertRaises(CheckpointCompatibilityError):
            CoreSession.from_checkpoint(checkpoint, algorithm_version="other")

        different = CoreConfig(timing=TimingConfig(live_batch_seconds=4))
        with self.assertRaises(CheckpointCompatibilityError):
            CoreSession.from_checkpoint(checkpoint, config=different)

    def test_route_candidate_then_confirmation_and_phase_are_adaptive(self) -> None:
        session = CoreSession()
        result = session.process_batch(route_scenario())
        route_changes = [
            item
            for item in result.changes
            if item.kind in (ChangeKind.ROUTE_CANDIDATE, ChangeKind.ROUTE_CONFIRMED)
        ]

        self.assertEqual(
            [item.kind for item in route_changes],
            [ChangeKind.ROUTE_CANDIDATE, ChangeKind.ROUTE_CONFIRMED],
        )
        candidate_seconds = (route_changes[0].change_time_utc - START).total_seconds()
        confirmed_seconds = (route_changes[1].change_time_utc - START).total_seconds()
        self.assertLess(candidate_seconds, confirmed_seconds)
        self.assertLess(confirmed_seconds, 180)
        self.assertLess(confirmed_seconds, 300)
        self.assertEqual(route_changes[1].details["family"], "si")
        self.assertEqual(route_changes[1].details["subtype"], "compact")
        self.assertGreaterEqual(route_changes[1].details["coverage_fraction"], 0.82)
        self.assertTrue(route_changes[1].details["closure_ok"])
        self.assertEqual(route_changes[1].details["history_ceiling_seconds"], 2400)
        self.assertLessEqual(
            route_changes[1].details["evidence_window_seconds"],
            confirmed_seconds,
        )

        routed_frames = [frame for frame in result.frames if frame.route_id is not None]
        self.assertTrue(routed_frames)
        first_routed_seconds = (routed_frames[0].sample_time_utc - START).total_seconds()
        self.assertLess(first_routed_seconds, 180)
        self.assertIsNotNone(routed_frames[0].phase)
        assert routed_frames[0].phase is not None
        self.assertGreaterEqual(routed_frames[0].phase, 0.0)
        self.assertLess(routed_frames[0].phase, 1.0)

    def test_route_lifecycle_survives_checkpoint_without_duplicate_candidate(self) -> None:
        samples = route_scenario()
        first_half = tuple(
            sample
            for sample in samples
            if sample.sample_time_utc <= START + timedelta(seconds=115)
        )
        second_half = tuple(
            sample
            for sample in samples
            if sample.sample_time_utc > START + timedelta(seconds=115)
        )

        uninterrupted = CoreSession()
        first_result = uninterrupted.process_batch(first_half)
        self.assertEqual(
            [
                item.kind
                for item in first_result.changes
                if item.kind in (ChangeKind.ROUTE_CANDIDATE, ChangeKind.ROUTE_CONFIRMED)
            ],
            [ChangeKind.ROUTE_CANDIDATE],
        )
        expected_tail = uninterrupted.process_batch(second_half)

        before_restart = CoreSession()
        before_restart.process_batch(first_half)
        restored = CoreSession.from_checkpoint(before_restart.export_checkpoint())
        actual_tail = restored.process_batch(second_half)

        self.assertEqual(actual_tail, expected_tail)
        self.assertEqual(
            [
                item.kind
                for item in actual_tail.changes
                if item.kind in (ChangeKind.ROUTE_CANDIDATE, ChangeKind.ROUTE_CONFIRMED)
            ],
            [ChangeKind.ROUTE_CONFIRMED],
        )
        self.assertEqual(restored.debug_state(), uninterrupted.debug_state())
        self.assertEqual(restored.export_checkpoint(), uninterrupted.export_checkpoint())

    def test_route_history_is_capped_by_configured_lookback(self) -> None:
        config = CoreConfig(detection=DetectionConfig(max_history_seconds=60))
        session = CoreSession(config=config)
        session.process_batch(route_scenario(180))
        state = session.debug_state()
        route_state = state["routes"][0]
        self.assertLessEqual(route_state["history_count"], 61)
        self.assertEqual(route_state["history_end_utc"], "2026-01-01T00:03:00Z")
        self.assertGreaterEqual(route_state["history_start_utc"], "2026-01-01T00:02:00Z")

    def test_route_lifecycle_is_equivalent_in_one_batch_and_five_second_batches(self) -> None:
        samples = route_scenario()
        one = CoreSession()
        expected = one.process_batch(samples)

        incremental = CoreSession()
        frames = []
        changes = []
        for start_second in range(0, 181, 5):
            end_second = start_second + 5
            part = tuple(
                sample
                for sample in samples
                if start_second <= (sample.sample_time_utc - START).total_seconds() < end_second
            )
            result = incremental.process_batch(part)
            frames.extend(result.frames)
            changes.extend(result.changes)

        self.assertEqual(tuple(frames), expected.frames)
        self.assertEqual(tuple(changes), expected.changes)
        self.assertEqual(incremental.debug_state(), one.debug_state())
        self.assertEqual(incremental.export_checkpoint(), one.export_checkpoint())


if __name__ == "__main__":
    unittest.main()
