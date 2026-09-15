"""Event-scoped SO template recomputation from immutable Core observations.

The investigation layer must never replace a displayed number cosmetically. A
recompute replays the approved ``score_so_template`` bridge over the immutable
``SOScoringObservation`` snapshots captured by the Core during the event.
Frames where Core evidence was not yet sufficient are retained explicitly as
missing points so the reported event range is never shortened silently.

Navigation evidence is carried beside scoring evidence from the *same source
sample and timestamp*. It is never reconstructed from semantic phase or route
geometry. This lets investigation maps use real WGS84 observations without
changing or influencing the scoring path.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
import math
from typing import Any
from uuid import uuid4

from .config import ScoringConfig
from .so_scoring import SOScoringObservation, score_so_template
from .so_templates import SOTemplate


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("recompute timestamps must be timezone-aware")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return _utc(value).isoformat().replace("+00:00", "Z")


def _optional_finite(name: str, value: float | None) -> None:
    if value is not None and not math.isfinite(float(value)):
        raise ValueError(f"{name} must be finite when supplied")


def template_fingerprint(template: SOTemplate) -> str:
    """Return a deterministic version id for the exact template structure."""

    payload = {
        "template_id": template.template_id,
        "name": template.name,
        "routes": [
            {
                "route_instance_id": route.route_instance_id,
                "route_kind": route.route_kind.value,
                "geometry_profile_ref": route.geometry_profile_ref,
                "slots": [
                    {
                        "slot_id": slot.slot_id,
                        "vehicle_type": slot.vehicle_type,
                        "quarter": slot.quarter.value,
                    }
                    for slot in route.vehicle_slots
                ],
            }
            for route in template.route_instances
        ],
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "tpl-" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class SOEventNavigationPoint:
    """One immutable navigation sample captured beside event scoring evidence."""

    member_id: str
    vehicle_identifier: int
    latitude_deg: float | None
    longitude_deg: float | None
    altitude_m: float | None = None
    velocity_north_mps: float | None = None
    velocity_east_mps: float | None = None
    active: bool | None = None
    reliability: float = 1.0

    def __post_init__(self) -> None:
        if not self.member_id:
            raise ValueError("navigation member_id is required")
        if isinstance(self.vehicle_identifier, bool) or not isinstance(self.vehicle_identifier, int) or self.vehicle_identifier < 0:
            raise ValueError("navigation vehicle_identifier must be a non-negative integer")
        if (self.latitude_deg is None) != (self.longitude_deg is None):
            raise ValueError("navigation latitude/longitude must both exist or both be missing")
        if self.latitude_deg is not None:
            latitude = float(self.latitude_deg)
            longitude = float(self.longitude_deg)
            if not math.isfinite(latitude) or not -90.0 <= latitude <= 90.0:
                raise ValueError("navigation latitude_deg is outside WGS84 range")
            if not math.isfinite(longitude) or not -180.0 <= longitude <= 180.0:
                raise ValueError("navigation longitude_deg is outside WGS84 range")
        _optional_finite("navigation altitude_m", self.altitude_m)
        _optional_finite("navigation velocity_north_mps", self.velocity_north_mps)
        _optional_finite("navigation velocity_east_mps", self.velocity_east_mps)
        if not math.isfinite(float(self.reliability)) or not 0.0 <= float(self.reliability) <= 1.0:
            raise ValueError("navigation reliability must be in [0,1]")

    @property
    def heading_deg(self) -> float | None:
        if self.velocity_north_mps is None or self.velocity_east_mps is None:
            return None
        north = float(self.velocity_north_mps)
        east = float(self.velocity_east_mps)
        if math.hypot(east, north) <= 1e-12:
            return None
        return math.degrees(math.atan2(east, north)) % 360.0


@dataclass(frozen=True, slots=True)
class SOEventObservationFrame:
    event_id: str
    server_id: int
    group_id: str
    sample_time_utc: datetime
    observations: tuple[SOScoringObservation, ...]
    pending_reason: str | None = None
    navigation: tuple[SOEventNavigationPoint, ...] = ()

    def __post_init__(self) -> None:
        if not self.event_id:
            raise ValueError("event_id is required")
        if isinstance(self.server_id, bool) or not isinstance(self.server_id, int) or self.server_id < 0:
            raise ValueError("server_id must be a non-negative integer")
        if not self.group_id:
            raise ValueError("group_id is required")
        object.__setattr__(self, "sample_time_utc", _utc(self.sample_time_utc))
        if self.pending_reason == "":
            raise ValueError("pending_reason must be non-empty when supplied")
        if len(self.observations) < 2 and self.pending_reason is None:
            raise ValueError("fewer than two SO observations require a pending_reason")
        member_ids = [item.member_id for item in self.observations]
        if len(member_ids) != len(set(member_ids)):
            raise ValueError("recompute frame member ids must be unique")
        navigation_members = [item.member_id for item in self.navigation]
        navigation_vehicles = [item.vehicle_identifier for item in self.navigation]
        if len(navigation_members) != len(set(navigation_members)):
            raise ValueError("navigation frame member ids must be unique")
        if len(navigation_vehicles) != len(set(navigation_vehicles)):
            raise ValueError("navigation frame vehicle identifiers must be unique")


def _finite_score(value: float | None) -> float | None:
    if value is None:
        return None
    numeric = float(value)
    if not math.isfinite(numeric) or not 0.0 <= numeric <= 100.0:
        raise ValueError("recomputed score must be finite and in [0,100]")
    return numeric


def _navigation_payload(item: SOEventNavigationPoint) -> dict[str, Any]:
    return {
        "memberId": item.member_id,
        "vehicleIdentifier": item.vehicle_identifier,
        "latitude": item.latitude_deg,
        "longitude": item.longitude_deg,
        "altitudeM": item.altitude_m,
        "velocityNorthMps": item.velocity_north_mps,
        "velocityEastMps": item.velocity_east_mps,
        "headingDeg": item.heading_deg,
        "active": item.active,
        "reliability": item.reliability,
    }


def recompute_so_event(
    *,
    event_id: str,
    template: SOTemplate,
    frames: tuple[SOEventObservationFrame, ...],
    code_version: str,
    config_version: str,
    template_version: str | None = None,
    scenario_id: str | None = None,
    run_id: str | None = None,
    config: ScoringConfig | None = None,
    minimum_valid_vehicles: int = 2,
) -> dict[str, Any]:
    """Replay one event against one template using only captured Core observations."""

    if not event_id:
        raise ValueError("event_id is required")
    for name, value in (("code_version", code_version), ("config_version", config_version)):
        if not value:
            raise ValueError(f"{name} is required")
    resolved_template_version = template_version or template_fingerprint(template)
    resolved_scenario_id = (scenario_id or event_id).strip()
    resolved_run_id = (run_id or f"recompute-{uuid4().hex}").strip()
    if not resolved_template_version:
        raise ValueError("template_version is required")
    if not resolved_scenario_id:
        raise ValueError("scenario_id is required")
    if not resolved_run_id:
        raise ValueError("run_id is required")
    if not frames:
        raise ValueError("event recomputation requires captured observation frames")
    ordered = tuple(sorted(frames, key=lambda frame: frame.sample_time_utc))
    if any(frame.event_id != event_id for frame in ordered):
        raise ValueError("all recompute frames must belong to the requested event")
    server_ids = {frame.server_id for frame in ordered}
    group_ids = {frame.group_id for frame in ordered}
    if len(server_ids) != 1 or len(group_ids) != 1:
        raise ValueError("recompute frames must belong to one server and one group")
    timestamps = [frame.sample_time_utc for frame in ordered]
    if len(timestamps) != len(set(timestamps)):
        raise ValueError("recompute frames must have unique timestamps")

    points: list[dict[str, Any]] = []
    reason_counts: dict[str, int] = {}
    group_totals: list[float] = []
    group_sync: list[float] = []
    group_route: list[float] = []
    scored_frame_count = 0

    for frame in ordered:
        navigation = [_navigation_payload(item) for item in frame.navigation]
        if frame.pending_reason is not None:
            points.append(
                {
                    "observedAt": _iso(frame.sample_time_utc),
                    "pendingReason": frame.pending_reason,
                    "group": {"valid": False, "sync": None, "route": None, "total": None},
                    "members": [],
                    "navigation": navigation,
                }
            )
            continue

        result = score_so_template(
            template,
            frame.observations,
            config=config,
            minimum_valid_vehicles=minimum_valid_vehicles,
        )
        scored_frame_count += 1
        group = result.group_scores
        total = _finite_score(group.total)
        sync = _finite_score(group.sync)
        route = _finite_score(group.route)
        if total is not None:
            group_totals.append(total)
        if sync is not None:
            group_sync.append(sync)
        if route is not None:
            group_route.append(route)

        members = []
        for member in result.members:
            reason = member.scores.primary_reason
            if reason:
                reason_counts[reason] = reason_counts.get(reason, 0) + 1
            members.append(
                {
                    "memberId": member.member_id,
                    "routeInstanceId": member.route_instance_id,
                    "slotId": member.slot_id,
                    "expectedPhase": member.expected_phase,
                    "positionErrorCycle": member.position_error_cycle,
                    "valid": member.scores.valid,
                    "sync": _finite_score(member.scores.sync),
                    "route": _finite_score(member.scores.route),
                    "total": _finite_score(member.scores.total),
                    "primaryReason": reason,
                }
            )
        points.append(
            {
                "observedAt": _iso(frame.sample_time_utc),
                "pendingReason": None,
                "group": {"valid": group.valid, "sync": sync, "route": route, "total": total},
                "members": members,
                "navigation": navigation,
            }
        )

    def average(values: list[float]) -> float | None:
        return None if not values else round(sum(values) / len(values), 6)

    root_causes = [
        {"reason": reason, "occurrences": count}
        for reason, count in sorted(reason_counts.items(), key=lambda item: (-item[1], item[0]))
    ]
    return {
        "schemaVersion": "bluewolf.event-recompute.v1",
        "runId": resolved_run_id,
        "scenarioId": resolved_scenario_id,
        "eventId": event_id,
        "serverId": next(iter(server_ids)),
        "groupId": next(iter(group_ids)),
        "templateId": template.template_id,
        "templateVersion": resolved_template_version,
        "codeVersion": code_version,
        "configVersion": config_version,
        "startAt": _iso(ordered[0].sample_time_utc),
        "endAt": _iso(ordered[-1].sample_time_utc),
        "frameCount": len(ordered),
        "scoredFrameCount": scored_frame_count,
        "missingFrameCount": len(ordered) - scored_frame_count,
        "summary": {
            "sync": average(group_sync),
            "route": average(group_route),
            "total": average(group_totals),
        },
        "rootCauses": root_causes,
        "points": points,
    }


__all__ = [
    "SOEventNavigationPoint",
    "SOEventObservationFrame",
    "recompute_so_event",
    "template_fingerprint",
]
