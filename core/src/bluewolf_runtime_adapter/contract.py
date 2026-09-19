"""Serialize validated SO runtime results into the application live contract.

The adapter deliberately lives outside ``bluewolf_core``.  It may translate
algorithmic results into UI/API fields, while the algorithmic package remains
independent of HTTP, arenas, display labels and colors.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import math
from typing import Any, Mapping

from bluewolf_core.live_so_event_runtime import (
    LiveSOEventRuntimeResult,
    TemplateComparisonDimension,
)

LIVE_RUNTIME_SCHEMA_VERSION = "bluewolf.live-runtime.v1"
_UNSELECTED_TEMPLATE_ID = "__unselected__"


@dataclass(frozen=True, slots=True)
class RuntimeVehiclePosition:
    """Optional presentation position for one runtime member.

    Heading uses navigation convention: zero is north and positive angles turn
    clockwise. It is omitted when a velocity vector is not observable.
    """

    latitude_deg: float
    longitude_deg: float
    heading_deg: float | None = None

    def __post_init__(self) -> None:
        if not math.isfinite(self.latitude_deg) or not -90.0 <= self.latitude_deg <= 90.0:
            raise ValueError("latitude_deg must be finite and in [-90,90]")
        if not math.isfinite(self.longitude_deg) or not -180.0 <= self.longitude_deg <= 180.0:
            raise ValueError("longitude_deg must be finite and in [-180,180]")
        if self.heading_deg is not None and not math.isfinite(self.heading_deg):
            raise ValueError("heading_deg must be finite when supplied")
        if self.heading_deg is not None:
            object.__setattr__(self, "heading_deg", float(self.heading_deg) % 360.0)


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("observed_at_utc must be timezone-aware")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _score(value: float | None) -> float:
    if value is None:
        return 0.0
    numeric = float(value)
    if not math.isfinite(numeric) or not 0.0 <= numeric <= 100.0:
        raise ValueError("runtime score must be finite and in [0, 100]")
    return numeric


def _vehicle_id(member_id: str, vehicle_ids: Mapping[str, int] | None) -> int:
    if vehicle_ids is not None and member_id in vehicle_ids:
        value = vehicle_ids[member_id]
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(f"invalid vehicle id for member {member_id!r}")
        return value
    try:
        value = int(member_id)
    except ValueError as exc:
        raise ValueError(
            f"member {member_id!r} needs an explicit numeric vehicle id mapping"
        ) from exc
    if value < 0:
        raise ValueError(f"invalid vehicle id for member {member_id!r}")
    return value


def _mean_confidence(member_rows: list[dict[str, Any]]) -> float:
    valid = [float(row["confidence"]) for row in member_rows if row["scoreValid"]]
    return 0.0 if not valid else sum(valid) / len(valid)


def build_so_live_runtime_snapshot(
    result: LiveSOEventRuntimeResult,
    *,
    server_id: int | str,
    observed_at_utc: datetime,
    arena: str,
    displayed_group_score: float | None,
    displayed_score_valid: bool,
    comparison_dimension: TemplateComparisonDimension,
    vehicle_ids: Mapping[str, int] | None = None,
    vehicle_type_by_member: Mapping[str, str] | None = None,
    position_by_member: Mapping[str, RuntimeVehiclePosition] | None = None,
    group_name: str | None = None,
    subtitle: str = "Python Core · SO",
    color: str = "#4378e8",
) -> dict[str, Any]:
    """Build one ``bluewolf.live-runtime.v1`` snapshot for an SO group.

    ``displayed_group_score`` is explicit on purpose: the core runtime already
    requires the product's smoothed/displayed score for alert semantics, and
    this adapter must not silently substitute the raw total score.

    Map position is also explicit. The serializer never attempts to reconstruct
    latitude/longitude from route phase or route geometry when the live sample
    did not carry a position.

    The result intentionally contains only an ``so`` group.  Consumers must
    treat a missing family as unavailable rather than backfilling demo scores.
    """

    server_id_text = str(server_id)
    if not server_id_text:
        raise ValueError("server_id is required")
    if not arena:
        raise ValueError("arena is required")
    if displayed_score_valid and displayed_group_score is None:
        raise ValueError("valid displayed score requires a numeric value")
    if displayed_group_score is not None:
        _score(displayed_group_score)

    dimension = TemplateComparisonDimension(comparison_dimension)
    observed_at = _iso(observed_at_utc)
    live = result.live_scoring
    scoring = live.scoring
    scores_by_member = (
        {member.member_id: member.scores for member in scoring.members}
        if scoring is not None
        else {}
    )

    member_rows: list[dict[str, Any]] = []
    for metric in live.member_metrics:
        observation = metric.observation
        member_scores = scores_by_member.get(metric.member_id)
        valid = bool(member_scores is not None and member_scores.valid and observation is not None)
        type_id = (
            vehicle_type_by_member.get(metric.member_id)
            if vehicle_type_by_member is not None
            else None
        )
        if type_id is None and observation is not None:
            type_id = observation.vehicle_type
        if not type_id:
            type_id = "unknown"

        reasons: list[str] = []
        if member_scores is not None and member_scores.primary_reason:
            reasons.append(member_scores.primary_reason)
        if metric.reason and metric.reason not in reasons:
            reasons.append(metric.reason)

        row: dict[str, Any] = {
            "id": _vehicle_id(metric.member_id, vehicle_ids),
            "typeId": type_id,
            "score": _score(member_scores.total if valid else None),
            "sync": _score(member_scores.sync if valid else None),
            "route": _score(member_scores.route if valid else None),
            "confidence": (
                _score(float(member_scores.reliability) * 100.0)
                if member_scores is not None
                else 0.0
            ),
            "phase": float(observation.semantic_phase) if observation is not None else 0.0,
            "scoreValid": valid,
            "reasons": reasons,
        }
        position = position_by_member.get(metric.member_id) if position_by_member is not None else None
        if position is not None:
            row["latitude"] = float(position.latitude_deg)
            row["longitude"] = float(position.longitude_deg)
            if position.heading_deg is not None:
                row["headingDeg"] = float(position.heading_deg)
        member_rows.append(row)

    group_scores = scoring.group_scores if scoring is not None else None
    group_valid = bool(
        displayed_score_valid
        and displayed_group_score is not None
        and group_scores is not None
        and group_scores.valid
    )
    active_template_id = live.selection.template_id or _UNSELECTED_TEMPLATE_ID
    group_reason = live.pending_reason
    if group_scores is not None and group_scores.primary_reason:
        group_reason = group_scores.primary_reason
    if group_reason is None:
        group_reason = "Python Core runtime"

    group: dict[str, Any] = {
        "key": "so",
        "id": result.group_id,
        "name": group_name or f"קבוצה {result.group_id}",
        "family": "SO",
        "subtitle": subtitle,
        "total": _score(displayed_group_score if group_valid else None),
        "sync": _score(group_scores.sync if group_valid and group_scores is not None else None),
        "route": _score(group_scores.route if group_valid and group_scores is not None else None),
        "confidence": _mean_confidence(member_rows) if group_valid else 0.0,
        "color": color,
        "members": member_rows,
        "templateId": active_template_id,
        "reason": group_reason,
        "success": "Python Core סיפק snapshot תקף." if group_valid else "הציון המוצג אינו תקף כרגע.",
        "scoreValid": group_valid,
        "observedAt": observed_at,
    }

    if result.event is not None:
        event_snapshot = result.event.snapshot
        if str(event_snapshot.server_id) != server_id_text:
            raise ValueError("runtime event belongs to a different server")
        group["event"] = {
            "id": event_snapshot.event_id,
            "contextKey": event_snapshot.context_key,
            "startedAt": _iso(event_snapshot.event_start_utc),
            "active": True,
        }
        if event_snapshot.low_score_alert_active:
            group["alert"] = {
                "id": f"{event_snapshot.event_id}:low-score",
                "title": "ציון קבוצה נמוך",
                "detail": "הציון המוצג נמצא מתחת לסף ההתראה למשך הזמן הנדרש.",
                "severity": "warning",
            }
        suggested = event_snapshot.suggested_template_id
        active = event_snapshot.active_template_id
        if suggested and active:
            suggested_score = result.comparison_scores.get(suggested)
            active_score = result.comparison_scores.get(active)
            if suggested_score is not None and active_score is not None:
                group["recommendation"] = {
                    "templateId": suggested,
                    "activeTemplateId": active,
                    "dimension": dimension.value,
                    "improvementPoints": float(suggested_score - active_score),
                    "ready": True,
                }

    return {
        "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
        "serverId": server_id_text,
        "arena": arena,
        "status": f"1 קבוצת SO · {len(member_rows)} רכבים",
        "observedAt": observed_at,
        "source": {
            "kind": "python-core",
            "health": "healthy",
            "detail": f"LiveSOEventRuntime · comparison={dimension.value}",
        },
        "groups": {"so": group},
    }
