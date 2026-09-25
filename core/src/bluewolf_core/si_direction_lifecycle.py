"""SI wrong-direction lifecycle specified independently from grouping geometry.

The structural grouping rules require one traversal direction for a new SI
group. Once a group is confirmed, however, the V1 product contract gives a
single member a grace lifecycle: after one minute of sustained opposite motion
an alert opens, and only after five additional minutes is the member eligible
for removal. A common reversal of the whole group must not split the group.

This module consumes live movement-direction evidence. It deliberately does not
wait for route re-detection/replacement to change ``ClosedRoute.direction``.
Unknown/insufficient direction evidence neither accumulates nor clears an
existing mismatch.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Any, Iterable, Mapping

from .config import GroupingConfig
from .models import ChangeKind, Direction, StateChange


StreamKey = tuple[int, int]


@dataclass(frozen=True, slots=True)
class SIDirectionObservation:
    group_id: str
    server_id: int
    member_key: StreamKey
    direction: Direction

    def __post_init__(self) -> None:
        if not self.group_id:
            raise ValueError("group_id is required")
        if self.server_id < 0 or self.member_key[0] != self.server_id:
            raise ValueError("member_key must belong to server_id")


@dataclass(slots=True)
class _MemberMismatch:
    accumulated_seconds: float = 0.0
    last_observed_utc: datetime | None = None
    last_state_opposite: bool = False
    alert_open: bool = False


@dataclass(slots=True)
class _GroupDirectionState:
    baseline: Direction
    members: dict[StreamKey, _MemberMismatch] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class SIDirectionLifecycleResult:
    changes: tuple[StateChange, ...]
    removal_keys: tuple[StreamKey, ...]
    wrong_direction_seconds: Mapping[StreamKey, float]

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "wrong_direction_seconds",
            MappingProxyType(dict(self.wrong_direction_seconds)),
        )


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("time must be timezone-aware")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


class SIDirectionLifecycle:
    """Track sustained SI direction disagreement without changing geometry."""

    def __init__(self, config: GroupingConfig | None = None) -> None:
        self.config = config or GroupingConfig()
        self._groups: dict[str, _GroupDirectionState] = {}

    def update_group(
        self,
        group_id: str,
        observations: Iterable[SIDirectionObservation],
        observed_time_utc: datetime,
        *,
        fallback_direction: Direction = Direction.UNKNOWN,
    ) -> SIDirectionLifecycleResult:
        now = _utc(observed_time_utc)
        items = tuple(sorted(observations, key=lambda item: item.member_key))
        if any(item.group_id != group_id for item in items):
            raise ValueError("all observations must belong to group_id")

        known = [
            item.direction
            for item in items
            if item.direction is not Direction.UNKNOWN
        ]
        state = self._groups.get(group_id)
        if state is None:
            baseline = fallback_direction
            if (
                baseline is Direction.UNKNOWN
                and known
                and all(value is known[0] for value in known)
            ):
                baseline = known[0]
            state = _GroupDirectionState(baseline=baseline)
            self._groups[group_id] = state

        changes: list[StateChange] = []
        removals: set[StreamKey] = set()

        # A unanimous live reversal is a group maneuver, not a member fault.
        if (
            items
            and len(known) == len(items)
            and all(value is known[0] for value in known)
            and known[0] is not Direction.UNKNOWN
        ):
            unanimous = known[0]
            if state.baseline is Direction.UNKNOWN or unanimous is not state.baseline:
                for key, mismatch in state.members.items():
                    if mismatch.alert_open:
                        changes.append(
                            self._alert_change(
                                now,
                                ChangeKind.ALERT_CLOSED,
                                group_id,
                                key,
                                mismatch.accumulated_seconds,
                                reason="common_group_reversal",
                            )
                        )
                state.baseline = unanimous
                state.members.clear()

        alert_after = float(self.config.si_wrong_direction_alert_seconds)
        remove_after = alert_after + float(
            self.config.si_wrong_direction_exit_additional_seconds
        )
        current_keys = {item.member_key for item in items}

        for item in items:
            mismatch = state.members.setdefault(item.member_key, _MemberMismatch())
            direction = item.direction
            if state.baseline is Direction.UNKNOWN and direction is not Direction.UNKNOWN:
                state.baseline = direction

            if direction is Direction.UNKNOWN or state.baseline is Direction.UNKNOWN:
                # Unknown evidence pauses accumulation. It is not proof of either
                # recovery or continued opposite movement.
                mismatch.last_observed_utc = now
                mismatch.last_state_opposite = False
                continue

            opposite = direction is not state.baseline
            if opposite:
                if mismatch.last_state_opposite and mismatch.last_observed_utc is not None:
                    delta = max(
                        0.0,
                        (now - mismatch.last_observed_utc).total_seconds(),
                    )
                    mismatch.accumulated_seconds += delta
                mismatch.last_observed_utc = now
                mismatch.last_state_opposite = True
                if (
                    not mismatch.alert_open
                    and mismatch.accumulated_seconds >= alert_after
                ):
                    mismatch.alert_open = True
                    changes.append(
                        self._alert_change(
                            now,
                            ChangeKind.ALERT_OPENED,
                            group_id,
                            item.member_key,
                            mismatch.accumulated_seconds,
                            reason="si_wrong_direction",
                        )
                    )
                if mismatch.accumulated_seconds >= remove_after:
                    removals.add(item.member_key)
            else:
                if mismatch.alert_open:
                    changes.append(
                        self._alert_change(
                            now,
                            ChangeKind.ALERT_CLOSED,
                            group_id,
                            item.member_key,
                            mismatch.accumulated_seconds,
                            reason="direction_recovered",
                        )
                    )
                state.members[item.member_key] = _MemberMismatch(
                    accumulated_seconds=0.0,
                    last_observed_utc=now,
                    last_state_opposite=False,
                    alert_open=False,
                )

        # Expired/removed membership must not keep stale direction timers.
        for key in tuple(state.members):
            if key not in current_keys:
                state.members.pop(key, None)

        wrong_seconds = {
            key: mismatch.accumulated_seconds
            for key, mismatch in state.members.items()
            if mismatch.accumulated_seconds > 0.0
        }
        changes.sort(
            key=lambda item: (
                item.change_time_utc,
                item.server_id,
                item.vehicle_identifier
                if item.vehicle_identifier is not None
                else -1,
                item.kind.value,
            )
        )
        return SIDirectionLifecycleResult(
            changes=tuple(changes),
            removal_keys=tuple(sorted(removals)),
            wrong_direction_seconds=wrong_seconds,
        )

    def remove_groups_except(self, group_ids: Iterable[str]) -> None:
        keep = set(group_ids)
        for group_id in tuple(self._groups):
            if group_id not in keep:
                self._groups.pop(group_id, None)

    def export_state(self) -> dict[str, Any]:
        return {
            "groups": [
                {
                    "group_id": group_id,
                    "baseline": state.baseline.value,
                    "members": [
                        {
                            "member_key": [key[0], key[1]],
                            "accumulated_seconds": mismatch.accumulated_seconds,
                            "last_observed_utc": (
                                _iso(mismatch.last_observed_utc)
                                if mismatch.last_observed_utc is not None
                                else None
                            ),
                            "last_state_opposite": mismatch.last_state_opposite,
                            "alert_open": mismatch.alert_open,
                        }
                        for key, mismatch in sorted(state.members.items())
                    ],
                }
                for group_id, state in sorted(self._groups.items())
            ]
        }

    @classmethod
    def from_state(
        cls,
        raw: Mapping[str, Any],
        config: GroupingConfig | None = None,
    ) -> "SIDirectionLifecycle":
        engine = cls(config)
        for item in raw.get("groups", []):
            group_id = str(item["group_id"])
            state = _GroupDirectionState(Direction(str(item["baseline"])))
            for member in item.get("members", []):
                raw_key = member.get("member_key", ())
                if len(raw_key) != 2:
                    raise ValueError("invalid SI direction member_key")
                key = (int(raw_key[0]), int(raw_key[1]))
                raw_time = member.get("last_observed_utc")
                state.members[key] = _MemberMismatch(
                    accumulated_seconds=float(
                        member.get("accumulated_seconds", 0.0)
                    ),
                    last_observed_utc=(
                        datetime.fromisoformat(
                            str(raw_time).replace("Z", "+00:00")
                        ).astimezone(UTC)
                        if raw_time is not None
                        else None
                    ),
                    last_state_opposite=bool(
                        member.get("last_state_opposite", False)
                    ),
                    alert_open=bool(member.get("alert_open", False)),
                )
            engine._groups[group_id] = state
        return engine

    @staticmethod
    def _alert_change(
        when: datetime,
        kind: ChangeKind,
        group_id: str,
        member_key: StreamKey,
        accumulated_seconds: float,
        *,
        reason: str,
    ) -> StateChange:
        return StateChange(
            when,
            kind,
            member_key[0],
            vehicle_identifier=member_key[1],
            group_id=group_id,
            details={
                "reason": reason,
                "wrong_direction_seconds": accumulated_seconds,
            },
        )
