"""Integrated Blue Wolf session: route lifecycle + structural grouping.

The existing route session remains the single route-acquisition implementation.
This layer composes grouping into that deterministic stream: each navigation
timestamp is first processed by the route core, then current confirmed routes
are structurally grouped. No route detection or synchronization scoring logic
is duplicated.
"""
from __future__ import annotations

import json
import statistics
from dataclasses import replace
from datetime import UTC, datetime
from itertools import groupby
from typing import Any, Iterable, Mapping, Sequence

from .config import CoreConfig
from .group_lifecycle import GroupMembershipLifecycle, StructuralGroupEvidence
from .grouping import (
    GroupObservation,
    GroupingSnapshot,
    StructuralGroup,
    base_period_seconds,
    discover_structural_groups,
    routes_compatible,
)
from .models import (
    ChangeKind,
    CoreBatchResult,
    Direction,
    RouteFamily,
    StateChange,
    VehicleFrameResult,
    VehicleSample,
)
from .session import CheckpointCompatibilityError, CoreSession as RouteCoreSession
from .si_direction_evidence import live_si_direction
from .si_direction_lifecycle import (
    SIDirectionLifecycle,
    SIDirectionLifecycleResult,
    SIDirectionObservation,
)


CHECKPOINT_SCHEMA_VERSION = 5
DEFAULT_ALGORITHM_VERSION = "0.7.0"


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("time must be timezone-aware")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


