"""Serialize live SI scoring into the existing operator runtime contract."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Mapping

from bluewolf_core.live_si_scoring import LiveSIGroupScoringResult, LiveSIMemberInput

from .contract import LIVE_RUNTIME_SCHEMA_VERSION
from .producer import DisplayedScoreValue


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("runtime time must be timezone-aware")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _score(value: float | None) -> float:
    if value is None:
        return 0.0
    numeric = float(value)
    if numeric < 0.0:
        return 0.0
    if numeric > 100.0:
        return 100.0
    return numeric


def _mean_confidence(rows: list[dict[str, Any]]) -> float:
    if not rows:
        return 0.0
    return sum(float(row["confidence"]) for row in rows) / len(rows)


def build_si_live_runtime_snapshot(
    result: LiveSIGroupScoringResult,
    members: tuple[LiveSIMemberInput, ...],
    *,
    server_id: int,
    observed_at_utc: datetime,
    arena: str,
    displayed_score: DisplayedScoreValue,
    vehicle_ids: Mapping[str, int],
    group_name: str | None = None,
    subtitle: str = "Python Core · SI",
    color: str = "#20b9a8",
) -> dict[str, Any]:
    """Build one SI group snapshot without inventing smoothing/event state."""

    if result.group_id == "":
        raise ValueError("SI runtime group id is required")
    member_by_id = {item.member_id: item for item in members}
    metric_by_id = {item.member_id: item for item in result.member_metrics}
    scores_by_id = (
        {} if result.scoring is None else dict(result.scoring.member_scores)
    )
    member_rows: list[dict[str, Any]] = []
    for member_id in sorted(member_by_id):
        member = member_by_id[member_id]
        metric = metric_by_id[member_id]
        scores = scores_by_id.get(member_id)
        valid = bool(scores is not None and scores.valid)
        reasons: list[str] = []
        if scores is not None and scores.primary_reason:
            reasons.append(scores.primary_reason)
        if metric.reason and metric.reason not in reasons:
            reasons.append(metric.reason)
        vehicle_id = vehicle_ids.get(member_id)
        if vehicle_id is None:
            raise ValueError(f"missing SI runtime vehicle id: {member_id}")
        row: dict[str, Any] = {
            "id": vehicle_id,
            "typeId": member.vehicle_type,
            "score": _score(scores.total if valid else None),
            "sync": _score(scores.sync if valid else None),
            "route": _score(scores.route if valid else None),
            "confidence": _score(float(scores.reliability) * 100.0) if scores is not None else 0.0,
            "phase": float(member.phase) if member.phase is not None else 0.0,
            "ring": member.route_role,
            "scoreValid": valid,
            "reasons": reasons,
        }
        member_rows.append(row)

    group_scores = None if result.scoring is None else result.scoring.group_scores
    group_valid = bool(
        displayed_score.valid
        and displayed_score.score is not None
        and group_scores is not None
        and group_scores.valid
        and group_scores.total is not None
    )
    reason = result.pending_reason
    if group_scores is not None and group_scores.primary_reason:
        reason = group_scores.primary_reason
    if reason is None:
        reason = "Python Core runtime"
    observed_at = _iso(observed_at_utc)
    group: dict[str, Any] = {
        "key": "si",
        "id": result.group_id,
        "name": group_name or f"קבוצה {result.group_id}",
        "family": "SI",
        "subtitle": subtitle,
        # The source score is the SAME selected-template Core pass. total is
        # the ten-second checkpointed alert/window score, not raw evidence.
        "total": _score(displayed_score.score if group_valid else None),
        "sync": _score(group_scores.sync if group_valid and group_scores is not None else None),
        "route": _score(group_scores.route if group_valid and group_scores is not None else None),
        "confidence": _mean_confidence(member_rows) if group_valid else 0.0,
        "color": color,
        "members": member_rows,
        "templateId": result.template_id,
        "reason": reason,
        "success": "Python Core סיפק snapshot תקף." if group_valid else "הציון המוצג אינו תקף כרגע.",
        "scoreValid": group_valid,
        "observedAt": observed_at,
    }
    if group_valid:
        group["rawTotal"] = _score(group_scores.total)
    return {
        "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
        "serverId": str(server_id),
        "arena": arena,
        "status": f"1 קבוצת SI · {len(member_rows)} רכבים",
        "observedAt": observed_at,
        "source": {
            "kind": "python-core",
            "health": "healthy",
            "detail": "LiveSIGroupScorer · raw Core score; displayed score policy remains external",
        },
        "groups": {"si": group},
        "groupList": [group],
    }


__all__ = ["build_si_live_runtime_snapshot"]
