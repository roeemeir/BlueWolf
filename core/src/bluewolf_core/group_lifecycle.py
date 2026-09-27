"""Temporal membership lifecycle layered on structural grouping.

The structural grouping engine answers *who is compatible now*. This module
adds the V1 membership hold: a new structural membership must be supported for
``membership_confirmation_seconds`` inside already-collected evidence before it
becomes operational. Existing confirmed identities remain in place while a
replacement candidate is still accumulating evidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Iterable, Mapping

from .config import GroupingConfig
from .grouping import (
    GroupingSnapshot,
    RouteGroup,
    StableGroupingEngine,
    StructuralGroup,
    StreamKey,
)
from .models import ChangeKind, StateChange


@dataclass(frozen=True, slots=True)
class StructuralGroupEvidence:
    structural: StructuralGroup
    support_start_utc: datetime

    def __post_init__(self) -> None:
        if self.support_start_utc.tzinfo is None:
            raise ValueError("support_start_utc must be timezone-aware")
        object.__setattr__(self, "support_start_utc", self.support_start_utc.astimezone(UTC))


@dataclass(frozen=True, slots=True)
class GroupLifecycleResult:
    snapshot: GroupingSnapshot
    changes: tuple[StateChange, ...]


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("time must be timezone-aware")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _signature(group: StructuralGroup | RouteGroup) -> tuple[StreamKey, ...]:
    return tuple(sorted(group.member_keys))


def _carry(group: RouteGroup) -> StructuralGroup:
    return StructuralGroup(
        server_id=group.server_id,
        family=group.family,
        member_keys=group.member_keys,
        route_ids=group.route_ids,
        base_period_s=group.base_period_s,
    )


class GroupMembershipLifecycle:
    """Stateful candidate→confirmed lifecycle for structural memberships."""

    def __init__(self, config: GroupingConfig | None = None) -> None:
        self.config = config or GroupingConfig()
        self._stable = StableGroupingEngine(self.config)
        self._candidate_support: dict[tuple[StreamKey, ...], datetime] = {}
        self._announced: set[tuple[StreamKey, ...]] = set()

    @property
    def groups(self) -> tuple[RouteGroup, ...]:
        return self._stable.groups

    def snapshot(self) -> GroupingSnapshot:
        assignments = {
            key: group.group_id for group in self.groups for key in group.member_keys
        }
        return GroupingSnapshot(self.groups, assignments)

    def update(
        self,
        evidence: Iterable[StructuralGroupEvidence],
        observed_time_utc: datetime,
    ) -> GroupLifecycleResult:
        now = _utc(observed_time_utc)
        by_signature: dict[tuple[StreamKey, ...], StructuralGroupEvidence] = {}
        for item in evidence:
            signature = _signature(item.structural)
            current = by_signature.get(signature)
            if current is None or item.support_start_utc < current.support_start_utc:
                by_signature[signature] = item

        # Continuity matters. If a structural candidate disappears, its old
        # support cannot be reused if the same membership returns later.
        current_signatures = set(by_signature)
        for signature in tuple(self._candidate_support):
            if signature not in current_signatures:
                self._candidate_support.pop(signature, None)
                self._announced.discard(signature)

        old_groups = self.groups
        old_by_id = {group.group_id: group for group in old_groups}
        old_signatures = {_signature(group) for group in old_groups}
        changes: list[StateChange] = []

        for signature, item in sorted(by_signature.items()):
            previous_start = self._candidate_support.get(signature)
            support_start = (
                item.support_start_utc
                if previous_start is None
                else min(previous_start, item.support_start_utc)
            )
            self._candidate_support[signature] = support_start
            if signature not in old_signatures and signature not in self._announced:
                self._announced.add(signature)
                changes.append(
                    StateChange(
                        support_start,
                        ChangeKind.GROUP_CANDIDATE,
                        item.structural.server_id,
                        details={
                            "member_keys": [list(key) for key in signature],
                            "family": item.structural.family.value,
                            "support_start_utc": _iso(support_start),
                            "detection_time_utc": _iso(now),
                            "retroactive_candidate": support_start < now,
                            "required_support_seconds": self.config.membership_confirmation_seconds,
                        },
                    )
                )

        required = timedelta(seconds=self.config.membership_confirmation_seconds)
        mature: list[StructuralGroupEvidence] = []
        for signature, item in by_signature.items():
            support_start = self._candidate_support[signature]
            if now - support_start >= required:
                mature.append(StructuralGroupEvidence(item.structural, support_start))

        # A pending replacement must not prematurely destroy an existing group.
        # Only mature structural evidence is allowed to supersede an old id.
        mature_overlap_old_ids: set[str] = set()
        for item in mature:
            members = set(item.structural.member_keys)
            for old in old_groups:
                if members.intersection(old.member_keys):
                    mature_overlap_old_ids.add(old.group_id)

        target = [item.structural for item in mature]
        target.extend(
            _carry(old) for old in old_groups if old.group_id not in mature_overlap_old_ids
        )
        next_snapshot = self._stable.reconcile(target)

        maturity_by_signature = {
            _signature(item.structural): self._candidate_support[_signature(item.structural)]
            + required
            for item in mature
        }

        for group in next_snapshot.groups:
            signature = _signature(group)
            previous = old_by_id.get(group.group_id)
            if previous is not None and _signature(previous) == signature:
                continue

            support_confirmed_at = maturity_by_signature.get(signature, now)
            overlapping_old = [
                old
                for old in old_groups
                if set(old.member_keys).intersection(group.member_keys)
            ]
            if previous is None and not overlapping_old:
                kind = ChangeKind.GROUP_CONFIRMED
            else:
                kind = ChangeKind.GROUP_CHANGED

            changes.append(
                StateChange(
                    min(now, support_confirmed_at),
                    kind,
                    group.server_id,
                    group_id=group.group_id,
                    details={
                        "member_keys": [list(key) for key in group.member_keys],
                        "family": group.family.value,
                        "base_period_s": group.base_period_s,
                        "previous_group_ids": [old.group_id for old in overlapping_old],
                        "detection_time_utc": _iso(now),
                        "retroactive_confirmation": support_confirmed_at < now,
                    },
                )
            )

        # Candidate announcements become irrelevant once that exact membership
        # is confirmed. Keeping them would suppress a legitimate later candidate
        # if the group disappears and reappears after a discontinuity.
        confirmed_signatures = {_signature(group) for group in next_snapshot.groups}
        for signature in confirmed_signatures:
            self._announced.discard(signature)

        changes.sort(
            key=lambda item: (
                item.change_time_utc,
                item.server_id,
                item.group_id or "",
                item.kind.value,
            )
        )
        return GroupLifecycleResult(next_snapshot, tuple(changes))

    def expire_members(
        self,
        expired_keys: Iterable[StreamKey],
        observed_time_utc: datetime,
    ) -> GroupLifecycleResult:
        """Apply the five-minute communication hold boundary deterministically.

        Before ``VEHICLE_EXPIRED`` the old confirmed membership is intentionally
        retained. At expiry the missing members are removed immediately because
        the hold itself already supplied the temporal grace period. Surviving
        groups keep their id only if the normal 60% preservation rule allows it.
        """

        now = _utc(observed_time_utc)
        expired = set(expired_keys)
        if not expired:
            return GroupLifecycleResult(self.snapshot(), ())

        old_groups = self.groups
        old_by_id = {group.group_id: group for group in old_groups}
        target: list[StructuralGroup] = []
        for group in old_groups:
            kept_indices = [
                index
                for index, key in enumerate(group.member_keys)
                if key not in expired
            ]
            if len(kept_indices) < self.config.minimum_valid_vehicles:
                continue
            target.append(
                StructuralGroup(
                    server_id=group.server_id,
                    family=group.family,
                    member_keys=tuple(group.member_keys[index] for index in kept_indices),
                    route_ids=tuple(group.route_ids[index] for index in kept_indices),
                    base_period_s=group.base_period_s,
                )
            )

        next_snapshot = self._stable.reconcile(target)
        next_by_id = {group.group_id: group for group in next_snapshot.groups}
        changes: list[StateChange] = []

        for group in next_snapshot.groups:
            previous = old_by_id.get(group.group_id)
            if previous is not None and previous.member_keys == group.member_keys:
                continue
            overlapping_old = [
                old
                for old in old_groups
                if set(old.member_keys).intersection(group.member_keys)
            ]
            changes.append(
                StateChange(
                    now,
                    ChangeKind.GROUP_CHANGED,
                    group.server_id,
                    group_id=group.group_id,
                    details={
                        "member_keys": [list(key) for key in group.member_keys],
                        "previous_group_ids": [old.group_id for old in overlapping_old],
                        "expired_member_keys": [list(key) for key in sorted(expired)],
                        "dissolved": False,
                    },
                )
            )

        for old in old_groups:
            if old.group_id in next_by_id:
                continue
            if not set(old.member_keys).intersection(expired):
                continue
            # If an identity reset created a successor with <60% retained, the
            # old identity still closes explicitly at the hold boundary.
            changes.append(
                StateChange(
                    now,
                    ChangeKind.GROUP_CHANGED,
                    old.server_id,
                    group_id=old.group_id,
                    details={
                        "member_keys": [list(key) for key in old.member_keys],
                        "expired_member_keys": [list(key) for key in sorted(expired)],
                        "dissolved": True,
                    },
                )
            )

        for signature in tuple(self._candidate_support):
            if set(signature).intersection(expired):
                self._candidate_support.pop(signature, None)
                self._announced.discard(signature)

        changes.sort(
            key=lambda item: (
                item.change_time_utc,
                item.server_id,
                item.group_id or "",
                item.kind.value,
            )
        )
        return GroupLifecycleResult(next_snapshot, tuple(changes))

    def export_state(self) -> dict[str, Any]:
        return {
            "stable": self._stable.export_state(),
            "candidates": [
                {
                    "member_keys": [list(key) for key in signature],
                    "support_start_utc": _iso(start),
                    "announced": signature in self._announced,
                }
                for signature, start in sorted(self._candidate_support.items())
            ],
        }

    @classmethod
    def from_state(
        cls,
        raw: Mapping[str, Any],
        config: GroupingConfig | None = None,
    ) -> "GroupMembershipLifecycle":
        engine = cls(config)
        stable_raw = raw.get("stable", {})
        if isinstance(stable_raw, Mapping):
            engine._stable = StableGroupingEngine.from_state(stable_raw, engine.config)
        for item in raw.get("candidates", []):
            keys = tuple(
                (int(key[0]), int(key[1])) for key in item.get("member_keys", [])
            )
            start = datetime.fromisoformat(
                str(item["support_start_utc"]).replace("Z", "+00:00")
            ).astimezone(UTC)
            engine._candidate_support[keys] = start
            if bool(item.get("announced", False)):
                engine._announced.add(keys)
        return engine
