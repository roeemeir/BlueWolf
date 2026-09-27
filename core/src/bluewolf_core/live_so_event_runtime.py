"""Compose one live SO metric snapshot into template comparison + event state.

This layer is intentionally thin. It advances ``LiveSOMetricsEngine`` exactly
once per member/timestamp through ``LiveSOGroupScorer.score_snapshot()``, then
reuses the immutable scoring observations to evaluate alternate approved SO
templates. No temporal derivative is updated twice.

The runtime owns deterministic event context construction, alternate scoring,
checkpoint composition and a reporting-only lifecycle sink. The lifecycle sink
receives truth-backed transitions produced by ``EventAlertEngine`` plus explicit
``event_ending``/recommendation-close records derived from the engine's own
before/after state. Those records never participate in grouping, detection,
template selection or scoring.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from enum import StrEnum
import hashlib
import json
import math
from types import MappingProxyType
from typing import Any, Callable, Mapping

from .event_alert import EventAlertEngine, EventAlertResult, EventObservation
from .event_recompute import SOEventNavigationPoint, SOEventObservationFrame
from .event_route_evidence import SOEventRouteEvidence, snapshot_closed_route
from .live_so_scoring import LiveSOGroupScorer, LiveSOGroupScoringResult, LiveSOMemberInput
from .models import ChangeKind, GroupScores, StateChange
from .so_scoring import SOGroupScoringResult, score_so_template
from .so_template_bank import SOConstellationSignature, SOTemplateBank
from .so_template_fit import NoLegalSOTemplateAssignment
from .so_template_selection import InvalidatedManualSelection


class TemplateComparisonDimension(StrEnum):
    SYNC = "sync"
    TOTAL = "total"


ObservationSink = Callable[[SOEventObservationFrame], None]
LifecycleSink = Callable[[StateChange], None]


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
        object.__setattr__(self, "scoring_by_template", MappingProxyType(dict(self.scoring_by_template)))
        object.__setattr__(self, "comparison_scores", MappingProxyType(dict(self.comparison_scores)))


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
    if not members:
        raise ValueError("SO event context requires at least one member")
    payload = {
        "constellation": [
            {"route_kind": route.route_kind.value, "vehicle_types": list(route.vehicle_types)}
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
            for item in sorted(members, key=lambda value: (value.route_instance_id, value.member_id, value.vehicle_type))
        ],
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return "so:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _navigation_evidence(members: tuple[LiveSOMemberInput, ...]) -> tuple[SOEventNavigationPoint, ...]:
    return tuple(
        SOEventNavigationPoint(
            member_id=item.member_id,
            vehicle_identifier=item.sample.vehicle_identifier,
            latitude_deg=item.sample.latitude_deg,
            longitude_deg=item.sample.longitude_deg,
            altitude_m=item.sample.altitude_m,
            velocity_north_mps=item.sample.velocity_north_mps,
            velocity_east_mps=item.sample.velocity_east_mps,
            active=item.sample.active,
            reliability=item.sample.reliability,
        )
        for item in sorted(members, key=lambda value: value.member_id)
    )


def _route_evidence(members: tuple[LiveSOMemberInput, ...]) -> tuple[SOEventRouteEvidence, ...]:
    by_instance: dict[str, SOEventRouteEvidence] = {}
    for item in members:
        snapshot = snapshot_closed_route(item.route_instance_id, item.route)
        existing = by_instance.get(item.route_instance_id)
        if existing is not None and existing != snapshot:
            raise ValueError("members sharing a route instance have conflicting detected-route geometry")
        by_instance[item.route_instance_id] = snapshot
    return tuple(by_instance[key] for key in sorted(by_instance))


class LiveSOEventRuntime:
    """One checkpointable SO live-scoring/event runtime with reporting sinks."""

    def __init__(
        self,
        scorer: LiveSOGroupScorer,
        *,
        comparison_dimension: TemplateComparisonDimension,
        event_engine: EventAlertEngine | None = None,
        observation_sink: ObservationSink | None = None,
        lifecycle_sink: LifecycleSink | None = None,
    ) -> None:
        self.scorer = scorer
        self.comparison_dimension = TemplateComparisonDimension(comparison_dimension)
        self.event_engine = event_engine or EventAlertEngine()
        self.observation_sink = observation_sink
        self.lifecycle_sink = lifecycle_sink

    @property
    def bank(self) -> SOTemplateBank:
        return self.scorer.selection_registry.bank

    def _emit_lifecycle(self, change: StateChange) -> None:
        if self.lifecycle_sink is not None and change.event_id:
            self.lifecycle_sink(change)

    def _emit_engine_changes(self, changes: tuple[StateChange, ...], *, opening_reason: str | None = None) -> None:
        for change in changes:
            if change.kind is ChangeKind.EVENT_OPENED and opening_reason is not None:
                self._emit_lifecycle(
                    StateChange(
                        change_time_utc=change.change_time_utc,
                        kind=change.kind,
                        server_id=change.server_id,
                        vehicle_identifier=change.vehicle_identifier,
                        group_id=change.group_id,
                        event_id=change.event_id,
                        details={**dict(change.details), "reason": opening_reason},
                    )
                )
            else:
                self._emit_lifecycle(change)

    def advance_events(self, observed_until_utc) -> tuple[StateChange, ...]:
        """Finalize pending ended events even when no group produces a new frame."""

        changes = self.event_engine.advance(observed_until_utc)
        self._emit_engine_changes(changes)
        return changes

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

        live = self.scorer.score_snapshot(group_id, constellation, members, reference_period_s=reference_period_s)
        selection = live.selection
        context_key = build_so_event_context_key(constellation, members, active_template_id=selection.template_id)

        scoring_by_template: dict[str, SOGroupScoringResult] = {}
        comparison_scores: dict[str, float] = {}
        observations = tuple(item.observation for item in live.member_metrics if item.observation is not None)
        if live.scoring is not None and selection.template_id is not None:
            scoring_by_template[selection.template_id] = live.scoring
            if len(observations) == len(members):
                for template in self.bank.relevant_templates(constellation):
                    if template.template_id in scoring_by_template:
                        continue
                    try:
                        result = score_so_template(template, observations, config=self.scorer.scoring_config, minimum_valid_vehicles=self.scorer.minimum_valid_vehicles)
                    except NoLegalSOTemplateAssignment:
                        continue
                    scoring_by_template[template.template_id] = result
            for template_id, result in scoring_by_template.items():
                value = _score_value(result.group_scores, self.comparison_dimension)
                if value is not None:
                    comparison_scores[template_id] = value

        now = next(iter(timestamps))
        server_id = next(iter(server_ids))
        before = self.event_engine.snapshot(group_id)
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

        context_changed = before is not None and before.event_id != event.snapshot.event_id
        if context_changed:
            finalize_at = now + timedelta(seconds=self.event_engine.config.event_finalize_seconds)
            self._emit_lifecycle(
                StateChange(
                    change_time_utc=now,
                    kind=ChangeKind.EVENT_ENDING,
                    server_id=before.server_id,
                    group_id=before.group_id,
                    event_id=before.event_id,
                    details={
                        "reason": "context_changed",
                        "finalize_at_utc": finalize_at.isoformat().replace("+00:00", "Z"),
                    },
                )
            )
        opening_reason = "context_changed" if context_changed else ("group_became_active" if before is None else None)
        self._emit_engine_changes(event.changes, opening_reason=opening_reason)

        if before is not None and before.event_id == event.snapshot.event_id and before.suggested_template_id is not None and event.snapshot.suggested_template_id is None:
            self._emit_lifecycle(
                StateChange(
                    change_time_utc=now,
                    kind=ChangeKind.TEMPLATE_SUGGESTION_CLOSED,
                    server_id=event.snapshot.server_id,
                    group_id=event.snapshot.group_id,
                    event_id=event.snapshot.event_id,
                    details={
                        "suggested_template_id": before.suggested_template_id,
                        "reason": "advantage_below_close_threshold",
                    },
                )
            )

        if self.observation_sink is not None:
            pending_reason: str | None = None
            if len(observations) != len(members):
                pending_reason = "core_observations_incomplete"
            elif selection.template_id is None:
                pending_reason = "active_template_unavailable"
            elif live.scoring is None:
                pending_reason = "core_scoring_not_ready"
            self.observation_sink(
                SOEventObservationFrame(
                    event_id=event.snapshot.event_id,
                    server_id=server_id,
                    group_id=group_id,
                    sample_time_utc=now,
                    observations=observations,
                    active_template_id=selection.template_id,
                    pending_reason=pending_reason,
                    navigation=_navigation_evidence(members),
                    routes=_route_evidence(members),
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
        before = self.event_engine.snapshot(group_id)
        changes = self.event_engine.end_group(group_id, end_time_utc, reason=reason)
        self._emit_engine_changes(changes)
        if before is not None:
            finalize_at = end_time_utc + timedelta(seconds=self.event_engine.config.event_finalize_seconds)
            self._emit_lifecycle(
                StateChange(
                    change_time_utc=end_time_utc,
                    kind=ChangeKind.EVENT_ENDING,
                    server_id=before.server_id,
                    group_id=before.group_id,
                    event_id=before.event_id,
                    details={
                        "reason": reason,
                        "finalize_at_utc": finalize_at.isoformat().replace("+00:00", "Z"),
                    },
                )
            )
        return changes

    def reject_suggestion(self, group_id: str, rejected_at_utc):
        before = self.event_engine.snapshot(group_id)
        snapshot = self.event_engine.reject_suggestion(group_id, rejected_at_utc)
        if before is not None and before.suggested_template_id is not None:
            self._emit_lifecycle(
                StateChange(
                    change_time_utc=rejected_at_utc,
                    kind=ChangeKind.TEMPLATE_SUGGESTION_REJECTED,
                    server_id=before.server_id,
                    group_id=before.group_id,
                    event_id=before.event_id,
                    details={"suggested_template_id": before.suggested_template_id, "reason": "operator_rejected"},
                )
            )
        return snapshot

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
        observation_sink: ObservationSink | None = None,
        lifecycle_sink: LifecycleSink | None = None,
    ) -> tuple["LiveSOEventRuntime", tuple[InvalidatedManualSelection, ...]]:
        raw_scorer = state.get("live_so_scorer", {})
        raw_event = state.get("event_alert", {})
        if not isinstance(raw_scorer, Mapping) or not isinstance(raw_event, Mapping):
            raise ValueError("live SO event runtime state is malformed")
        scorer, invalidated = LiveSOGroupScorer.from_state(bank, raw_scorer, scoring_config=scoring_config)
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
                observation_sink=observation_sink,
                lifecycle_sink=lifecycle_sink,
            ),
            invalidated,
        )


__all__ = [
    "LifecycleSink",
    "LiveSOEventRuntime",
    "LiveSOEventRuntimeResult",
    "ObservationSink",
    "TemplateComparisonDimension",
    "build_so_event_context_key",
]
