"""Explicit SI template-to-score bridge.

BW-SYNC-012 requires template edits to change the calculated score itself, not
only the drawing.  This module is the single composition point from the
vehicle-ID-independent template fitter into the existing deterministic score
law: each fitted slot supplies the SI position error in degrees, while every
other primitive metric remains untouched.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Mapping

from .config import ScoringConfig
from .models import GroupScores, PrimitiveMetrics, RouteFamily, VehicleScores
from .scoring import aggregate_group_scores, score_vehicle
from .templates import ObservedMember, SynchronizationTemplate, TemplateFit, fit_template


@dataclass(frozen=True, slots=True)
class SIScoringMemberInput:
    member: ObservedMember
    metrics: PrimitiveMetrics

    def __post_init__(self) -> None:
        if self.metrics.family is not RouteFamily.SI:
            raise ValueError("SI scoring member metrics must use RouteFamily.SI")


@dataclass(frozen=True, slots=True)
class SIScoringResult:
    template_id: str
    fit: TemplateFit
    member_scores: Mapping[str, VehicleScores]
    group_scores: GroupScores

    def __post_init__(self) -> None:
        object.__setattr__(self, "member_scores", MappingProxyType(dict(self.member_scores)))


def score_si_template(
    template: SynchronizationTemplate,
    members: tuple[SIScoringMemberInput, ...],
    config: ScoringConfig | None = None,
    *,
    minimum_valid_vehicles: int = 2,
) -> SIScoringResult:
    """Fit one SI template and calculate raw member/group scores from that fit.

    The returned scores are raw Core scores.  Display smoothing, if enabled, is
    intentionally a downstream presentation concern and never feeds back here.
    """
    if template.family is not RouteFamily.SI:
        raise ValueError("score_si_template requires an SI template")
    if not members:
        raise ValueError("score_si_template requires members")
    ids = [item.member.member_id for item in members]
    if len(ids) != len(set(ids)):
        raise ValueError("SI scoring member ids must be unique")

    fit = fit_template(template, tuple(item.member for item in members))
    fit_by_member = {item.member_id: item for item in fit.members}
    scored: dict[str, VehicleScores] = {}
    for item in members:
        fitted = fit_by_member[item.member.member_id]
        diagnostics = dict(item.metrics.diagnostics)
        diagnostics.update(
            {
                "si_template_id": template.template_id,
                "si_slot_id": fitted.slot_id,
                "si_expected_phase": fitted.expected_phase,
                "si_position_error_deg": fitted.position_error_deg,
            }
        )
        effective = replace(
            item.metrics,
            position_error=fitted.position_error_deg,
            position_reason="si_template_position",
            diagnostics=diagnostics,
        )
        scored[item.member.member_id] = score_vehicle(effective, config)

    group = aggregate_group_scores(scored.values(), minimum_valid_vehicles)
    return SIScoringResult(
        template_id=template.template_id,
        fit=fit,
        member_scores=scored,
        group_scores=group,
    )
