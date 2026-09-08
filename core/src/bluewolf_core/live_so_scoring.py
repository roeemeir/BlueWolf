"""Stateful live SO primitive metrics and selected-template scoring.

This layer closes the gap between the already-validated semantic/template stack
and the existing score contract without embedding application configuration in
``VehicleSample``.

The caller supplies operational bindings that the product/developer layer owns:
``vehicle_type``, ``route_instance_id`` and the configured work speed.  The
algorithm never infers those values from vehicle identifiers.

Pipeline owned here:
    semantic SO frame + confirmed route + sample history
        -> route/period/movement primitive errors
        -> active template from SOTemplateSelectionRegistry
        -> score_so_template()
        -> vehicle and group scores

No alternative score law is introduced.  ``score_so_template`` remains the
single bridge into ``PrimitiveMetrics`` / ``score_vehicle``.

Double-Hippodrome semantics follow the approved active-lobe specification:
``base_period_seconds(full_double)`` is the local Single-Hippodrome period and
phase-rate evidence is accumulated only while the same logical lobe remains
active.  A lobe switch resets the temporal derivative for one observation
rather than fabricating movement through the handoff.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
import math
from types import MappingProxyType
from typing import Any, Mapping

from .config import ScoringConfig
from .double_lobe_geometry import derive_double_hippodrome_components_from_route
from .double_lobe_phase import (
    AmbiguousDoubleLobeProjection,
    project_double_active_lobe_wgs84,
)
from .geometry import (
    curvature_at_phase,
    menger_curvature,
    normalized_curvature_error,
    project_wgs84,
    vector_angle_error_deg,
    wgs84_to_local_m,
)
from .grouping import base_period_seconds
from .models import CanonicalPoint, ClosedRoute, RouteFamily, RouteSubtype, VehicleSample
from .so_phase import (
    AmbiguousSOPhaseProjection,
    UnsupportedSOPhaseGeometry,
    build_so_phase_frame,
    project_so_semantic_phase_wgs84,
)
from .so_scoring import SOGroupScoringResult, SOScoringObservation, score_so_template
from .so_template_bank import SOConstellationSignature, SOTemplateBank
from .so_template_selection import (
    InvalidatedManualSelection,
    SOTemplateSelection,
    SOTemplateSelectionRegistry,
)


_EPS = 1e-12


DiagnosticValue = float | str | bool


@dataclass(frozen=True, slots=True)
class LiveSOMemberInput:
    """One current SO member plus explicit operational metadata.

    ``semantic_phase`` and ``active_so_component_id`` are expected to come from
    the validated semantic session.  They may be missing when a Figure-8 or
    Double handoff is genuinely ambiguous; in that case no score is fabricated.
    """

    member_id: str
    vehicle_type: str
    route_instance_id: str
    route: ClosedRoute
    sample: VehicleSample
    semantic_phase: float | None
    work_speed_mps: float
    active_so_component_id: str | None = None

    def __post_init__(self) -> None:
        if not self.member_id:
            raise ValueError("member_id is required")
        if not self.vehicle_type:
            raise ValueError("vehicle_type is required")
        if not self.route_instance_id:
            raise ValueError("route_instance_id is required")
        if self.route.family is not RouteFamily.SO:
            raise ValueError("LiveSOMemberInput requires an SO route")
        if self.semantic_phase is not None:
            if not math.isfinite(self.semantic_phase):
                raise ValueError("semantic_phase must be finite")
            object.__setattr__(self, "semantic_phase", self.semantic_phase % 1.0)
        if not math.isfinite(self.work_speed_mps) or self.work_speed_mps <= 0.0:
            raise ValueError("work_speed_mps must be finite and positive")
        if self.active_so_component_id == "":
            raise ValueError("active_so_component_id must be non-empty when supplied")


@dataclass(frozen=True, slots=True)
class LiveSOMetricResult:
    member_id: str
    ready: bool
    observation: SOScoringObservation | None
    reason: str | None
    diagnostics: Mapping[str, DiagnosticValue] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.member_id:
            raise ValueError("member_id is required")
        if self.ready != (self.observation is not None):
            raise ValueError("ready must match observation availability")
        if self.ready and self.reason is not None:
            raise ValueError("ready metric result cannot carry a pending reason")
        if not self.ready and not self.reason:
            raise ValueError("pending metric result requires a reason")
        object.__setattr__(self, "diagnostics", MappingProxyType(dict(self.diagnostics)))


@dataclass(frozen=True, slots=True)
class LiveSOGroupScoringResult:
    group_id: str
    selection: SOTemplateSelection
    member_metrics: tuple[LiveSOMetricResult, ...]
    scoring: SOGroupScoringResult | None
    pending_reason: str | None = None

    def __post_init__(self) -> None:
        if not self.group_id:
            raise ValueError("group_id is required")
        if self.selection.group_id != self.group_id:
            raise ValueError("selection belongs to a different group")
        if self.scoring is not None and self.pending_reason is not None:
            raise ValueError("scored group cannot carry a pending reason")
        if self.scoring is None and not self.pending_reason:
            raise ValueError("unscored group requires a pending reason")


@dataclass(slots=True)
class _MemberTemporalState:
    route_id: str
    component_id: str | None
    last_time_utc: datetime
    last_phase: float
    last_point: CanonicalPoint
    points: list[CanonicalPoint]


@dataclass(frozen=True, slots=True)
class _RouteProjectionEvidence:
    distance_m: float
    tangent_east: float
    tangent_north: float
    raw_phase: float
    expected_curvature: float
    route_length_m: float
    short_axis_b_m: float
    component_id: str | None


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("time must be timezone-aware")
    return value.astimezone(UTC)


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
    # SO permits either travel direction structurally.  Route adherence is to
    # the tangent *line*, while direction/quarter semantics live elsewhere.
    return min(directed, abs(180.0 - directed))


def _component_by_id(route: ClosedRoute, component_id: str):
    for component in derive_double_hippodrome_components_from_route(route):
        if component.component_id == component_id:
            return component
    raise ValueError(f"unknown Double Hippodrome component {component_id!r}")


def _projection_evidence(item: LiveSOMemberInput) -> _RouteProjectionEvidence:
    sample = item.sample
    if sample.latitude_deg is None or sample.longitude_deg is None:
        raise ValueError("live SO metrics require a position sample")

    velocity_east = sample.velocity_east_mps
    velocity_north = sample.velocity_north_mps

    if item.route.subtype is RouteSubtype.DOUBLE_HIPPODROME:
        if item.active_so_component_id is None:
            raise AmbiguousDoubleLobeProjection(
                "Double Hippodrome semantic phase has no active component"
            )
        projected = project_double_active_lobe_wgs84(
            item.route,
            sample.latitude_deg,
            sample.longitude_deg,
            velocity_east_mps=velocity_east,
            velocity_north_mps=velocity_north,
        )
        if projected.component_id != item.active_so_component_id:
            raise AmbiguousDoubleLobeProjection(
                "current position disagrees with supplied active Double component"
            )
        component = _component_by_id(item.route, projected.component_id)
        raw = projected.component_projection.projection
        expected_curvature = curvature_at_phase(
            component.canonical_points,
            raw.phase,
        )
        return _RouteProjectionEvidence(
            distance_m=raw.distance_m,
            tangent_east=raw.tangent_east,
            tangent_north=raw.tangent_north,
            raw_phase=raw.phase,
            expected_curvature=expected_curvature,
            route_length_m=component.length_m,
            short_axis_b_m=component.short_axis_b_m,
            component_id=component.component_id,
        )

    # Heading-aware projection is still used for Figure-8 so route-quality
    # metrics cannot silently choose the wrong crossing branch.
    frame = build_so_phase_frame(item.route)
    projected = project_so_semantic_phase_wgs84(
        item.route,
        sample.latitude_deg,
        sample.longitude_deg,
        frame=frame,
        velocity_east_mps=velocity_east,
        velocity_north_mps=velocity_north,
    )
    raw = projected.projection
    return _RouteProjectionEvidence(
        distance_m=raw.distance_m,
        tangent_east=raw.tangent_east,
        tangent_north=raw.tangent_north,
        raw_phase=raw.phase,
        expected_curvature=curvature_at_phase(item.route.canonical_points, raw.phase),
        route_length_m=item.route.length_m,
        short_axis_b_m=item.route.short_axis_b_m,
        component_id=None,
    )


class LiveSOMetricsEngine:
    """Stateful per-member temporal primitive estimator.

    The state contains only the minimum temporal evidence needed for movement
    and Menger-curvature metrics.  A route change, Double-lobe switch, missing
    semantic phase or excessive communication gap resets that derivative state.
    """

    def __init__(self, *, max_contiguous_gap_s: float = 5.0) -> None:
        if not math.isfinite(max_contiguous_gap_s) or max_contiguous_gap_s <= 0.0:
            raise ValueError("max_contiguous_gap_s must be finite and positive")
        self.max_contiguous_gap_s = float(max_contiguous_gap_s)
        self._state: dict[str, _MemberTemporalState] = {}

    def reset_member(self, member_id: str) -> None:
        self._state.pop(member_id, None)

    def observe(
        self,
        item: LiveSOMemberInput,
        *,
        reference_period_s: float,
    ) -> LiveSOMetricResult:
        if not math.isfinite(reference_period_s) or reference_period_s <= 0.0:
            raise ValueError("reference_period_s must be finite and positive")

        sample = item.sample
        now = _utc(sample.sample_time_utc)
        diagnostics: dict[str, DiagnosticValue] = {
            "reference_period_s": float(reference_period_s),
            "route_base_period_s": float(base_period_seconds(item.route)),
        }

        if (
            item.semantic_phase is None
            or sample.active is not True
            or sample.latitude_deg is None
            or sample.longitude_deg is None
        ):
            self.reset_member(item.member_id)
            reason = (
                "semantic_phase_unavailable"
                if item.semantic_phase is None
                else "inactive_or_position_missing"
            )
            return LiveSOMetricResult(item.member_id, False, None, reason, diagnostics)

        try:
            projection = _projection_evidence(item)
        except (
            AmbiguousDoubleLobeProjection,
            AmbiguousSOPhaseProjection,
            UnsupportedSOPhaseGeometry,
        ):
            self.reset_member(item.member_id)
            return LiveSOMetricResult(
                item.member_id,
                False,
                None,
                "projection_ambiguous",
                diagnostics,
            )

        current_point = wgs84_to_local_m(
            sample.latitude_deg,
            sample.longitude_deg,
            item.route.center_latitude_deg,
            item.route.center_longitude_deg,
        )
        component_id = projection.component_id
        previous = self._state.get(item.member_id)

        def seed(reason: str) -> LiveSOMetricResult:
            self._state[item.member_id] = _MemberTemporalState(
                route_id=item.route.route_id,
                component_id=component_id,
                last_time_utc=now,
                last_phase=float(item.semantic_phase),
                last_point=current_point,
                points=[current_point],
            )
            diagnostics["active_component_id"] = component_id or "single"
            return LiveSOMetricResult(item.member_id, False, None, reason, diagnostics)

        if previous is None:
            return seed("temporal_warmup")
        if previous.route_id != item.route.route_id:
            return seed("route_changed")
        if previous.component_id != component_id:
            # Approved Double semantics: roles may switch at the handoff, but a
            # derivative must not bridge two logical Single-Hippodrome surfaces.
            return seed("active_component_changed")

        dt = (now - previous.last_time_utc).total_seconds()
        if dt <= 0.0:
            raise ValueError("member samples must be strictly time-ordered")
        if dt > self.max_contiguous_gap_s:
            return seed("temporal_gap")

        expected_phase_step = dt / reference_period_s
        if expected_phase_step >= 0.5:
            # With more than half a cycle between observations, shortest-cycle
            # unwrapping is not identifiable. This is an observability guard,
            # not a product timing threshold.
            return seed("phase_step_ambiguous")

        phase_delta = _signed_cycle_delta(float(item.semantic_phase), previous.last_phase)
        actual_phase_rate = abs(phase_delta) / dt
        expected_phase_rate = 1.0 / reference_period_s
        movement_error_ratio = abs(actual_phase_rate - expected_phase_rate) / expected_phase_rate
        period_error_ratio = abs(base_period_seconds(item.route) - reference_period_s) / reference_period_s

        velocity_east: float | None = sample.velocity_east_mps
        velocity_north: float | None = sample.velocity_north_mps
        if (velocity_east is None) != (velocity_north is None):
            velocity_east = velocity_north = None
        if velocity_east is None or velocity_north is None:
            velocity_east = (current_point.x_m - previous.last_point.x_m) / dt
            velocity_north = (current_point.y_m - previous.last_point.y_m) / dt
        if not math.isfinite(velocity_east) or not math.isfinite(velocity_north):
            return seed("velocity_unavailable")

        speed = math.hypot(velocity_east, velocity_north)
        speed_fraction = speed / item.work_speed_mps
        tangent_error: float | None = None
        if speed > _EPS:
            tangent_error = _undirected_tangent_error_deg(
                velocity_east,
                velocity_north,
                projection.tangent_east,
                projection.tangent_north,
            )

        points = (previous.points + [current_point])[-3:]
        curvature_error: float | None = None
        if len(points) == 3:
            observed_curvature = menger_curvature(points[0], points[1], points[2])
            # SO route quality is travel-direction invariant, so signed curvature
            # is compared by magnitude. Direction/role semantics live elsewhere.
            curvature_error = normalized_curvature_error(
                abs(observed_curvature),
                abs(projection.expected_curvature),
                projection.route_length_m,
            )
            diagnostics["observed_curvature_abs"] = abs(observed_curvature)
            diagnostics["expected_curvature_abs"] = abs(projection.expected_curvature)

        distance_error = projection.distance_m / max(projection.short_axis_b_m, _EPS)
        diagnostics.update(
            {
                "active_component_id": component_id or "single",
                "dt_s": dt,
                "phase_delta_abs": abs(phase_delta),
                "actual_phase_rate_hz": actual_phase_rate,
                "expected_phase_rate_hz": expected_phase_rate,
                "speed_mps": speed,
                "projection_distance_m": projection.distance_m,
            }
        )

        observation = SOScoringObservation(
            member_id=item.member_id,
            vehicle_type=item.vehicle_type,
            route_instance_id=item.route_instance_id,
            semantic_phase=float(item.semantic_phase),
            period_error_ratio=period_error_ratio,
            movement_error_ratio=movement_error_ratio,
            distance_error_b_ratio=distance_error,
            tangent_error_deg=tangent_error,
            curvature_error_ratio=curvature_error,
            reliability=sample.reliability,
            speed_fraction=speed_fraction,
            active=sample.active,
            diagnostics=diagnostics,
        )

        self._state[item.member_id] = _MemberTemporalState(
            route_id=item.route.route_id,
            component_id=component_id,
            last_time_utc=now,
            last_phase=float(item.semantic_phase),
            last_point=current_point,
            points=points,
        )
        return LiveSOMetricResult(item.member_id, True, observation, None, diagnostics)

    def export_state(self) -> dict[str, Any]:
        members = []
        for member_id, state in sorted(self._state.items()):
            members.append(
                {
                    "member_id": member_id,
                    "route_id": state.route_id,
                    "component_id": state.component_id,
                    "last_time_utc": state.last_time_utc.isoformat(),
                    "last_phase": state.last_phase,
                    "last_point": [state.last_point.x_m, state.last_point.y_m],
                    "points": [[point.x_m, point.y_m] for point in state.points],
                }
            )
        return {
            "max_contiguous_gap_s": self.max_contiguous_gap_s,
            "members": members,
        }

    @classmethod
    def from_state(cls, state: Mapping[str, Any]) -> "LiveSOMetricsEngine":
        engine = cls(max_contiguous_gap_s=float(state.get("max_contiguous_gap_s", 5.0)))
        raw_members = state.get("members", [])
        if not isinstance(raw_members, list):
            raise ValueError("live SO metric state members must be a list")
        for raw in raw_members:
            if not isinstance(raw, Mapping):
                raise ValueError("live SO metric member state must be an object")
            member_id = str(raw.get("member_id", ""))
            if not member_id or member_id in engine._state:
                raise ValueError("live SO metric member ids must be non-empty and unique")
            raw_point = raw.get("last_point")
            raw_points = raw.get("points")
            if not isinstance(raw_point, list) or len(raw_point) != 2:
                raise ValueError("last_point must contain two coordinates")
            if not isinstance(raw_points, list) or not 1 <= len(raw_points) <= 3:
                raise ValueError("points must contain one to three coordinates")
            points = [
                CanonicalPoint(float(point[0]), float(point[1]))
                for point in raw_points
                if isinstance(point, list) and len(point) == 2
            ]
            if len(points) != len(raw_points):
                raise ValueError("invalid points in live SO metric state")
            timestamp = datetime.fromisoformat(str(raw.get("last_time_utc", "")))
            timestamp = _utc(timestamp)
            engine._state[member_id] = _MemberTemporalState(
                route_id=str(raw.get("route_id", "")),
                component_id=(
                    None if raw.get("component_id") is None else str(raw.get("component_id"))
                ),
                last_time_utc=timestamp,
                last_phase=float(raw.get("last_phase")),
                last_point=CanonicalPoint(float(raw_point[0]), float(raw_point[1])),
                points=points,
            )
        return engine


class LiveSOGroupScorer:
    """Selected-template live scorer with checkpointable temporal evidence."""

    def __init__(
        self,
        selection_registry: SOTemplateSelectionRegistry,
        *,
        scoring_config: ScoringConfig | None = None,
        minimum_valid_vehicles: int = 2,
        max_contiguous_gap_s: float = 5.0,
    ) -> None:
        if minimum_valid_vehicles < 1:
            raise ValueError("minimum_valid_vehicles must be positive")
        self.selection_registry = selection_registry
        self.scoring_config = scoring_config or ScoringConfig()
        self.minimum_valid_vehicles = int(minimum_valid_vehicles)
        self.metrics = LiveSOMetricsEngine(max_contiguous_gap_s=max_contiguous_gap_s)

    def score_snapshot(
        self,
        group_id: str,
        constellation: SOConstellationSignature,
        members: tuple[LiveSOMemberInput, ...],
        *,
        reference_period_s: float,
    ) -> LiveSOGroupScoringResult:
        selection = self.selection_registry.active_selection(group_id, constellation)
        metric_results = tuple(
            self.metrics.observe(member, reference_period_s=reference_period_s)
            for member in sorted(members, key=lambda item: item.member_id)
        )
        if selection.template is None:
            return LiveSOGroupScoringResult(
                group_id,
                selection,
                metric_results,
                None,
                "no_active_template",
            )
        pending = tuple(item for item in metric_results if not item.ready)
        if pending:
            reason = ",".join(sorted({str(item.reason) for item in pending}))
            return LiveSOGroupScoringResult(
                group_id,
                selection,
                metric_results,
                None,
                f"member_metrics_pending:{reason}",
            )

        observations = tuple(
            item.observation for item in metric_results if item.observation is not None
        )
        scoring = score_so_template(
            selection.template,
            observations,
            config=self.scoring_config,
            minimum_valid_vehicles=self.minimum_valid_vehicles,
        )
        return LiveSOGroupScoringResult(
            group_id,
            selection,
            metric_results,
            scoring,
            None,
        )

    def export_state(self) -> dict[str, Any]:
        return {
            "template_selection": self.selection_registry.export_state(),
            "metrics": self.metrics.export_state(),
            "minimum_valid_vehicles": self.minimum_valid_vehicles,
        }

    @classmethod
    def from_state(
        cls,
        bank: SOTemplateBank,
        state: Mapping[str, Any],
        *,
        scoring_config: ScoringConfig | None = None,
    ) -> tuple["LiveSOGroupScorer", tuple[InvalidatedManualSelection, ...]]:
        raw_selection = state.get("template_selection", {})
        raw_metrics = state.get("metrics", {})
        if not isinstance(raw_selection, Mapping) or not isinstance(raw_metrics, Mapping):
            raise ValueError("live SO scoring state is malformed")
        registry, invalidated = SOTemplateSelectionRegistry.from_state(bank, raw_selection)
        engine = LiveSOMetricsEngine.from_state(raw_metrics)
        scorer = cls(
            registry,
            scoring_config=scoring_config,
            minimum_valid_vehicles=int(state.get("minimum_valid_vehicles", 2)),
            max_contiguous_gap_s=engine.max_contiguous_gap_s,
        )
        scorer.metrics = engine
        return scorer, invalidated
