"""Stateful first-class SI family runtime.

SI and SO have different template/geometry semantics, but the outer runtime
lifecycle is identical: one temporal scoring pass, immutable alternate-template
comparison, event/alert lifecycle, reporting sinks and checkpoint replay.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import timedelta
import hashlib
import json
import math
from types import MappingProxyType
from typing import Any

from .config import ScoringConfig
from .event_alert import EventAlertConfig, EventAlertEngine, EventAlertResult, EventObservation
from .event_recompute import SIEventObservationFrame, SOEventNavigationPoint
from .event_route_evidence import SOEventRouteEvidence, snapshot_closed_route
from .live_si_scoring import LiveSIGroupScorer, LiveSIGroupScoringResult, LiveSIMemberInput
from .models import ChangeKind, GroupScores, RouteFamily, StateChange
from .si_scoring import SIScoringMemberInput, SIScoringResult, score_si_template
from .templates import NoLegalTemplateAssignment, ObservedMember, SynchronizationTemplate


LIVE_SI_RUNTIME_STATE_SCHEMA_VERSION = "bluewolf.live-si-runtime.v1"
SIObservationSink = Callable[[SIEventObservationFrame], None]
SILifecycleSink = Callable[[StateChange], None]


@dataclass(frozen=True, slots=True)
class LiveSIEventRuntimeResult:
    group_id: str
    context_key: str
    live_scoring: LiveSIGroupScoringResult
    scoring_by_template: Mapping[str, SIScoringResult] = field(default_factory=dict)
    comparison_scores: Mapping[str, float] = field(default_factory=dict)
    event: EventAlertResult | None = None

    def __post_init__(self) -> None:
        if not self.group_id:
            raise ValueError("group_id is required")
        if not self.context_key:
            raise ValueError("context_key is required")
        object.__setattr__(self, "scoring_by_template", MappingProxyType(dict(self.scoring_by_template)))
        object.__setattr__(self, "comparison_scores", MappingProxyType(dict(self.comparison_scores)))


def _score_value(scores: GroupScores, dimension: str) -> float | None:
    if not scores.valid:
        return None
    value = scores.sync if dimension == "sync" else scores.total
    if value is None:
        return None
    numeric = float(value)
    if not math.isfinite(numeric) or not 0.0 <= numeric <= 100.0:
        raise ValueError("group score must be finite and in [0,100]")
    return numeric


def _context_key(
    members: tuple[LiveSIMemberInput, ...],
    *,
    active_template_id: str,
) -> str:
    payload = {
        "active_template_id": active_template_id,
        "routes": [
            {
                "member_id": item.member_id,
                "vehicle_type": item.vehicle_type,
                "route_role": item.route_role,
                "route_id": item.route.route_id,
                "family": item.route.family.value,
                "subtype": item.route.subtype.value,
                "topology": item.route.topology.value,
                "estimated_period_s": round(float(item.route.estimated_period_s), 9),
                "length_m": round(float(item.route.length_m), 9),
            }
            for item in sorted(members, key=lambda value: value.member_id)
        ],
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return "si:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _scoring_inputs(
    members: tuple[LiveSIMemberInput, ...],
    live: LiveSIGroupScoringResult,
) -> tuple[SIScoringMemberInput, ...]:
    metrics = {item.member_id: item for item in live.member_metrics}
    output: list[SIScoringMemberInput] = []
    for member in sorted(members, key=lambda item: item.member_id):
        result = metrics.get(member.member_id)
        if result is None or result.metrics is None:
            return ()
        output.append(
            SIScoringMemberInput(
                member=ObservedMember(
                    member_id=member.member_id,
                    vehicle_type=member.vehicle_type,
                    phase=float(member.phase),
                    route_role=member.route_role,
                ),
                metrics=result.metrics,
            )
        )
    return tuple(output)


def _navigation_evidence(members: tuple[LiveSIMemberInput, ...]) -> tuple[SOEventNavigationPoint, ...]:
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


def _route_evidence(members: tuple[LiveSIMemberInput, ...]) -> tuple[SOEventRouteEvidence, ...]:
    return tuple(
        snapshot_closed_route(f"si:{item.member_id}", item.route)
        for item in sorted(members, key=lambda value: value.member_id)
    )


class LiveSIRuntime:
    """One checkpointable SI live-scoring/event runtime with reporting sinks."""

    def __init__(
        self,
        templates: tuple[SynchronizationTemplate, ...],
        *,
        scoring_config: ScoringConfig | None = None,
        event_config: EventAlertConfig | None = None,
        comparison_dimension: str = "sync",
        event_engine: EventAlertEngine | None = None,
        observation_sink: SIObservationSink | None = None,
        lifecycle_sink: SILifecycleSink | None = None,
    ) -> None:
        if not templates:
            raise ValueError("live SI runtime requires at least one template")
        by_id: dict[str, SynchronizationTemplate] = {}
        for template in templates:
            if template.family is not RouteFamily.SI:
                raise ValueError("live SI runtime accepts SI templates only")
            if template.template_id in by_id:
                raise ValueError("live SI runtime template ids must be unique")
            by_id[template.template_id] = template
        if comparison_dimension not in {"sync", "total"}:
            raise ValueError("SI comparison_dimension must be sync or total")
        self.templates = tuple(templates)
        self._templates = by_id
        self.scoring_config = scoring_config or ScoringConfig()
        self.comparison_dimension = comparison_dimension
        self.event_engine = event_engine or EventAlertEngine(event_config)
        self.observation_sink = observation_sink
        self.lifecycle_sink = lifecycle_sink
        self._scorers: dict[tuple[str, str], LiveSIGroupScorer] = {}

    def scorer(self, group_id: str, template: SynchronizationTemplate) -> LiveSIGroupScorer:
        if not group_id:
            raise ValueError("SI runtime group_id is required")
        configured = self._templates.get(template.template_id)
        if configured is None or configured != template:
            raise ValueError("SI runtime scorer requested an unconfigured template")
        key = (group_id, template.template_id)
        scorer = self._scorers.get(key)
        if scorer is None:
            scorer = LiveSIGroupScorer(template, config=self.scoring_config)
            self._scorers[key] = scorer
        return scorer

    def _emit_lifecycle(self, change: StateChange) -> None:
        if self.lifecycle_sink is not None and change.event_id:
            self.lifecycle_sink(change)

    def _emit_engine_changes(
        self,
        changes: tuple[StateChange, ...],
        *,
        opening_reason: str | None = None,
    ) -> None:
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
        changes = self.event_engine.advance(observed_until_utc)
        self._emit_engine_changes(changes)
        return changes

    def process_snapshot(
        self,
        group_id: str,
        template: SynchronizationTemplate,
        members: tuple[LiveSIMemberInput, ...],
        *,
        reference_period_s: float,
        displayed_group_score: float | None,
        displayed_score_valid: bool,
    ) -> LiveSIEventRuntimeResult:
        if not members:
            raise ValueError("live SI runtime requires at least one member")
        timestamps = {item.sample.sample_time_utc for item in members}
        server_ids = {item.sample.server_id for item in members}
        if len(timestamps) != 1 or len(server_ids) != 1:
            raise ValueError("live SI runtime requires one server and one common timestamp")
        if displayed_group_score is not None:
            numeric = float(displayed_group_score)
            if not math.isfinite(numeric) or not 0.0 <= numeric <= 100.0:
                raise ValueError("displayed_group_score must be finite and in [0,100]")
        if displayed_score_valid and displayed_group_score is None:
            raise ValueError("a valid displayed score requires a numeric value")

        live = self.scorer(group_id, template).score_group(
            group_id,
            members,
            reference_period_s=reference_period_s,
        )
        inputs = _scoring_inputs(members, live)
        scoring_by_template: dict[str, SIScoringResult] = {}
        comparison_scores: dict[str, float] = {}
        if live.scoring is not None:
            scoring_by_template[template.template_id] = live.scoring
        if inputs:
            for candidate in self.templates:
                if candidate.template_id in scoring_by_template:
                    continue
                try:
                    scoring_by_template[candidate.template_id] = score_si_template(
                        candidate,
                        inputs,
                        config=self.scoring_config,
                        minimum_valid_vehicles=self.scorer(group_id, template).minimum_valid_vehicles,
                    )
                except NoLegalTemplateAssignment:
                    continue
        for template_id, result in scoring_by_template.items():
            value = _score_value(result.group_scores, self.comparison_dimension)
            if value is not None:
                comparison_scores[template_id] = value

        now = next(iter(timestamps))
        server_id = next(iter(server_ids))
        context_key = _context_key(members, active_template_id=template.template_id)
        before = self.event_engine.snapshot(group_id)
        event = self.event_engine.observe(
            EventObservation(
                sample_time_utc=now,
                server_id=server_id,
                group_id=group_id,
                context_key=context_key,
                group_score=displayed_group_score if displayed_score_valid else None,
                score_valid=displayed_score_valid,
                active_template_id=template.template_id,
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

        if (
            before is not None
            and before.event_id == event.snapshot.event_id
            and before.suggested_template_id is not None
            and event.snapshot.suggested_template_id is None
        ):
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
            pending_reason = live.pending_reason if not inputs else None
            self.observation_sink(
                SIEventObservationFrame(
                    event_id=event.snapshot.event_id,
                    server_id=server_id,
                    group_id=group_id,
                    sample_time_utc=now,
                    observations=inputs,
                    active_template_id=template.template_id,
                    pending_reason=pending_reason,
                    navigation=_navigation_evidence(members),
                    routes=_route_evidence(members),
                )
            )

        return LiveSIEventRuntimeResult(
            group_id=group_id,
            context_key=context_key,
            live_scoring=live,
            scoring_by_template=scoring_by_template,
            comparison_scores=comparison_scores,
            event=event,
        )

    def end_group(self, group_id: str, end_time_utc, *, reason: str = "group_inactive") -> tuple[StateChange, ...]:
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
        self.remove_group(group_id)
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
                    details={
                        "suggested_template_id": before.suggested_template_id,
                        "reason": "operator_rejected",
                    },
                )
            )
        return snapshot

    def remove_group(self, group_id: str) -> None:
        for key in [key for key in self._scorers if key[0] == group_id]:
            self._scorers.pop(key, None)

    def export_state(self) -> dict[str, object]:
        return {
            "schemaVersion": LIVE_SI_RUNTIME_STATE_SCHEMA_VERSION,
            "comparisonDimension": self.comparison_dimension,
            "eventAlert": self.event_engine.export_state(),
            "scorers": [
                {
                    "groupId": group_id,
                    "templateId": template_id,
                    "state": scorer.export_state(),
                }
                for (group_id, template_id), scorer in sorted(self._scorers.items())
            ],
        }

    @classmethod
    def from_state(
        cls,
        templates: tuple[SynchronizationTemplate, ...],
        state: Mapping[str, object],
        *,
        scoring_config: ScoringConfig | None = None,
        event_config: EventAlertConfig | None = None,
        observation_sink: SIObservationSink | None = None,
        lifecycle_sink: SILifecycleSink | None = None,
    ) -> "LiveSIRuntime":
        if state.get("schemaVersion") != LIVE_SI_RUNTIME_STATE_SCHEMA_VERSION:
            raise ValueError("unsupported live SI runtime state schema")
        raw_scorers = state.get("scorers")
        raw_event = state.get("eventAlert", {"active_events": [], "ended_events": []})
        if not isinstance(raw_scorers, list) or not isinstance(raw_event, Mapping):
            raise ValueError("live SI runtime state is malformed")
        comparison_dimension = str(state.get("comparisonDimension") or "sync")
        runtime = cls(
            templates,
            scoring_config=scoring_config,
            event_config=event_config,
            comparison_dimension=comparison_dimension,
            event_engine=EventAlertEngine.from_state(raw_event, config=event_config),
            observation_sink=observation_sink,
            lifecycle_sink=lifecycle_sink,
        )
        seen: set[tuple[str, str]] = set()
        for index, raw in enumerate(raw_scorers):
            if not isinstance(raw, Mapping):
                raise ValueError(f"live SI runtime scorer {index} must be an object")
            group_id = raw.get("groupId")
            template_id = raw.get("templateId")
            scorer_state = raw.get("state")
            if not isinstance(group_id, str) or not group_id:
                raise ValueError("live SI runtime scorer groupId is required")
            if not isinstance(template_id, str) or not template_id:
                raise ValueError("live SI runtime scorer templateId is required")
            if not isinstance(scorer_state, Mapping):
                raise ValueError("live SI runtime scorer state must be an object")
            key = (group_id, template_id)
            if key in seen:
                raise ValueError("live SI runtime scorer keys must be unique")
            seen.add(key)
            template = runtime._templates.get(template_id)
            if template is None:
                raise ValueError(f"persisted SI scorer references unavailable template: {template_id}")
            scorer = LiveSIGroupScorer(template, config=runtime.scoring_config)
            scorer.restore_state(scorer_state)
            runtime._scorers[key] = scorer
        return runtime


__all__ = [
    "LIVE_SI_RUNTIME_STATE_SCHEMA_VERSION",
    "LiveSIEventRuntimeResult",
    "LiveSIRuntime",
    "SIObservationSink",
    "SILifecycleSink",
]
