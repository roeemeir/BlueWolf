"""Integrated Blue Wolf session: route lifecycle + structural grouping.

The existing session remains the single route-acquisition implementation. This
layer composes grouping into that same deterministic stream: each navigation
timestamp is first processed by the route core, then current confirmed routes
are structurally grouped. No route detection or scoring logic is duplicated.
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import UTC, datetime
from itertools import groupby
from typing import Any, Iterable, Mapping

from .config import CoreConfig
from .group_lifecycle import GroupMembershipLifecycle, StructuralGroupEvidence
from .grouping import GroupObservation, GroupingSnapshot, discover_structural_groups
from .models import ChangeKind, CoreBatchResult, StateChange, VehicleFrameResult, VehicleSample
from .session import CheckpointCompatibilityError, CoreSession as RouteCoreSession


CHECKPOINT_SCHEMA_VERSION = 4
DEFAULT_ALGORITHM_VERSION = "0.6.0"


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
        self._route_support_start: dict[tuple[int, int], datetime] = {}

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
        for timestamp, bucket_iter in groupby(ordered, key=lambda item: item.sample_time_utc):
            bucket = tuple(bucket_iter)
            route_result = super().process_batch(bucket)
            self._capture_route_support(route_result.changes)

            invalidated = self._invalidated_keys(route_result.changes)
            if invalidated:
                lifecycle = self._grouping.expire_members(invalidated, timestamp)
                changes.extend(lifecycle.changes)

            lifecycle = self._refresh_groups(timestamp)
            assignments = lifecycle.snapshot.assignments
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
        observed = _utc(observed_until_utc) if observed_until_utc is not None else newest_sample
        if observed is not None and (newest_sample is None or observed > newest_sample):
            tail = super().process_batch((), observed_until_utc=observed)
            self._capture_route_support(tail.changes)
            expired = self._invalidated_keys(tail.changes)
            if expired:
                lifecycle = self._grouping.expire_members(expired, observed)
                changes.extend(lifecycle.changes)
                for key in expired:
                    self._route_support_start.pop(key, None)
            changes.extend(tail.changes)

        changes.sort(
            key=lambda item: (
                item.change_time_utc,
                item.server_id,
                item.vehicle_identifier if item.vehicle_identifier is not None else -1,
                item.group_id or "",
                item.kind.value,
            )
        )
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
                    support_start = _parse_time(str(raw)) if raw else change.change_time_utc
                self._route_support_start[key] = support_start
            elif change.kind in (
                ChangeKind.VEHICLE_DEACTIVATED,
                ChangeKind.VEHICLE_EXPIRED,
            ):
                self._route_support_start.pop(key, None)

    @staticmethod
    def _invalidated_keys(changes: Iterable[StateChange]) -> tuple[tuple[int, int], ...]:
        keys = {
            (change.server_id, change.vehicle_identifier)
            for change in changes
            if change.vehicle_identifier is not None
            and change.kind in (ChangeKind.VEHICLE_DEACTIVATED, ChangeKind.VEHICLE_EXPIRED)
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

    def _refresh_groups(self, timestamp: datetime):
        structural = discover_structural_groups(
            self._current_group_observations(),
            self.config.grouping,
        )
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

    def export_checkpoint(self) -> bytes:
        route_payload: Mapping[str, Any] = json.loads(
            super().export_checkpoint().decode("utf-8")
        )
        payload = {
            "checkpoint_schema_version": CHECKPOINT_SCHEMA_VERSION,
            "algorithm_version": self.algorithm_version,
            "route_core": route_payload,
            "grouping": self._grouping.export_state(),
            "route_support_start": [
                {
                    "server_id": key[0],
                    "vehicle_identifier": key[1],
                    "support_start_utc": _iso(value),
                }
                for key, value in sorted(self._route_support_start.items())
            ],
        }
        return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")

    @classmethod
    def from_checkpoint(
        cls,
        checkpoint: bytes | str,
        *,
        config: CoreConfig | None = None,
        algorithm_version: str = DEFAULT_ALGORITHM_VERSION,
    ) -> "CoreSession":
        raw: Mapping[str, Any] = json.loads(
            checkpoint.decode("utf-8") if isinstance(checkpoint, bytes) else checkpoint
        )
        if raw.get("checkpoint_schema_version") != CHECKPOINT_SCHEMA_VERSION:
            raise CheckpointCompatibilityError("unsupported checkpoint schema")
        if raw.get("algorithm_version") != algorithm_version:
            raise CheckpointCompatibilityError("algorithm version does not match checkpoint")
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
        for item in raw.get("route_support_start", []):
            key = (int(item["server_id"]), int(item["vehicle_identifier"]))
            session._route_support_start[key] = _parse_time(str(item["support_start_utc"]))
        return session

    def debug_state(self) -> dict[str, Any]:
        state = super().debug_state()
        state["grouping"] = self._grouping.export_state()
        state["route_support_start"] = [
            {
                "server_id": key[0],
                "vehicle_identifier": key[1],
                "support_start_utc": _iso(value),
            }
            for key, value in sorted(self._route_support_start.items())
        ]
        return state
