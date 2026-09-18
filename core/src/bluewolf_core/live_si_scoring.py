"""Live SI primitive metrics and selected-template scoring.

This module is the operational bridge for BW-SYNC-012.  It does not introduce a
new score law: route/period/movement primitives are derived from confirmed SI
route evidence and the selected Web-authored SI template supplies only the
position error through ``score_si_template``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
import math
from types import MappingProxyType
from typing import Mapping

from .config import ScoringConfig
from .geometry import (
    curvature_at_phase,
    menger_curvature,
    normalized_curvature_error,
    project_wgs84,
    vector_angle_error_deg,
    wgs84_to_local_m,
)
from .models import CanonicalPoint, ClosedRoute, PrimitiveMetrics, RouteFamily, VehicleSample
from .si_scoring import SIScoringMemberInput, SIScoringResult, score_si_template
from .templates import ObservedMember, SynchronizationTemplate


_EPS = 1e-12
LIVE_SI_METRICS_STATE_SCHEMA_VERSION = "bluewolf.live-si-metrics.v1"
LIVE_SI_SCORER_STATE_SCHEMA_VERSION = "bluewolf.live-si-scorer.v1"
DiagnosticValue = float | str | bool


@dataclass(frozen=True, slots=True)
class LiveSIMemberInput:
    member_id: str
    vehicle_type: str
    route_role: str
    route: ClosedRoute
    sample: VehicleSample
    phase: float | None
    work_speed_mps: float

    def __post_init__(self) -> None:
        if not self.member_id:
            raise ValueError("member_id is required")
        if not self.vehicle_type:
            raise ValueError("vehicle_type is required")
        if self.route_role not in {"inner", "middle", "outer"}:
            raise ValueError("route_role must be inner, middle or outer")
        if self.route.family is not RouteFamily.SI:
            raise ValueError("LiveSIMemberInput requires an SI route")
        if self.phase is not None:
            if not math.isfinite(self.phase):
                raise ValueError("phase must be finite")
            object.__setattr__(self, "phase", self.phase % 1.0)
        if not math.isfinite(self.work_speed_mps) or self.work_speed_mps <= 0.0:
            raise ValueError("work_speed_mps must be finite and positive")


@dataclass(frozen=True, slots=True)
class LiveSIMetricResult:
    member_id: str
    ready: bool
    metrics: PrimitiveMetrics | None
    reason: str | None
    diagnostics: Mapping[str, DiagnosticValue] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.ready != (self.metrics is not None):
            raise ValueError("ready must match metrics availability")
        if self.ready and self.reason is not None:
            raise ValueError("ready metric result cannot carry a pending reason")
        if not self.ready and not self.reason:
            raise ValueError("pending metric result requires a reason")
        object.__setattr__(self, "diagnostics", MappingProxyType(dict(self.diagnostics)))


@dataclass(frozen=True, slots=True)
class LiveSIGroupScoringResult:
    group_id: str
    template_id: str
    member_metrics: tuple[LiveSIMetricResult, ...]
    scoring: SIScoringResult | None
    pending_reason: str | None = None

    def __post_init__(self) -> None:
        if not self.group_id:
            raise ValueError("group_id is required")
        if not self.template_id:
            raise ValueError("template_id is required")
        if self.scoring is not None and self.pending_reason is not None:
            raise ValueError("scored group cannot carry a pending reason")
        if self.scoring is None and not self.pending_reason:
            raise ValueError("unscored group requires a pending reason")


@dataclass(slots=True)
class _MemberTemporalState:
    route_id: str
    last_time_utc: datetime
    last_phase: float
    last_point: CanonicalPoint
    points: list[CanonicalPoint]
    wrong_direction_seconds: float = 0.0


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("time must be timezone-aware")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return _utc(value).isoformat().replace("+00:00", "Z")


def _state_time(value: object, label: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be an ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} must be an ISO timestamp") from exc
    return _utc(parsed)


def _state_number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{label} must be finite")
    return result


def _point_state(point: CanonicalPoint) -> dict[str, float]:
    return {"x": float(point.x_m), "y": float(point.y_m)}


def _state_point(value: object, label: str) -> CanonicalPoint:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return CanonicalPoint(
        _state_number(value.get("x"), f"{label}.x"),
        _state_number(value.get("y"), f"{label}.y"),
    )


def _signed_cycle_delta(current: float, previous: float) -> float:
    return ((current - previous + 0.5) % 1.0) - 0.5


def _undirected_tangent_error_deg(
    velocity_east: float,
    velocity_north: float,
    tangent_east: float,
    tangent_north: float,
) -> float:
    directed = vector_angle_error_deg(
        velocity_east,
        velocity_north,
        tangent_east,
        tangent_north,
    )
    return min(directed, abs(180.0 - directed))


class LiveSIMetricsEngine:
    """Stateful SI primitive estimator using only confirmed route/sample evidence."""

    def __init__(self, *, max_contiguous_gap_s: float = 5.0) -> None:
        if not math.isfinite(max_contiguous_gap_s) or max_contiguous_gap_s <= 0.0:
            raise ValueError("max_contiguous_gap_s must be finite and positive")
        self.max_contiguous_gap_s = float(max_contiguous_gap_s)
        self._state: dict[str, _MemberTemporalState] = {}

    def reset_member(self, member_id: str) -> None:
        self._state.pop(member_id, None)

    def export_state(self) -> dict[str, object]:
        return {
            "schemaVersion": LIVE_SI_METRICS_STATE_SCHEMA_VERSION,
            "maxContiguousGapSeconds": self.max_contiguous_gap_s,
            "members": [
                {
                    "memberId": member_id,
                    "routeId": row.route_id,
                    "lastTimeUtc": _iso(row.last_time_utc),
                    "lastPhase": row.last_phase,
                    "lastPoint": _point_state(row.last_point),
                    "points": [_point_state(point) for point in row.points],
                    "wrongDirectionSeconds": row.wrong_direction_seconds,
                }
                for member_id, row in sorted(self._state.items())
            ],
        }

    def restore_state(self, state: Mapping[str, object]) -> None:
        if state.get("schemaVersion") != LIVE_SI_METRICS_STATE_SCHEMA_VERSION:
            raise ValueError("unsupported live SI metrics state schema")
        gap = _state_number(state.get("maxContiguousGapSeconds"), "maxContiguousGapSeconds")
        if abs(gap - self.max_contiguous_gap_s) > 1e-9:
            raise ValueError("live SI metrics state uses a different contiguous-gap configuration")
        raw_members = state.get("members")
        if not isinstance(raw_members, list):
            raise ValueError("live SI metrics members must be a list")
        restored: dict[str, _MemberTemporalState] = {}
        for index, raw in enumerate(raw_members):
            if not isinstance(raw, Mapping):
                raise ValueError(f"live SI metrics member {index} must be an object")
            member_id = raw.get("memberId")
            route_id = raw.get("routeId")
            if not isinstance(member_id, str) or not member_id:
                raise ValueError("live SI metrics memberId is required")
            if member_id in restored:
                raise ValueError("live SI metrics memberIds must be unique")
            if not isinstance(route_id, str) or not route_id:
                raise ValueError("live SI metrics routeId is required")
            phase = _state_number(raw.get("lastPhase"), "lastPhase")
            if not 0.0 <= phase < 1.0:
                raise ValueError("live SI metrics lastPhase must be in [0,1)")
            raw_points = raw.get("points")
            if not isinstance(raw_points, list) or not 1 <= len(raw_points) <= 3:
                raise ValueError("live SI metrics points must contain one to three points")
            wrong_direction = _state_number(
                raw.get("wrongDirectionSeconds", 0.0),
                "wrongDirectionSeconds",
            )
            if wrong_direction < 0.0:
                raise ValueError("wrongDirectionSeconds must be non-negative")
            restored[member_id] = _MemberTemporalState(
                route_id=route_id,
                last_time_utc=_state_time(raw.get("lastTimeUtc"), "lastTimeUtc"),
                last_phase=phase,
                last_point=_state_point(raw.get("lastPoint"), "lastPoint"),
                points=[_state_point(point, "points[]") for point in raw_points],
                wrong_direction_seconds=wrong_direction,
            )
        self._state = restored

    def observe(self, item: LiveSIMemberInput, *, reference_period_s: float) -> LiveSIMetricResult:
        if not math.isfinite(reference_period_s) or reference_period_s <= 0.0:
            raise ValueError("reference_period_s must be finite and positive")
        sample = item.sample
        now = _utc(sample.sample_time_utc)
        diagnostics: dict[str, DiagnosticValue] = {
            "reference_period_s": float(reference_period_s),
            "route_period_s": float(item.route.estimated_period_s),
        }

        if (
            item.phase is None
            or sample.active is not True
            or sample.latitude_deg is None
            or sample.longitude_deg is None
        ):
            self.reset_member(item.member_id)
            reason = "phase_unavailable" if item.phase is None else "inactive_or_position_missing"
            return LiveSIMetricResult(item.member_id, False, None, reason, diagnostics)

        projection = project_wgs84(item.route, sample.latitude_deg, sample.longitude_deg)
        current_point = wgs84_to_local_m(
            sample.latitude_deg,
            sample.longitude_deg,
            item.route.center_latitude_deg,
            item.route.center_longitude_deg,
        )
        previous = self._state.get(item.member_id)

        def seed(reason: str) -> LiveSIMetricResult:
            self._state[item.member_id] = _MemberTemporalState(
                route_id=item.route.route_id,
                last_time_utc=now,
                last_phase=float(item.phase),
                last_point=current_point,
                points=[current_point],
            )
            return LiveSIMetricResult(item.member_id, False, None, reason, diagnostics)

        if previous is None:
            return seed("temporal_warmup")
        if previous.route_id != item.route.route_id:
            return seed("route_changed")

        dt = (now - previous.last_time_utc).total_seconds()
        if dt <= 0.0:
            raise ValueError("member samples must be strictly time-ordered")
        if dt > self.max_contiguous_gap_s:
            return seed("temporal_gap")
        if dt / reference_period_s >= 0.5:
            return seed("phase_step_ambiguous")

        phase_delta = _signed_cycle_delta(float(item.phase), previous.last_phase)
        actual_phase_rate = abs(phase_delta) / dt
        expected_phase_rate = 1.0 / reference_period_s
        movement_error_ratio = abs(actual_phase_rate - expected_phase_rate) / expected_phase_rate
        period_error_ratio = abs(item.route.estimated_period_s - reference_period_s) / reference_period_s

        velocity_east = sample.velocity_east_mps
        velocity_north = sample.velocity_north_mps
        if (velocity_east is None) != (velocity_north is None):
            velocity_east = velocity_north = None
        if velocity_east is None or velocity_north is None:
            velocity_east = (current_point.x_m - previous.last_point.x_m) / dt
            velocity_north = (current_point.y_m - previous.last_point.y_m) / dt
        if not math.isfinite(velocity_east) or not math.isfinite(velocity_north):
            return seed("velocity_unavailable")

        speed = math.hypot(velocity_east, velocity_north)
        speed_fraction = speed / item.work_speed_mps
        tangent_error = None
        if speed > _EPS:
            tangent_error = _undirected_tangent_error_deg(
                velocity_east,
                velocity_north,
                projection.tangent_east,
                projection.tangent_north,
            )

        points = (previous.points + [current_point])[-3:]
        curvature_error = None
        if len(points) == 3:
            observed_curvature = menger_curvature(points[0], points[1], points[2])
            expected_curvature = curvature_at_phase(item.route.canonical_points, projection.phase)
            curvature_error = normalized_curvature_error(
                abs(observed_curvature),
                abs(expected_curvature),
                item.route.length_m,
            )
            diagnostics["observed_curvature_abs"] = abs(observed_curvature)
            diagnostics["expected_curvature_abs"] = abs(expected_curvature)

        wrong_direction_seconds = previous.wrong_direction_seconds
        if speed_fraction >= 0.3 and phase_delta < -1e-6:
            wrong_direction_seconds += dt
        elif phase_delta > 1e-6:
            wrong_direction_seconds = 0.0

        distance_error = projection.distance_m / max(item.route.short_axis_b_m, _EPS)
        diagnostics.update(
            {
                "dt_s": dt,
                "phase_delta": phase_delta,
                "actual_phase_rate_hz": actual_phase_rate,
                "expected_phase_rate_hz": expected_phase_rate,
                "speed_mps": speed,
                "projection_distance_m": projection.distance_m,
                "wrong_direction_seconds": wrong_direction_seconds,
            }
        )

        metrics = PrimitiveMetrics(
            family=RouteFamily.SI,
            # Replaced by score_si_template from the selected template fit.
            position_error=0.0,
            period_error_ratio=period_error_ratio,
            movement_error_ratio=movement_error_ratio,
            distance_error_b_ratio=distance_error,
            tangent_error_deg=tangent_error,
            curvature_error_ratio=curvature_error,
            reliability=sample.reliability,
            speed_fraction=speed_fraction,
            active=sample.active,
            wrong_direction_seconds=wrong_direction_seconds,
            position_reason="si_template_position",
            diagnostics=diagnostics,
        )
        self._state[item.member_id] = _MemberTemporalState(
            route_id=item.route.route_id,
            last_time_utc=now,
            last_phase=float(item.phase),
            last_point=current_point,
            points=points,
            wrong_direction_seconds=wrong_direction_seconds,
        )
        return LiveSIMetricResult(item.member_id, True, metrics, None, diagnostics)


class LiveSIGroupScorer:
    """Score one live SI group against one explicitly selected template."""

    def __init__(
        self,
        template: SynchronizationTemplate,
        *,
        config: ScoringConfig | None = None,
        metrics_engine: LiveSIMetricsEngine | None = None,
        minimum_valid_vehicles: int = 2,
    ) -> None:
        if template.family is not RouteFamily.SI:
            raise ValueError("LiveSIGroupScorer requires an SI template")
        if minimum_valid_vehicles < 1:
            raise ValueError("minimum_valid_vehicles must be positive")
        self.template = template
        self.config = config or ScoringConfig()
        self.metrics_engine = metrics_engine or LiveSIMetricsEngine()
        self.minimum_valid_vehicles = minimum_valid_vehicles

    def export_state(self) -> dict[str, object]:
        return {
            "schemaVersion": LIVE_SI_SCORER_STATE_SCHEMA_VERSION,
            "templateId": self.template.template_id,
            "minimumValidVehicles": self.minimum_valid_vehicles,
            "metricsEngine": self.metrics_engine.export_state(),
        }

    def restore_state(self, state: Mapping[str, object]) -> None:
        if state.get("schemaVersion") != LIVE_SI_SCORER_STATE_SCHEMA_VERSION:
            raise ValueError("unsupported live SI scorer state schema")
        if state.get("templateId") != self.template.template_id:
            raise ValueError("live SI scorer state belongs to a different template")
        minimum = state.get("minimumValidVehicles")
        if isinstance(minimum, bool) or not isinstance(minimum, int) or minimum != self.minimum_valid_vehicles:
            raise ValueError("live SI scorer state uses a different minimum-valid-vehicles configuration")
        raw_metrics = state.get("metricsEngine")
        if not isinstance(raw_metrics, Mapping):
            raise ValueError("live SI scorer metricsEngine state must be an object")
        self.metrics_engine.restore_state(raw_metrics)

    def score_group(
        self,
        group_id: str,
        members: tuple[LiveSIMemberInput, ...],
        *,
        reference_period_s: float,
    ) -> LiveSIGroupScoringResult:
        if not group_id:
            raise ValueError("group_id is required")
        if len(members) != len(self.template.slots):
            raise ValueError("live SI member count must match selected template slots")

        metric_results = tuple(
            self.metrics_engine.observe(member, reference_period_s=reference_period_s)
            for member in members
        )
        pending = [item.reason for item in metric_results if not item.ready]
        if pending:
            return LiveSIGroupScoringResult(
                group_id=group_id,
                template_id=self.template.template_id,
                member_metrics=metric_results,
                scoring=None,
                pending_reason=sorted(str(reason) for reason in pending)[0],
            )

        by_id = {member.member_id: member for member in members}
        scoring_inputs = tuple(
            SIScoringMemberInput(
                member=ObservedMember(
                    member_id=result.member_id,
                    vehicle_type=by_id[result.member_id].vehicle_type,
                    phase=float(by_id[result.member_id].phase),
                    route_role=by_id[result.member_id].route_role,
                ),
                metrics=result.metrics,  # type: ignore[arg-type]
            )
            for result in metric_results
        )
        scoring = score_si_template(
            self.template,
            scoring_inputs,
            self.config,
            minimum_valid_vehicles=self.minimum_valid_vehicles,
        )
        return LiveSIGroupScoringResult(
            group_id=group_id,
            template_id=self.template.template_id,
            member_metrics=metric_results,
            scoring=scoring,
        )


__all__ = [
    "LIVE_SI_METRICS_STATE_SCHEMA_VERSION",
    "LIVE_SI_SCORER_STATE_SCHEMA_VERSION",
    "LiveSIGroupScorer",
    "LiveSIGroupScoringResult",
    "LiveSIMemberInput",
    "LiveSIMetricResult",
    "LiveSIMetricsEngine",
]
