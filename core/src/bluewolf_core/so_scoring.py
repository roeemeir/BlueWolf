"""Bridge normalized SO template fits into the existing score contract.

This module does not invent a second scoring law.  It takes one already-selected
``SOTemplate``, fits a complete semantic-phase snapshot to its legal slots, uses
the resulting per-member cycle error as ``PrimitiveMetrics.position_error``, and
then delegates to the existing ``score_vehicle`` / ``aggregate_group_scores``
functions.

Period, movement and route-quality errors remain independent inputs.  This keeps
selection/fitting separate from the approved score weights and lets later live
state estimate temporal metrics without coupling them to template assignment.
SO turn timing can be preserved in diagnostics or used as ``position_reason``;
it never becomes a fourth top-level score weight here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Mapping

from .config import ScoringConfig
from .models import GroupScores, PrimitiveMetrics, RouteFamily, VehicleScores
from .scoring import aggregate_group_scores, score_vehicle
from .so_template_fit import SOObservedMember, SOTemplateFit, fit_so_template
from .so_templates import SOTemplate


DiagnosticValue = float | str | bool


@dataclass(frozen=True, slots=True)
class SOScoringObservation:
    """One member snapshot with semantic phase plus non-position primitives.

    The snapshot is intentionally complete for one selected template.  A member
    may be marked inactive or unreliable so ``score_vehicle`` returns an invalid
    score, but template assignment still requires a semantic phase for every
    legal slot.  Missing semantic evidence should therefore prevent this bridge
    from being called for that timestamp rather than fabricate a position.
    """

    member_id: str
    vehicle_type: str
    route_instance_id: str
    semantic_phase: float
    period_error_ratio: float
    movement_error_ratio: float
    distance_error_b_ratio: float
    tangent_error_deg: float | None
    curvature_error_ratio: float | None
    reliability: float
    speed_fraction: float
    active: bool | None = True
    position_reason: str = "so_template_phase"
    diagnostics: Mapping[str, DiagnosticValue] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Reuse the fit-layer validator for identifiers and semantic phase.
        SOObservedMember(
            member_id=self.member_id,
            vehicle_type=self.vehicle_type,
            route_instance_id=self.route_instance_id,
            semantic_phase=self.semantic_phase,
        )
        if not self.position_reason:
            raise ValueError("position_reason is required")
        object.__setattr__(
            self,
            "diagnostics",
            MappingProxyType(dict(self.diagnostics)),
        )

    def template_member(self) -> SOObservedMember:
        return SOObservedMember(
            member_id=self.member_id,
            vehicle_type=self.vehicle_type,
            route_instance_id=self.route_instance_id,
            semantic_phase=self.semantic_phase,
        )


@dataclass(frozen=True, slots=True)
class SOMemberScoringResult:
    member_id: str
    route_instance_id: str
    slot_id: str
    expected_phase: float
    position_error_cycle: float
    metrics: PrimitiveMetrics
    scores: VehicleScores


@dataclass(frozen=True, slots=True)
class SOGroupScoringResult:
    template_fit: SOTemplateFit
    members: tuple[SOMemberScoringResult, ...]
    group_scores: GroupScores


def score_so_template(
    template: SOTemplate,
    observations: tuple[SOScoringObservation, ...],
    *,
    config: ScoringConfig | None = None,
    minimum_valid_vehicles: int = 2,
) -> SOGroupScoringResult:
    """Fit one selected SO template and score every member deterministically."""

    if minimum_valid_vehicles < 1:
        raise ValueError("minimum_valid_vehicles must be positive")
    active_config = config or ScoringConfig()
    fit = fit_so_template(
        template,
        tuple(observation.template_member() for observation in observations),
    )
    observation_by_id = {observation.member_id: observation for observation in observations}

    results: list[SOMemberScoringResult] = []
    for member_fit in fit.members:
        observation = observation_by_id[member_fit.member_id]
        diagnostics = dict(observation.diagnostics)
        # Reserved fit diagnostics always describe the actual selected result;
        # caller-supplied entries cannot override them.
        diagnostics.update(
            {
                "template_id": fit.template_id,
                "route_instance_id": member_fit.route_instance_id,
                "slot_id": member_fit.slot_id,
                "expected_phase": member_fit.expected_phase,
                "template_common_phase": fit.common_phase,
            }
        )
        metrics = PrimitiveMetrics(
            family=RouteFamily.SO,
            position_error=member_fit.position_error_cycle,
            period_error_ratio=observation.period_error_ratio,
            movement_error_ratio=observation.movement_error_ratio,
            distance_error_b_ratio=observation.distance_error_b_ratio,
            tangent_error_deg=observation.tangent_error_deg,
            curvature_error_ratio=observation.curvature_error_ratio,
            reliability=observation.reliability,
            speed_fraction=observation.speed_fraction,
            active=observation.active,
            position_reason=observation.position_reason,
            diagnostics=diagnostics,
        )
        results.append(
            SOMemberScoringResult(
                member_id=member_fit.member_id,
                route_instance_id=member_fit.route_instance_id,
                slot_id=member_fit.slot_id,
                expected_phase=member_fit.expected_phase,
                position_error_cycle=member_fit.position_error_cycle,
                metrics=metrics,
                scores=score_vehicle(metrics, active_config),
            )
        )

    group_scores = aggregate_group_scores(
        (item.scores for item in results),
        minimum_valid_vehicles=minimum_valid_vehicles,
    )
    return SOGroupScoringResult(
        template_fit=fit,
        members=tuple(results),
        group_scores=group_scores,
    )
