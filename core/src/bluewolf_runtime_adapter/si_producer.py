"""Operational SI publication from confirmed structural groups.

Unlike SO, SI needs no per-group binding table. Vehicle type, work speed and
allowed ring roles come from the Web-authored vehicle ID registry; actual ring
roles come from unique confirmed-route geometry plus the default SI template.
Anything ambiguous remains unpublished rather than guessed.
"""
from __future__ import annotations

from datetime import UTC, datetime
from types import MappingProxyType
from typing import Any, Mapping

from bluewolf_core.event_route_evidence import snapshot_closed_route
from bluewolf_core.grouping import RouteGroup
from bluewolf_core.live_si_scoring import LiveSIGroupScorer, LiveSIMemberInput
from bluewolf_core.models import RouteFamily, VehicleFrameResult, VehicleSample
from bluewolf_core.semantic_session import CoreSession
from bluewolf_core.si_ring_roles import (
    AmbiguousSIRingAssignment,
    NoLegalSIRingAssignment,
    SIRingMemberEvidence,
    resolve_si_ring_assignment,
)

from .contract import LIVE_RUNTIME_SCHEMA_VERSION
from .ingest_coordinator import IngestPollResult
from .producer import DisplayedScoreResolver, RuntimePublicationResult
from .service import RuntimeSnapshotStore
from .si_contract import build_si_live_runtime_snapshot
from .si_template_config import (
    OperationalSITemplateEntry,
    OperationalSIVehicleType,
    resolve_si_vehicle_type,
)


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("runtime publication time must be timezone-aware")
    return value.astimezone(UTC)


def _detected_route_payload(
    members: tuple[LiveSIMemberInput, ...],
) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    for member in sorted(members, key=lambda item: item.member_id):
        evidence = snapshot_closed_route(f"si:{member.member_id}", member.route)
        output.append(
            {
                "routeInstanceId": evidence.route_instance_id,
                "routeId": evidence.route_id,
                "family": evidence.family,
                "subtype": evidence.subtype,
                "topology": evidence.topology,
                "direction": evidence.direction,
                "detectionQuality": evidence.detection_quality,
                "centerline": [
                    {"latitude": point.latitude_deg, "longitude": point.longitude_deg}
                    for point in evidence.centerline_wgs84
                ],
            }
        )
    return output