class CoreSession(RouteCoreSession):
    """One public deterministic session including route and group lifecycles."""

    def __init__(
        self,
        config: CoreConfig | None = None,
        algorithm_version: str = DEFAULT_ALGORITHM_VERSION,
    ) -> None:
        super().__init__(config=config, algorithm_version=algorithm_version)
        self._grouping = GroupMembershipLifecycle(self.config.grouping)
        self._si_direction = SIDirectionLifecycle(self.config.grouping)
        self._route_support_start: dict[tuple[int, int], datetime] = {}
        self._wrong_direction_seconds: dict[tuple[int, int], float] = {}

    def process_batch(
        self,
        samples: Iterable[VehicleSample],
        *,
        observed_until_utc: datetime | None = None,
    ) -> CoreBatchResult:
        ordered = sorted(
            samples,
            key=lambda item: (
                item.sample_time_utc,
                item.server_id,
                item.vehicle_identifier,
                item.vehicle_number,
            ),
        )
        frames: list[VehicleFrameResult] = []
        changes: list[StateChange] = []

        # Grouping is evaluated after all vehicle samples at the same timestamp.
        # This prevents input ordering from giving one member a stale group id.
        for timestamp, bucket_iter in groupby(
            ordered,
            key=lambda item: item.sample_time_utc,
        ):
            bucket = tuple(bucket_iter)
            route_result = super().process_batch(bucket)
            self._capture_route_support(route_result.changes)

            invalidated = self._invalidated_keys(route_result.changes)
            if invalidated:
                lifecycle = self._grouping.expire_members(invalidated, timestamp)
                changes.extend(lifecycle.changes)
                for key in invalidated:
                    self._wrong_direction_seconds.pop(key, None)

            direction_result = self._update_si_direction(bucket, timestamp)
            changes.extend(direction_result.changes)
            if direction_result.removal_keys:
                lifecycle = self._grouping.expire_members(
                    direction_result.removal_keys,
                    timestamp,
                )
                changes.extend(lifecycle.changes)
                for key in direction_result.removal_keys:
                    self._wrong_direction_seconds.pop(key, None)

            lifecycle = self._refresh_groups(timestamp)
            assignments = lifecycle.snapshot.assignments
            self._si_direction.remove_groups_except(
                group.group_id
                for group in lifecycle.snapshot.groups
                if group.family is RouteFamily.SI
            )
            changes.extend(route_result.changes)
            changes.extend(lifecycle.changes)
            frames.extend(
                replace(
                    frame,
                    group_id=(
                        assignments.get((frame.server_id, frame.vehicle_identifier))
                        if frame.active is not False
                        else None
                    ),
                )
                for frame in route_result.frames
            )

        newest_sample = ordered[-1].sample_time_utc if ordered else None
        observed = (
            _utc(observed_until_utc)
            if observed_until_utc is not None
            else newest_sample
        )
        if observed is not None and (newest_sample is None or observed > newest_sample):
            tail = super().process_batch((), observed_until_utc=observed)
            self._capture_route_support(tail.changes)
            expired = self._invalidated_keys(tail.changes)
            if expired:
                lifecycle = self._grouping.expire_members(expired, observed)
                changes.extend(lifecycle.changes)
                for key in expired:
                    self._route_support_start.pop(key, None)
                    self._wrong_direction_seconds.pop(key, None)
            changes.extend(tail.changes)
            self._si_direction.remove_groups_except(
                group.group_id
                for group in self._grouping.groups
                if group.family is RouteFamily.SI
            )

        # Preserve deterministic emission order. Some lifecycle events are
        # intentionally backdated in change_time_utc after enough evidence is
        # collected. Re-sorting by that retroactive time would make one large
        # batch return a different event sequence than equivalent live batches.
        return CoreBatchResult(
            schema_version=1,
            algorithm_version=self.algorithm_version,
            frames=tuple(frames),
            changes=tuple(changes),
            processed_until_utc=self._processed_until_utc,
        )

    def _capture_route_support(self, changes: Iterable[StateChange]) -> None:
        for change in changes:
            if change.vehicle_identifier is None:
                continue
            key = (change.server_id, change.vehicle_identifier)
            if change.kind is ChangeKind.ROUTE_CONFIRMED:
                if bool(change.details.get("replacement", False)):
                    support_start = change.change_time_utc
                else:
                    raw = change.details.get("evidence_window_start_utc")
                    support_start = (
                        _parse_time(str(raw))
                        if raw
                        else change.change_time_utc
                    )
                self._route_support_start[key] = support_start
            elif change.kind in (
                ChangeKind.VEHICLE_DEACTIVATED,
                ChangeKind.VEHICLE_EXPIRED,
            ):
                self._route_support_start.pop(key, None)

    @staticmethod
    def _invalidated_keys(
        changes: Iterable[StateChange],
    ) -> tuple[tuple[int, int], ...]:
        keys = {
            (change.server_id, change.vehicle_identifier)
            for change in changes
            if change.vehicle_identifier is not None
            and change.kind
            in (ChangeKind.VEHICLE_DEACTIVATED, ChangeKind.VEHICLE_EXPIRED)
        }
        return tuple(sorted(keys))

    def _current_group_observations(self) -> tuple[GroupObservation, ...]:
        output: list[GroupObservation] = []
        for key in sorted(self._routes):
            route_state = self._routes[key]
            vehicle_state = self._states.get(key)
            if (
                route_state.confirmed is None
                or vehicle_state is None
                or vehicle_state.expired
                or vehicle_state.active is False
                or key not in self._route_support_start
            ):
                continue
            output.append(
                GroupObservation(
                    server_id=key[0],
                    vehicle_identifier=key[1],
                    route=route_state.confirmed,
                    reliability=vehicle_state.reliability,
                    active=vehicle_state.active,
                )
            )
        return tuple(output)

    def _update_si_direction(
        self,
        bucket: Sequence[VehicleSample],
        timestamp: datetime,
    ) -> SIDirectionLifecycleResult:
        sample_by_key = {sample.stream_key: sample for sample in bucket}
        changes: list[StateChange] = []
        removals: set[tuple[int, int]] = set()
        wrong_seconds: dict[tuple[int, int], float] = {}

        for group in self._grouping.groups:
            if group.family is not RouteFamily.SI:
                continue
            direction_observations: list[SIDirectionObservation] = []
            route_directions: list[Direction] = []
            for key in group.member_keys:
                route_state = self._routes.get(key)
                route = route_state.confirmed if route_state is not None else None
                if route is not None and route.direction is not Direction.UNKNOWN:
                    route_directions.append(route.direction)
                sample = sample_by_key.get(key)
                direction = (
                    live_si_direction(sample, route)
                    if sample is not None and route is not None
                    else Direction.UNKNOWN
                )
                direction_observations.append(
                    SIDirectionObservation(
                        group_id=group.group_id,
                        server_id=group.server_id,
                        member_key=key,
                        direction=direction,
                    )
                )

            fallback = Direction.UNKNOWN
            if route_directions and all(
                direction is route_directions[0]
                for direction in route_directions
            ):
                fallback = route_directions[0]
            result = self._si_direction.update_group(
                group.group_id,
                direction_observations,
                timestamp,
                fallback_direction=fallback,
            )
            changes.extend(result.changes)
            removals.update(result.removal_keys)
            wrong_seconds.update(result.wrong_direction_seconds)

        self._wrong_direction_seconds = wrong_seconds
        return SIDirectionLifecycleResult(
            changes=tuple(changes),
            removal_keys=tuple(sorted(removals)),
            wrong_direction_seconds=wrong_seconds,
        )

    @staticmethod
    def _si_group_still_geometry_period_compatible(
        members: Sequence[GroupObservation],
        config,
    ) -> bool:
        # Existing SI membership may ignore only the direction reason while its
        # dedicated 60s+300s direction lifecycle runs. Every other hard grouping
        # condition remains active.
        for index, first in enumerate(members):
            for second in members[index + 1 :]:
                compatibility = routes_compatible(first, second, config)
                if compatibility.compatible:
                    continue
                if any(reason != "direction" for reason in compatibility.reasons):
                    return False
        return True

    def _refresh_groups(self, timestamp: datetime):
        observations = self._current_group_observations()
        by_key = {observation.stream_key: observation for observation in observations}
        strict = list(discover_structural_groups(observations, self.config.grouping))

        retained: list[StructuralGroup] = []
        protected_members: set[tuple[int, int]] = set()
        for old in self._grouping.groups:
            if old.family is not RouteFamily.SI:
                continue
            if any(key not in by_key for key in old.member_keys):
                continue
            members = [by_key[key] for key in old.member_keys]
            if not self._si_group_still_geometry_period_compatible(
                members,
                self.config.grouping,
            ):
                continue

            old_members = set(old.member_keys)
            # If strict grouping contains the entire old group, normal lifecycle
            # semantics should handle same-membership or a legitimate merge.
            if any(
                old_members.issubset(set(candidate.member_keys))
                for candidate in strict
                if candidate.family is RouteFamily.SI
            ):
                continue

            retained.append(
                StructuralGroup(
                    server_id=old.server_id,
                    family=RouteFamily.SI,
                    member_keys=old.member_keys,
                    route_ids=tuple(by_key[key].route.route_id for key in old.member_keys),
                    base_period_s=float(
                        statistics.median(
                            base_period_seconds(by_key[key].route)
                            for key in old.member_keys
                        )
                    ),
                )
            )
            protected_members.update(old.member_keys)

        if protected_members:
            strict = [
                candidate
                for candidate in strict
                if not (
                    candidate.family is RouteFamily.SI
                    and set(candidate.member_keys).intersection(protected_members)
                )
            ]

        structural = tuple(strict + retained)
        evidence: list[StructuralGroupEvidence] = []
        for group in structural:
            starts = [
                self._route_support_start[key]
                for key in group.member_keys
                if key in self._route_support_start
            ]
            if len(starts) != len(group.member_keys):
                continue
            # All members must have supported their current route since this
            # common instant. This is already-collected evidence, not a new wait.
            evidence.append(StructuralGroupEvidence(group, max(starts)))
        return self._grouping.update(evidence, timestamp)

    def grouping_snapshot(self) -> GroupingSnapshot:
        return self._grouping.snapshot()

    def wrong_direction_seconds(self) -> Mapping[tuple[int, int], float]:
        return dict(self._wrong_direction_seconds)

    def export_checkpoint(self) -> bytes:
        route_payload: Mapping[str, Any] = json.loads(
            super().export_checkpoint().decode("utf-8")
        )
        payload = {
            "checkpoint_schema_version": CHECKPOINT_SCHEMA_VERSION,
            "algorithm_version": self.algorithm_version,
            "route_core": route_payload,
            "grouping": self._grouping.export_state(),
            "si_direction": self._si_direction.export_state(),
            "wrong_direction_seconds": [
                {
                    "server_id": key[0],
                    "vehicle_identifier": key[1],
                    "seconds": value,
                }
                for key, value in sorted(self._wrong_direction_seconds.items())
            ],
            "route_support_start": [
                {
                    "server_id": key[0],
                    "vehicle_identifier": key[1],
                    "support_start_utc": _iso(value),
                }
                for key, value in sorted(self._route_support_start.items())
            ],
        }
        return json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")

    @classmethod
    def from_checkpoint(
        cls,
        checkpoint: bytes | str,
        *,
        config: CoreConfig | None = None,
        algorithm_version: str = DEFAULT_ALGORITHM_VERSION,
    ) -> "CoreSession":
        raw: Mapping[str, Any] = json.loads(
            checkpoint.decode("utf-8")
            if isinstance(checkpoint, bytes)
            else checkpoint
        )
        if raw.get("checkpoint_schema_version") != CHECKPOINT_SCHEMA_VERSION:
            raise CheckpointCompatibilityError("unsupported checkpoint schema")
        if raw.get("algorithm_version") != algorithm_version:
            raise CheckpointCompatibilityError(
                "algorithm version does not match checkpoint"
            )
        route_raw = raw.get("route_core")
        if not isinstance(route_raw, Mapping):
            raise CheckpointCompatibilityError("missing route core checkpoint")

        config = config or CoreConfig()
        restored_route = RouteCoreSession.from_checkpoint(
            json.dumps(route_raw, sort_keys=True, separators=(",", ":")),
            config=config,
            algorithm_version=algorithm_version,
        )
        session = cls(config=config, algorithm_version=algorithm_version)
        session._states = restored_route._states
        session._routes = restored_route._routes
        session._processed_until_utc = restored_route._processed_until_utc

        grouping_raw = raw.get("grouping", {})
        if isinstance(grouping_raw, Mapping):
            session._grouping = GroupMembershipLifecycle.from_state(
                grouping_raw,
                config.grouping,
            )
        direction_raw = raw.get("si_direction", {})
        if isinstance(direction_raw, Mapping):
            session._si_direction = SIDirectionLifecycle.from_state(
                direction_raw,
                config.grouping,
            )
        for item in raw.get("wrong_direction_seconds", []):
            key = (int(item["server_id"]), int(item["vehicle_identifier"]))
            session._wrong_direction_seconds[key] = float(item["seconds"])
        for item in raw.get("route_support_start", []):
            key = (int(item["server_id"]), int(item["vehicle_identifier"]))
            session._route_support_start[key] = _parse_time(
                str(item["support_start_utc"])
            )
        return session

    def debug_state(self) -> dict[str, Any]:
        state = super().debug_state()
        state["grouping"] = self._grouping.export_state()
        state["si_direction"] = self._si_direction.export_state()
        state["wrong_direction_seconds"] = [
            {
                "server_id": key[0],
                "vehicle_identifier": key[1],
                "seconds": value,
            }
            for key, value in sorted(self._wrong_direction_seconds.items())
        ]
        state["route_support_start"] = [
            {
                "server_id": key[0],
                "vehicle_identifier": key[1],
                "support_start_utc": _iso(value),
            }
            for key, value in sorted(self._route_support_start.items())
        ]
        return state