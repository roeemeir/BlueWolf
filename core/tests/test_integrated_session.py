from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core import ChangeKind, CoreConfig, CoreSession
from bluewolf_core.config import GroupingConfig
from bluewolf_core.simulator import SimulatedVehicle, generate_si_circle_samples


START = datetime(2026, 1, 1, tzinfo=UTC)
VEHICLES = (
    SimulatedVehicle(1, 101, 0),
    SimulatedVehicle(2, 102, 180),
)


def group_scenario(duration_seconds: int = 220):
    return generate_si_circle_samples(
        start_time_utc=START,
        duration_seconds=duration_seconds,
        vehicles=VEHICLES,
        radius_m=100,
        period_seconds=120,
        position_noise_std_m=0.25,
        seed=2026,
    )


class IntegratedGroupingSessionTests(unittest.TestCase):
    def test_two_confirmed_si_routes_receive_same_group_id(self) -> None:
        result = CoreSession().process_batch(group_scenario())
        group_confirmations = [
            change
            for change in result.changes
            if change.kind is ChangeKind.GROUP_CONFIRMED
        ]
        self.assertEqual(len(group_confirmations), 1)
        group_id = group_confirmations[0].group_id
        self.assertIsNotNone(group_id)

        grouped = [frame for frame in result.frames if frame.group_id is not None]
        self.assertTrue(grouped)
        self.assertEqual({frame.group_id for frame in grouped}, {group_id})
        self.assertEqual({frame.vehicle_identifier for frame in grouped[-2:]}, {101, 102})

    def test_group_candidate_precedes_confirmation_using_collected_evidence(self) -> None:
        result = CoreSession().process_batch(group_scenario())
        lifecycle = [
            change
            for change in result.changes
            if change.kind in (ChangeKind.GROUP_CANDIDATE, ChangeKind.GROUP_CONFIRMED)
        ]
        self.assertEqual(
            [change.kind for change in lifecycle],
            [ChangeKind.GROUP_CANDIDATE, ChangeKind.GROUP_CONFIRMED],
        )
        self.assertLess(lifecycle[0].change_time_utc, lifecycle[1].change_time_utc)
        self.assertEqual(
            (lifecycle[1].change_time_utc - lifecycle[0].change_time_utc).total_seconds(),
            120,
        )
        detection_time = datetime.fromisoformat(
            str(lifecycle[1].details["detection_time_utc"]).replace("Z", "+00:00")
        )
        self.assertGreaterEqual(detection_time, lifecycle[1].change_time_utc)

    def test_grouping_is_equivalent_in_one_batch_and_five_second_batches(self) -> None:
        samples = group_scenario()
        one = CoreSession()
        expected = one.process_batch(samples)

        incremental = CoreSession()
        frames = []
        changes = []
        for start_second in range(0, 221, 5):
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

    def test_checkpoint_mid_group_candidate_matches_uninterrupted_session(self) -> None:
        config = CoreConfig(
            grouping=GroupingConfig(membership_confirmation_seconds=180)
        )
        samples = group_scenario(260)
        split_time = START + timedelta(seconds=160)
        first = tuple(sample for sample in samples if sample.sample_time_utc <= split_time)
        second = tuple(sample for sample in samples if sample.sample_time_utc > split_time)

        uninterrupted = CoreSession(config=config)
        first_result = uninterrupted.process_batch(first)
        self.assertTrue(
            any(change.kind is ChangeKind.GROUP_CANDIDATE for change in first_result.changes)
        )
        self.assertFalse(
            any(change.kind is ChangeKind.GROUP_CONFIRMED for change in first_result.changes)
        )
        expected_tail = uninterrupted.process_batch(second)

        before_restart = CoreSession(config=config)
        before_restart.process_batch(first)
        restored = CoreSession.from_checkpoint(
            before_restart.export_checkpoint(),
            config=config,
        )
        actual_tail = restored.process_batch(second)

        self.assertEqual(actual_tail, expected_tail)
        self.assertEqual(restored.debug_state(), uninterrupted.debug_state())
        self.assertEqual(restored.export_checkpoint(), uninterrupted.export_checkpoint())

    def test_no_data_membership_hold_ends_at_vehicle_expiry(self) -> None:
        session = CoreSession()
        samples = group_scenario()
        result = session.process_batch(samples)
        confirmed = [
            change for change in result.changes if change.kind is ChangeKind.GROUP_CONFIRMED
        ]
        self.assertEqual(len(confirmed), 1)
        self.assertEqual(len(session.grouping_snapshot().groups), 1)

        last_time = max(sample.sample_time_utc for sample in samples)
        held = session.process_batch(
            (),
            observed_until_utc=last_time + timedelta(seconds=299),
        )
        self.assertEqual(len(session.grouping_snapshot().groups), 1)
        self.assertFalse(
            any(
                change.kind is ChangeKind.GROUP_CHANGED
                and bool(change.details.get("dissolved"))
                for change in held.changes
            )
        )

        expired = session.process_batch(
            (),
            observed_until_utc=last_time + timedelta(seconds=300),
        )
        self.assertEqual(session.grouping_snapshot().groups, ())
        self.assertTrue(
            any(
                change.kind is ChangeKind.GROUP_CHANGED
                and bool(change.details.get("dissolved"))
                for change in expired.changes
            )
        )


if __name__ == "__main__":
    unittest.main()
