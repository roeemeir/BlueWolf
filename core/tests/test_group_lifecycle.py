from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core.config import GroupingConfig
from bluewolf_core.group_lifecycle import (
    GroupMembershipLifecycle,
    StructuralGroupEvidence,
)
from bluewolf_core.grouping import StructuralGroup
from bluewolf_core.models import ChangeKind, RouteFamily


BASE_TIME = datetime(2026, 9, 8, 12, 0, tzinfo=UTC)


def _structural(
    members: tuple[int, ...],
    *,
    family: RouteFamily = RouteFamily.SI,
    period_s: float = 120.0,
) -> StructuralGroup:
    return StructuralGroup(
        server_id=1,
        family=family,
        member_keys=tuple((1, member) for member in members),
        route_ids=tuple(f"route-{member}" for member in members),
        base_period_s=period_s,
    )


def _evidence(
    members: tuple[int, ...],
    support_start: datetime,
    *,
    family: RouteFamily = RouteFamily.SI,
) -> StructuralGroupEvidence:
    return StructuralGroupEvidence(
        _structural(members, family=family),
        support_start,
    )


class GroupMembershipLifecycleTests(unittest.TestCase):
    def test_candidate_does_not_confirm_before_required_support(self) -> None:
        engine = GroupMembershipLifecycle()
        result = engine.update(
            (_evidence((1, 2), BASE_TIME),),
            BASE_TIME + timedelta(seconds=119),
        )
        self.assertEqual(result.snapshot.groups, ())
        self.assertEqual(len(result.changes), 1)
        self.assertIs(result.changes[0].kind, ChangeKind.GROUP_CANDIDATE)
        self.assertEqual(result.changes[0].change_time_utc, BASE_TIME)

    def test_existing_history_can_confirm_retroactively_without_new_wait(self) -> None:
        engine = GroupMembershipLifecycle()
        now = BASE_TIME + timedelta(seconds=180)
        result = engine.update((_evidence((1, 2), BASE_TIME),), now)
        self.assertEqual(len(result.snapshot.groups), 1)
        kinds = [change.kind for change in result.changes]
        self.assertEqual(kinds, [ChangeKind.GROUP_CANDIDATE, ChangeKind.GROUP_CONFIRMED])
        confirmed = result.changes[1]
        self.assertEqual(
            confirmed.change_time_utc,
            BASE_TIME + timedelta(seconds=120),
        )
        self.assertTrue(confirmed.details["retroactive_confirmation"])

    def test_same_confirmed_membership_does_not_emit_duplicate_events(self) -> None:
        engine = GroupMembershipLifecycle()
        first = engine.update(
            (_evidence((1, 2), BASE_TIME),),
            BASE_TIME + timedelta(seconds=130),
        )
        group_id = first.snapshot.groups[0].group_id
        second = engine.update(
            (_evidence((1, 2), BASE_TIME),),
            BASE_TIME + timedelta(seconds=200),
        )
        self.assertEqual(second.snapshot.groups[0].group_id, group_id)
        self.assertEqual(second.changes, ())

    def test_pending_membership_change_keeps_old_group_until_mature(self) -> None:
        engine = GroupMembershipLifecycle()
        initial = engine.update(
            (_evidence((1, 2, 3), BASE_TIME),),
            BASE_TIME + timedelta(seconds=130),
        )
        group_id = initial.snapshot.groups[0].group_id
        change_start = BASE_TIME + timedelta(seconds=200)
        pending = engine.update(
            (_evidence((1, 2, 3, 4), change_start),),
            change_start + timedelta(seconds=60),
        )
        self.assertEqual(len(pending.snapshot.groups), 1)
        self.assertEqual(pending.snapshot.groups[0].group_id, group_id)
        self.assertEqual(pending.snapshot.groups[0].member_keys, ((1, 1), (1, 2), (1, 3)))

    def test_mature_membership_addition_preserves_group_id(self) -> None:
        engine = GroupMembershipLifecycle()
        initial = engine.update(
            (_evidence((1, 2, 3), BASE_TIME),),
            BASE_TIME + timedelta(seconds=130),
        )
        group_id = initial.snapshot.groups[0].group_id
        change_start = BASE_TIME + timedelta(seconds=200)
        result = engine.update(
            (_evidence((1, 2, 3, 4), change_start),),
            change_start + timedelta(seconds=125),
        )
        self.assertEqual(result.snapshot.groups[0].group_id, group_id)
        changed = [item for item in result.changes if item.kind is ChangeKind.GROUP_CHANGED]
        self.assertEqual(len(changed), 1)
        self.assertEqual(changed[0].group_id, group_id)

    def test_mature_merge_of_two_groups_creates_new_id(self) -> None:
        engine = GroupMembershipLifecycle()
        initial = engine.update(
            (
                _evidence((1, 2, 3), BASE_TIME),
                _evidence((4, 5, 6), BASE_TIME),
            ),
            BASE_TIME + timedelta(seconds=130),
        )
        old_ids = {group.group_id for group in initial.snapshot.groups}
        merge_start = BASE_TIME + timedelta(seconds=200)
        merged = engine.update(
            (_evidence((1, 2, 3, 4, 5, 6), merge_start),),
            merge_start + timedelta(seconds=125),
        )
        self.assertEqual(len(merged.snapshot.groups), 1)
        self.assertNotIn(merged.snapshot.groups[0].group_id, old_ids)
        changes = [item for item in merged.changes if item.kind is ChangeKind.GROUP_CHANGED]
        self.assertEqual(len(changes), 1)
        self.assertEqual(set(changes[0].details["previous_group_ids"]), old_ids)

    def test_discontinuous_candidate_does_not_reuse_old_support(self) -> None:
        engine = GroupMembershipLifecycle()
        engine.update(
            (_evidence((1, 2), BASE_TIME),),
            BASE_TIME + timedelta(seconds=80),
        )
        engine.update((), BASE_TIME + timedelta(seconds=90))
        restarted = BASE_TIME + timedelta(seconds=100)
        result = engine.update(
            (_evidence((1, 2), restarted),),
            restarted + timedelta(seconds=30),
        )
        self.assertEqual(result.snapshot.groups, ())

    def test_checkpoint_round_trip_preserves_mid_candidate_support(self) -> None:
        config = GroupingConfig(membership_confirmation_seconds=120)
        engine = GroupMembershipLifecycle(config)
        engine.update(
            (_evidence((1, 2), BASE_TIME),),
            BASE_TIME + timedelta(seconds=70),
        )
        restored = GroupMembershipLifecycle.from_state(engine.export_state(), config)
        result = restored.update(
            (_evidence((1, 2), BASE_TIME),),
            BASE_TIME + timedelta(seconds=125),
        )
        self.assertEqual(len(result.snapshot.groups), 1)
        self.assertEqual(
            [item.kind for item in result.changes],
            [ChangeKind.GROUP_CONFIRMED],
        )

    def test_naive_time_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            StructuralGroupEvidence(_structural((1, 2)), datetime(2026, 9, 8, 12, 0))


if __name__ == "__main__":
    unittest.main()