class LiveSIRuntimeProducer:
    """Publish all current structural SI groups for one server."""

    def __init__(
        self,
        *,
        server_id: int,
        session: CoreSession,
        templates: tuple[OperationalSITemplateEntry, ...],
        vehicle_profiles: tuple[OperationalSIVehicleType, ...],
        store: RuntimeSnapshotStore,
        displayed_score_resolver: DisplayedScoreResolver,
        arena: str = "Operational",
        color: str = "#20b9a8",
    ) -> None:
        if isinstance(server_id, bool) or not isinstance(server_id, int) or server_id < 0:
            raise ValueError("server_id must be a non-negative integer")
        if not arena:
            raise ValueError("arena is required")
        self.server_id = server_id
        self.session = session
        self.templates = templates
        self.vehicle_profiles = vehicle_profiles
        self.store = store
        self.displayed_score_resolver = displayed_score_resolver
        self.arena = arena
        self.color = color
        self._scorers: dict[tuple[str, str], LiveSIGroupScorer] = {}
        self._structurally_active_groups: set[str] = set()

    def export_state(self) -> dict[str, object]:
        return {"structurally_active_group_ids": sorted(self._structurally_active_groups)}

    def restore_state(self, state: Mapping[str, object]) -> None:
        raw = state.get("structurally_active_group_ids", [])
        if not isinstance(raw, list) or any(not isinstance(item, str) or not item for item in raw):
            raise ValueError("SI producer structurally_active_group_ids must be non-empty strings")
        if len(raw) != len(set(raw)):
            raise ValueError("SI producer active group ids must be unique")
        self._structurally_active_groups = set(raw)

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
                raise ValueError("multiple distinct samples share one SI runtime timestamp")
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

    def _resolve_group(
        self,
        group: RouteGroup,
    ) -> tuple[
        object,
        Mapping[int, OperationalSIVehicleType],
        Mapping[int, object],
    ]:
        profiles: dict[int, OperationalSIVehicleType] = {}
        routes: dict[int, object] = {}
        evidence: list[SIRingMemberEvidence] = []
        for _, vehicle_identifier in sorted(group.member_keys):
            profile = resolve_si_vehicle_type(self.vehicle_profiles, vehicle_identifier)
            if profile is None:
                raise NoLegalSIRingAssignment(
                    f"no SI vehicle profile for vehicle {vehicle_identifier}"
                )
            route = self.session.confirmed_route(self.server_id, vehicle_identifier)
            if route is None or route.family is not RouteFamily.SI:
                raise NoLegalSIRingAssignment(
                    f"confirmed SI route unavailable for vehicle {vehicle_identifier}"
                )
            profiles[vehicle_identifier] = profile
            routes[vehicle_identifier] = route
            evidence.append(
                SIRingMemberEvidence(
                    member_id=str(vehicle_identifier),
                    vehicle_type=profile.type_id,
                    route=route,
                )
            )
        defaults = tuple(entry.template for entry in self.templates if entry.is_default)
        if not defaults:
            raise NoLegalSIRingAssignment("no default SI templates are configured")
        assignment = resolve_si_ring_assignment(defaults, tuple(evidence))
        return assignment, MappingProxyType(profiles), MappingProxyType(routes)

    def _member_inputs(
        self,
        group: RouteGroup,
        assignment: Any,
        profiles: Mapping[int, OperationalSIVehicleType],
        routes: Mapping[int, Any],
        observed_at: datetime,
        frames: Mapping[int, VehicleFrameResult],
        samples: Mapping[tuple[datetime, int], VehicleSample],
    ) -> tuple[LiveSIMemberInput, ...] | None:
        output: list[LiveSIMemberInput] = []
        for _, vehicle_identifier in sorted(group.member_keys):
            frame = frames.get(vehicle_identifier)
            sample = samples.get((observed_at, vehicle_identifier))
            profile = profiles.get(vehicle_identifier)
            route = routes.get(vehicle_identifier)
            if frame is None or sample is None or profile is None or route is None:
                return None
            if frame.route_id is None or frame.route_id != route.route_id:
                return None
            member_id = str(vehicle_identifier)
            output.append(
                LiveSIMemberInput(
                    member_id=member_id,
                    vehicle_type=profile.type_id,
                    route_role=assignment.role_for(member_id),
                    route=route,
                    sample=sample,
                    phase=frame.semantic_phase,
                    work_speed_mps=profile.work_speed_mps,
                )
            )
        return tuple(output)

    def publish_poll(self, poll: IngestPollResult) -> RuntimePublicationResult:
        if any(sample.server_id != self.server_id for sample in poll.samples):
            raise ValueError("poll contains samples from a different server")
        grouping = self.session.grouping_snapshot()
        active_groups = tuple(
            group for group in grouping.groups
            if group.server_id == self.server_id and group.family is RouteFamily.SI
        )
        active_ids = {group.group_id for group in active_groups}
        for ended in self._structurally_active_groups - active_ids:
            for key in [item for item in self._scorers if item[0] == ended]:
                self._scorers.pop(key, None)
        self._structurally_active_groups = active_ids

        sample_index = self._sample_index(poll.samples, self.server_id)
        payloads: list[tuple[str, datetime, dict[str, object]]] = []
        skipped: dict[str, str] = {}
        for group in sorted(active_groups, key=lambda item: item.group_id):
            try:
                assignment, profiles, routes = self._resolve_group(group)
            except (NoLegalSIRingAssignment, AmbiguousSIRingAssignment) as exc:
                skipped[group.group_id] = str(exc)
                continue
            selected = self._frames_for_group(poll.core_result.frames, group)
            if selected is None:
                skipped[group.group_id] = "no_complete_common_timestamp"
                continue
            observed_at, frames = selected
            members = self._member_inputs(
                group,
                assignment,
                profiles,
                routes,
                observed_at,
                frames,
                sample_index,
            )
            if members is None:
                skipped[group.group_id] = "runtime_member_evidence_incomplete_or_route_mismatch"
                continue
            scorer_key = (group.group_id, assignment.template.template_id)
            scorer = self._scorers.get(scorer_key)
            if scorer is None:
                scorer = LiveSIGroupScorer(assignment.template)
                self._scorers[scorer_key] = scorer
            result = scorer.score_group(
                group.group_id,
                members,
                reference_period_s=group.base_period_s,
            )
            displayed = self.displayed_score_resolver(group.group_id, observed_at)
            one = build_si_live_runtime_snapshot(
                result,
                members,
                server_id=self.server_id,
                observed_at_utc=observed_at,
                arena=self.arena,
                displayed_score=displayed,
                vehicle_ids={member.member_id: int(member.member_id) for member in members},
                color=self.color,
            )
            payload = one["groups"]["si"]
            payload["detectedRoutes"] = _detected_route_payload(members)
            payloads.append((group.group_id, _utc(observed_at), payload))

        if not payloads:
            return RuntimePublicationResult(None, (), skipped)
        payloads.sort(key=lambda item: item[0])
        observed_at = max(item[1] for item in payloads)
        groups = [item[2] for item in payloads]
        vehicle_count = sum(len(group.get("members", [])) for group in groups)
        snapshot: dict[str, object] = {
            "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
            "serverId": str(self.server_id),
            "arena": self.arena,
            "status": f"{len(groups)} קבוצות SI · {vehicle_count} רכבים",
            "observedAt": observed_at.isoformat().replace("+00:00", "Z"),
            "source": {
                "kind": "python-core",
                "health": "healthy",
                "detail": f"LiveSIRuntimeProducer · {len(groups)} SI groups",
            },
            "groups": {"si": groups[0]},
            "groupList": groups,
        }
        self.store.publish(snapshot)
        return RuntimePublicationResult(
            MappingProxyType(snapshot),
            tuple(item[0] for item in payloads),
            skipped,
        )


__all__ = ["LiveSIRuntimeProducer"]
