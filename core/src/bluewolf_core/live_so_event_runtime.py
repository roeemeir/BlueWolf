"""Compose one live SO metric snapshot into template comparison + event state.

This layer is intentionally thin.  It advances ``LiveSOMetricsEngine`` exactly
once per member/timestamp through ``LiveSOGroupScorer.score_snapshot()``, then
reuses the immutable scoring observations to evaluate alternate approved
SO templates.  No temporal derivative is updated twice.

Two product decisions remain deliberately explicit rather than guessed:

* V1 defines the low-score alert against the *displayed/smoothed* group score,
  but does not define the smoothing algorithm.  The caller therefore supplies
  ``displayed_group_score`` and whether that displayed value is valid.
* V1 says an alternate template must be better by 30 points, but does not say
  whether the comparison dimension is synchronization or total score.  The
  runtime therefore requires an explicit ``TemplateComparisonDimension``.

The runtime owns deterministic event context construction, alternate scoring,
and checkpoint composition.  It does not alter grouping, route detection or the
active template selection registry.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
import hashlib
import json
import math
from types import MappingProxyType
from typing import Any, Mapping

from .event_alert import EventAlertEngine, EventAlertResult, EventObservation
from .live_so_scoring import LiveSOGroupScorer, LiveSOGroupScoringResult, LiveSOMemberInput
from .models import GroupScores
from .so_scoring import SOGroupScoringResult, score_so_template
from .so_template_bank import SOConstellationSignature, SOTemplateBank
from .so_template_fit import NoLegalSOTemplateAssignment
from .so_template_selection import InvalidatedManualSelection


class TemplateComparisonDimension(StrEnum):
    SYNC = "sync"
    TOTAL = "total"


@dataclass(frozen=True, slots=True)
class LiveSOEventRuntimeResult:
    group_id: str
    context_key: str
    live_scoring: LiveSOGroupScoringResult
    scoring_by_template: Mapping[str, SOGroupScoringResult] = field(default_factory=dict)
    comparison_scores: Mapping[str, float] = field(default_factory=dict)
    event: EventAlertResult | None = None

    def __post_init__(self) -> None:
        if not self.group_id:
            raise ValueError("group_id is required")
        if not self.context_key:
            raise ValueError("context_key is required")
        object.__setattr__(
            self,
            "scoring_by_template",
            MappingProxyType(dict(self.scoring_by_template)),
        )
        object.__setattr__(
            self,
            "comparison_scores",
            MappingProxyType(dict(self.comparison_scores)),
        )


def _score_value(scores: GroupScores, dimension: TemplateComparisonDimension) -> float | None:
    if not scores.valid:
        return None
    value = scores.sync if dimension is TemplateComparisonDimension.SYNC else scores.total
    if value is None:
        return None
    numeric = float(value)
    if not math.isfinite(numeric) or not 0.0 <= numeric <= 100.0:
        raise ValueError("group score must be finite and in [0, 100]")
    return numeric


def build_so_event_context_key(
    constellation: SOConstellationSignature,
    members: tuple[LiveSOMemberInput, ...],
    *,
    active_template_id: str | None,
) -> str:
    """Return a stable digest of the event-defining SO semantic context.

    Dynamic lobe/quarter position is intentionally excluded.  Confirmed route
    identity/geometry-period metadata and active template identity are included,
    so a route replacement or synchronization-configuration change produces a
    new context while ordinary progress around the route does not.
    """

    if not members:
        raise ValueError("SO event context requires at least one member")
    payload = {
        "constellation": [
            {
                "route_kind": route.route_kind.value,
                "vehicle_types": list(route.vehicle_types),
            }
            for route in constellation.routes
        ],
        "active_template_id": active_template_id,
        "routes": [
            {
                "member_id": item.member_id,
                "vehicle_type": item.vehicle_type,
                "route_instance_id": item.route_instance_id,
                "route_id": item.route.route_id,
                "family": item.route.family.value,
                "subtype": item.route.subtype.value,
                "topology": item.route.topology.value,
                "estimated_period_s": round(float(item.route.estimated_period_s), 9),
                "length_m": round(float(item.route.length_m), 9),
            }
            for item in sorted(
                members,
                key=lambda value: (
                    value.route_instance_id,
                    value.member_id,
                    value.vehicle_type,
                ),
            )
        ],
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return "so:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class LiveSOEventRuntime:
    """One checkpointable SO live-scoring/event runtime.

    Alternate templates are evaluated only from the already-produced immutable
    ``SOScoringObservation`` objects in the active live-scoring result.  This is
    the key invariant that prevents recommendation evaluation from advancing
    movement/curvature temporal state multiple times at one timestamp.
    """

    def __init__(
        self,
        scorer: LiveSOGroupScorer,
        *,
        comparison_dimension: TemplateComparisonDimension,
        event_engine: EventAlertEngine | None = None,
    ) -> None:
        self.scorer = scorer
        self.comparison_dimension = TemplateComparisonDimension(comparison_dimension)
        self.event_engine = event_engine or EventAlertEngine()

    @property
    def bank(self) -> SOTemplateBank:
        return self.scorer.selection_registry.bank

    def process_snapshot(
        self,
        group_id: str,
        constellation: SOConstellationSignature,
        members: tuple[LiveSOMemberInput, ...],
        *,
        reference_period_s: float,
        displayed_group_score: float | None,
        displayed_score_valid: bool,
    ) -> LiveSOEventRuntimeResult:
        if not members:
            raise ValueError("live SO runtime requires at least one member")

        timestamps = {item.sample.sample_time_utc for item in members}
        server_ids = {item.sample.server_id for item in members}
        if len(timestamps) != 1:
            raise ValueError("live SO runtime requires one common snapshot timestamp")
        if len(server_ids) != 1:
            raise ValueError("live SO runtime requires all members from one server")
        if displayed_group_score is not None:
            numeric = float(displayed_group_score)
            if not math.isfinite(numeric) or not 0.0 <= numeric <= 100.0:
                raise ValueError("displayed_group_score must be finite and in [0, 100]")
        if displayed_score_valid and displayed_group_score is None:
            raise ValueError("a valid displayed score requires a numeric value")

        live = self.scorer.score_snapshot(
            group_id,
            constellation,
            members,
            reference_period_s=reference_period_s,
        )
        selection = live.selection
        context_key = build_so_event_context_key(
            constellation,
            members,
            active_template_id=selection.template_id,
        )

        scoring_by_template: dict[str, SOGroupScoringResult] = {}
        comparison_scores: dict[str, float] = {}
        if live.scoring is not None and selection.template_id is not None:
            scoring_by_template[selection.template_id] = live.scoring

            observations = tuple(
                item.observation
                for item in live.member_metrics
                if item.observation is not None
            )
            if len(observations) == len(members):
                for template in self.bank.relevant_templates(constellation):
                    if template.template_id in scoring_by_template:
                        continue
                    try:
                        result = score_so_template(
                            template,
                            observations,
                            config=self.scorer.scoring_config,
                            minimum_valid_vehicles=self.scorer.minimum_valid_vehicles,
                        )
                    except NoLegalSOTemplateAssignment:
                        # Relevance is constellation-level; a template can still
                        # be impossible for the current explicit Route Instance
                        # binding.  It is not a legal recommendation candidate.
                        continue
                    scoring_by_template[template.template_id] = result

            for template_id, result in scoring_by_template.items():
                value = _score_value(result.group_scores, self.comparison_dimension)
                if value is not None:
                    comparison_scores[template_id] = value

        now = next(iter(timestamps))
        server_id = next(iter(server_ids))
        event = self.event_engine.observe(
            EventObservation(
                sample_time_utc=now,
                server_id=server_id,
                group_id=group_id,
                context_key=context_key,
                group_score=(displayed_group_score if displayed_score_valid else None),
                score_valid=displayed_score_valid,
                active_template_id=selection.template_id,
                template_scores=comparison_scores,
            )
        )

        return LiveSOEventRuntimeResult(
            group_id=group_id,
            context_key=context_key,
            live_scoring=live,
            scoring_by_template=scoring_by_template,
            comparison_scores=comparison_scores,
            event=event,
        )

    def end_group(self, group_id: str, end_time_utc, *, reason: str = "group_inactive"):
        return self.event_engine.end_group(group_id, end_time_utc, reason=reason)

    def reject_suggestion(self, group_id: str, rejected_at_utc):
        return self.event_engine.reject_suggestion(group_id, rejected_at_utc)

    def export_state(self) -> dict[str, Any]:
        return {
            "comparison_dimension": self.comparison_dimension.value,
            "live_so_scorer": self.scorer.export_state(),
            "event_alert": self.event_engine.export_state(),
        }

    @classmethod
    def from_state(
        cls,
        bank: SOTemplateBank,
        state: Mapping[str, Any],
        *,
        scoring_config=None,
        event_config=None,
    ) -> tuple["LiveSOEventRuntime", tuple[InvalidatedManualSelection, ...]]:
        raw_scorer = state.get("live_so_scorer", {})
        raw_event = state.get("event_alert", {})
        if not isinstance(raw_scorer, Mapping) or not isinstance(raw_event, Mapping):
            raise ValueError("live SO event runtime state is malformed")
        scorer, invalidated = LiveSOGroupScorer.from_state(
            bank,
            raw_scorer,
            scoring_config=scoring_config,
        )
        event_engine = EventAlertEngine.from_state(raw_event, config=event_config)
        try:
            dimension = TemplateComparisonDimension(str(state["comparison_dimension"]))
        except (KeyError, ValueError) as exc:
            raise ValueError("invalid template comparison dimension in runtime state") from exc
        return (
            cls(
                scorer,
                comparison_dimension=dimension,
                event_engine=event_engine,
            ),
            invalidated,
        )
