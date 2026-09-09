"""Operational publication bridge from semantic-core poll results to runtime snapshots.

This layer deliberately owns no route detection, grouping, template generation or
score law. It composes already-validated outputs and explicit product metadata:

    IngestPollResult + Semantic CoreSession
        -> current structural SO groups
        -> explicit operational bindings
        -> LiveSOEventRuntime
        -> bluewolf.live-runtime.v1
        -> RuntimeSnapshotStore

The bridge is fail-closed. Vehicle type, Route Instance membership, work speed,
arena and displayed-score policy are never inferred from identifiers or geometry.
A group without complete bindings or a coherent common timestamp is skipped.

``groupList`` is emitted in addition to the legacy ``groups.so`` slot. The latter
keeps the existing Web client compatible; ``groupList`` preserves every SO group
so a later UI migration cannot lose groups by family-key overwrite.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
import math
from types import MappingProxyType
from typing import Callable, Mapping

from bluewolf_core.grouping import RouteGroup
from bluewolf_core.live_so_event_runtime import LiveSOEventRuntime, TemplateComparisonDimension
from bluewolf_core.live_so_scoring import LiveSOMemberInput
from bluewolf_core.models import RouteFamily, VehicleFrameResult, VehicleSample
from bluewolf_core.semantic_session import CoreSession
from bluewolf_core.so_template_bank import SOConstellationSignature

from .contract import LIVE_RUNTIME_SCHEMA_VERSION, build_so_live_runtime_snapshot
from .ingest_coordinator import IngestPollResult
from .service import RuntimeSnapshotStore


@dataclass(frozen=True, slots=True)
class SOOperationalMemberBinding:
    """Product-owned metadata for one current SO group member."""

    vehicle_identifier: int
    vehicle_type: str
    route_instance_id: str
    work_speed_mps: float
    member_id: str | None = None

    def __post_init__(self) -> None:
        if (
            isinstance(self.vehicle_identifier, bool)
            or not isinstance(self.vehicle_identifier, int)
            or self.vehicle_identifier < 0
        ):
            raise ValueError("vehicle_identifier must be a non-negative integer")
        if not self.vehicle_type:
            raise ValueError("vehicle_type is required")
        if not self.route_instance_id:
            raise ValueError("route_instance_id is required")
        if not math.isfinite(self.work_speed_mps) or self.work_speed_mps <= 0.0:
            raise ValueError("work_speed_mps must be finite and positive")
        if self.member_id == "":
            raise ValueError("member_id must be non-empty when supplied")

    @property
    def resolved_member_id(self) -> str:
        return self.member_id or str(self.vehicle_identifier)


@dataclass(frozen=True, slots=True)
class SOOperationalGroupBinding:
    """Explicit application configuration needed to score one structural SO group."""

    group_id: str
    constellation: SOConstellationSignature
    members: tuple[SOOperationalMemberBinding, ...]
    arena: str
    group_name: str | None = None
    subtitle: str = "Python Core · SO"
    color: str = "#4378e8"

    def __post_init__(self) -> None:
        if not self.group_id:
            raise ValueError("group_id is required")
        if not self.members:
            raise ValueError("SO group binding requires members")
        ids = [item.vehicle_identifier for item in self.members]
        if len(ids) != len(set(ids)):
            raise ValueError("SO group binding vehicle identifiers must be unique")
        member_ids = [item.resolved_member_id for item in self.members]
        if len(member_ids) != len(set(member_ids)):
            raise ValueError("SO group binding member ids must be unique")
        if not self.arena:
            raise ValueError("arena is required")
        if not self.color:
            raise ValueError("color is required")

    @property
    def by_vehicle_identifier(self) -> Mapping[int, SOOperationalMemberBinding]:
        return MappingProxyType({item.vehicle_identifier: item for item in self.members})


@dataclass(frozen=True, slots=True)
class DisplayedScoreValue:
    score: float | None
    valid: bool

    def __post_init__(self) -> None:
        if self.valid and self.score is None:
            raise ValueError("valid displayed score requires a numeric value")
        if self.score is not None:
            numeric = float(self.score)
            if not math.isfinite(numeric) or not 0.0 <= numeric <= 100.0:
                raise ValueError("displayed score must be finite and in [0,100]")


BindingResolver = Callable[[RouteGroup], SOOperationalGroupBinding | None]
DisplayedScoreResolver = Callable[[str, datetime], DisplayedScoreValue]


@dataclass(frozen=True, slots=True)
class RuntimePublicationResult:
    snapshot: Mapping[str, object] | None
    published_group_ids: tuple[str, ...]
    skipped_groups: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "skipped_groups", MappingProxyType(dict(self.skipped_groups)))


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("runtime publication time must be timezone-aware")
    return value.astimezone(UTC)


class LiveRuntimeProducer:
    """Publish current SO runtime state for one server after a successful poll."""

    def __init__(
        self,
        *,
        server_id: int,
        session: CoreSession,
        runtime: LiveSOEventRuntime,
        store: RuntimeSnapshotStore,
        binding_resolver: BindingResolver,
        displayed_score_resolver: DisplayedScoreResolver,
    ) -> None:
        if isinstance(server_id, bool) or not isinstance(server_id, int) or server_id < 0:
            raise ValueError("server_id must be a non-negative integer")
        self.server_id = server_id
        self.session = session
        self.runtime = runtime
        self.store = store
        self.binding_resolver = binding_resolver
        self.displayed_score_resolver = displayed_score_resolver
        self._structurally_active_groups: set[str] = set()

    @staticmethod
    def _sample_index(
        samples: tuple[VehicleSample, ...],
        server_id: int,
    ) -> dict[tuple[datetime, int], VehicleSample]:
        output: dict[tuple[datetime, int], VehicleSample] = {}
        for sample in samples:
            if sample.server_id != server_id:
                continue
            key = (sample.sample_time_utc, sample.vehicle_identifier)
            previous = output.get(key)
            if previous is not None and previous != sample:
                raise ValueError("multiple distinct samples share one runtime stream timestamp")
            output[key] = sample
        return output

    @staticmethod
    def _frames_for_group(
        frames: tuple[VehicleFrameResult, ...],
        group: RouteGroup,
    ) -> tuple[datetime, Mapping[int, VehicleFrameResult]] | None:
        expected = {key[1] for key in group.member_keys}
        by_time: dict[datetime, dict[int, VehicleFrameResult]] = {}
        for frame in frames:
            if frame.server_id != group.server_id or frame.group_id != group.group_id:
                continue
            if frame.vehicle_identifier not in expected:
                continue
            by_time.setdefault(frame.sample_time_utc, {})[frame.vehicle_identifier] = frame

        complete = [
            (timestamp, values)
            for timestamp, values in by_time.items()
            if expected.issubset(values)
        ]
        if not complete:
            return None
        timestamp, values = max(complete, key=lambda item: item[0])
        return timestamp, MappingProxyType(dict(values))

    @staticmethod
    def _validate_binding(group: RouteGroup, binding: SOOperationalGroupBinding) -> str | None:
        if binding.group_id != group.group_id:
            return "binding_group_id_mismatch"
        expected = {key[1] for key in group.member_keys}
        supplied = {item.vehicle_identifier for item in binding.members}
        if supplied != expected:
            return "binding_members_do_not_match_structural_group"
        return None

    def _member_inputs(
        self,
        group: RouteGroup,
        binding: SOOperationalGroupBinding,
        timestamp: datetime,
        frames: Mapping[int, VehicleFrameResult],
        samples: Mapping[tuple[datetime, int], VehicleSample],
    ) -> tuple[LiveSOMemberInput, ...] | None:
        bindings = binding.by_vehicle_identifier
        output: list[LiveSOMemberInput] = []
        for _, vehicle_identifier in sorted(group.member_keys):
            frame = frames.get(vehicle_identifier)
            sample = samples.get((timestamp, vehicle_identifier))
            member_binding = bindings.get(vehicle_identifier)
            route = self.session.confirmed_route(self.server_id, vehicle_identifier)
            if frame is None or sample is None or member_binding is None or route is None:
                return None
            if route.family is not RouteFamily.SO:
                return None
            if frame.route_id is None or frame.route_id != route.route_id:
                # Never apply the final route geometry to an older frame from a
                # different route state inside the same poll window.
                return None
            output.append(
                LiveSOMemberInput(
                    member_id=member_binding.resolved_member_id,
                    vehicle_type=member_binding.vehicle_type,
                    route_instance_id=member_binding.route_instance_id,
                    route=route,
                    sample=sample,
                    semantic_phase=frame.semantic_phase,
                    work_speed_mps=member_binding.work_speed_mps,
                    active_so_component_id=frame.active_so_component_id,
                )
            )
        return tuple(output)

    def publish_poll(self, poll: IngestPollResult) -> RuntimePublicationResult:
        """Advance live SO runtime from one already-committed ingest poll.

        Publication is downstream of the transactional ingestion watermark. A
        publication failure therefore does not roll back or replay CoreSession.
        """

        if any(sample.server_id != self.server_id for sample in poll.samples):
            raise ValueError("poll contains samples from a different server")

        grouping = self.session.grouping_snapshot()
        active_so_groups = tuple(
            group
            for group in grouping.groups
            if group.server_id == self.server_id and group.family is RouteFamily.SO
        )
        active_ids = {group.group_id for group in active_so_groups}
        for ended in sorted(self._structurally_active_groups - active_ids):
            self.runtime.end_group(ended, poll.window.end_time_utc, reason="structural_group_ended")
        self._structurally_active_groups = active_ids

        sample_index = self._sample_index(poll.samples, self.server_id)
        group_payloads: list[tuple[str, datetime, str, dict[str, object]]] = []
        skipped: dict[str, str] = {}

        for group in sorted(active_so_groups, key=lambda item: item.group_id):
            binding = self.binding_resolver(group)
            if binding is None:
                skipped[group.group_id] = "operational_binding_unavailable"
                continue
            binding_error = self._validate_binding(group, binding)
            if binding_error is not None:
                skipped[group.group_id] = binding_error
                continue

            selected = self._frames_for_group(poll.core_result.frames, group)
            if selected is None:
                skipped[group.group_id] = "no_complete_common_timestamp"
                continue
            observed_at, frames = selected
            members = self._member_inputs(
                group,
                binding,
                observed_at,
                frames,
                sample_index,
            )
            if members is None:
                skipped[group.group_id] = "runtime_member_evidence_incomplete_or_route_mismatch"
                continue

            displayed = self.displayed_score_resolver(group.group_id, observed_at)
            runtime_result = self.runtime.process_snapshot(
                group.group_id,
                binding.constellation,
                members,
                reference_period_s=group.base_period_s,
                displayed_group_score=displayed.score,
                displayed_score_valid=displayed.valid,
            )
            vehicle_ids = {
                item.resolved_member_id: item.vehicle_identifier for item in binding.members
            }
            vehicle_types = {
                item.resolved_member_id: item.vehicle_type for item in binding.members
            }
            one = build_so_live_runtime_snapshot(
                runtime_result,
                server_id=self.server_id,
                observed_at_utc=observed_at,
                arena=binding.arena,
                displayed_group_score=displayed.score,
                displayed_score_valid=displayed.valid,
                comparison_dimension=TemplateComparisonDimension(
                    self.runtime.comparison_dimension
                ),
                vehicle_ids=vehicle_ids,
                vehicle_type_by_member=vehicle_types,
                group_name=binding.group_name,
                subtitle=binding.subtitle,
                color=binding.color,
            )
            payload = one["groups"]["so"]
            group_payloads.append((group.group_id, _utc(observed_at), binding.arena, payload))

        if not group_payloads:
            return RuntimePublicationResult(None, (), skipped)

        arenas = {item[2] for item in group_payloads}
        if len(arenas) != 1:
            raise ValueError("all groups in one server runtime snapshot must share one arena")
        arena = next(iter(arenas))
        group_payloads.sort(key=lambda item: item[0])
        observed_at = max(item[1] for item in group_payloads)
        legacy_so = group_payloads[0][3]
        all_groups = [item[3] for item in group_payloads]
        vehicle_count = sum(len(payload.get("members", [])) for payload in all_groups)

        snapshot: dict[str, object] = {
            "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
            "serverId": str(self.server_id),
            "arena": arena,
            "status": f"{len(all_groups)} קבוצות SO · {vehicle_count} רכבים",
            "observedAt": observed_at.isoformat().replace("+00:00", "Z"),
            "source": {
                "kind": "python-core",
                "health": "healthy",
                "detail": (
                    f"LiveRuntimeProducer · {len(all_groups)} SO groups · "
                    f"comparison={self.runtime.comparison_dimension.value}"
                ),
            },
            # Legacy family slot retained until the Operator UI migrates to
            # groupList. Deterministic first group avoids order-dependent output.
            "groups": {"so": legacy_so},
            "groupList": all_groups,
        }
        self.store.publish(snapshot)
        return RuntimePublicationResult(
            MappingProxyType(snapshot),
            tuple(item[0] for item in group_payloads),
            skipped,
        )


__all__ = [
    "BindingResolver",
    "DisplayedScoreResolver",
    "DisplayedScoreValue",
    "LiveRuntimeProducer",
    "RuntimePublicationResult",
    "SOOperationalGroupBinding",
    "SOOperationalMemberBinding",
]
