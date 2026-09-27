"""Explicit truth-backed SO score bridge, using ONE temporal Core pass per tick.

The selected SO bank/template and its group score come only from the existing
LiveSOGroupScorer. The ten-second window affects the displayed score and low-
score alert, never route grouping or raw alternative-template comparisons.
This is intentionally opt-in until SO publication/binding has E2E evidence.
"""
from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from bluewolf_core.core_display_score import CoreDisplayedScoreWindow
from bluewolf_core.event_alert import EventAlertConfig, EventAlertEngine, EventObservation
from bluewolf_core.event_recompute import SOEventObservationFrame
from bluewolf_core.live_so_event_runtime import (
    LiveSOEventRuntime,
    LiveSOEventRuntimeResult,
    LifecycleSink,
    ObservationSink,
    TemplateComparisonDimension,
    _navigation_evidence,
    _route_evidence,
    _score_value,
    build_so_event_context_key,
)
from bluewolf_core.live_so_scoring import LiveSOGroupScorer, LiveSOMemberInput
from bluewolf_core.models import ChangeKind, StateChange
from bluewolf_core.so_scoring import SOGroupScoringResult, score_so_template
from bluewolf_core.so_template_bank import SOConstellationSignature, SOTemplateBank
from bluewolf_core.so_template_fit import NoLegalSOTemplateAssignment
from bluewolf_core.so_template_selection import InvalidatedManualSelection

from .producer import DisplayedScoreValue


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("Core SO displayed-score timestamps require timezone-aware source time")
    return value.astimezone(UTC)


class CoreScoredSOEventRuntime(LiveSOEventRuntime):
    """Derive the event and published score from the SAME selected SO scoring pass."""

    def __init__(
        self,
        scorer: LiveSOGroupScorer,
        *,
        comparison_dimension: TemplateComparisonDimension,
        event_engine: EventAlertEngine | None = None,
        observation_sink: ObservationSink | None = None,
        lifecycle_sink: LifecycleSink | None = None,
    ) -> None:
        super().__init__(
            scorer,
            comparison_dimension=comparison_dimension,
            event_engine=event_engine,
            observation_sink=observation_sink,
            lifecycle_sink=lifecycle_sink,
        )
        self.display_window = CoreDisplayedScoreWindow()
        self._latest_display: dict[str, tuple[datetime, DisplayedScoreValue]] = {}

    def latest_displayed(self, group_id: str, observed_at: datetime) -> DisplayedScoreValue:
        previous = self._latest_display.get(group_id)
        if previous is None or previous[0] != _utc(observed_at):
            raise ValueError("no same-observation Core SO displayed score exists")
        return previous[1]

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
        if displayed_group_score is not None or displayed_score_valid:
            raise ValueError("Core SO mode rejects externally supplied displayed scores")
        if not members:
            raise ValueError("live SO runtime requires at least one member")
        timestamps = {_utc(item.sample.sample_time_utc) for item in members}
        server_ids = {item.sample.server_id for item in members}
        if len(timestamps) != 1 or len(server_ids) != 1:
            raise ValueError("live SO runtime requires one server and one common timestamp")
        self._latest_display.pop(group_id, None)

        # SINGLE stateful temporal metrics/scoring pass. All other template
        # comparisons below consume its immutable member observations.
        live = self.scorer.score_snapshot(
            group_id, constellation, members, reference_period_s=reference_period_s,
        )
        selection = live.selection
        context_key = build_so_event_context_key(
            constellation, members, active_template_id=selection.template_id,
        )
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
                        result = score_so_template(
                            template,
                            observations,
                            config=self.scorer.scoring_config,
                            minimum_valid_vehicles=self.scorer.minimum_valid_vehicles,
                        )
                    except NoLegalSOTemplateAssignment:
                        continue
                    scoring_by_template[template.template_id] = result
            for template_id, result in scoring_by_template.items():
                raw = _score_value(result.group_scores, self.comparison_dimension)
                if raw is not None:
                    comparison_scores[template_id] = raw

        now = next(iter(timestamps))
        server_id = next(iter(server_ids))
        actual_scores = (
            live.scoring.group_scores
            if live.scoring is not None and selection.template_id is not None else None
        )
        score, valid = self.display_window.observe(group_id, context_key, now, actual_scores)
        before = self.event_engine.snapshot(group_id)
        event = self.event_engine.observe(EventObservation(
            sample_time_utc=now,
            server_id=server_id,
            group_id=group_id,
            context_key=context_key,
            group_score=score if valid else None,
            score_valid=valid,
            active_template_id=selection.template_id,
            template_scores=comparison_scores,
        ))
        self._latest_display[group_id] = (now, DisplayedScoreValue(score, valid))
        context_changed = before is not None and before.event_id != event.snapshot.event_id
        if context_changed:
            finalize_at = now + timedelta(seconds=self.event_engine.config.event_finalize_seconds)
            self._emit_lifecycle(StateChange(
                change_time_utc=now,
                kind=ChangeKind.EVENT_ENDING,
                server_id=before.server_id,
                group_id=before.group_id,
                event_id=before.event_id,
                details={
                    "reason": "context_changed",
                    "finalize_at_utc": finalize_at.isoformat().replace("+00:00", "Z"),
                },
            ))
        opening_reason = "context_changed" if context_changed else (
            "group_became_active" if before is None else None
        )
        self._emit_engine_changes(event.changes, opening_reason=opening_reason)
        if (
            before is not None
            and before.event_id == event.snapshot.event_id
            and before.suggested_template_id is not None
            and event.snapshot.suggested_template_id is None
        ):
            self._emit_lifecycle(StateChange(
                change_time_utc=now,
                kind=ChangeKind.TEMPLATE_SUGGESTION_CLOSED,
                server_id=event.snapshot.server_id,
                group_id=event.snapshot.group_id,
                event_id=event.snapshot.event_id,
                details={
                    "suggested_template_id": before.suggested_template_id,
                    "reason": "advantage_below_close_threshold",
                },
            ))
        if self.observation_sink is not None:
            pending_reason: str | None = None
            if len(observations) != len(members):
                pending_reason = "core_observations_incomplete"
            elif selection.template_id is None:
                pending_reason = "active_template_unavailable"
            elif live.scoring is None:
                pending_reason = "core_scoring_not_ready"
            self.observation_sink(SOEventObservationFrame(
                event_id=event.snapshot.event_id,
                server_id=server_id,
                group_id=group_id,
                sample_time_utc=now,
                observations=observations,
                active_template_id=selection.template_id,
                pending_reason=pending_reason,
                navigation=_navigation_evidence(members),
                routes=_route_evidence(members),
            ))
        return LiveSOEventRuntimeResult(
            group_id=group_id,
            context_key=context_key,
            live_scoring=live,
            scoring_by_template=scoring_by_template,
            comparison_scores=comparison_scores,
            event=event,
        )

    def end_group(self, group_id: str, end_time_utc: datetime, *, reason: str = "group_inactive"):
        changes = super().end_group(group_id, end_time_utc, reason=reason)
        self.display_window.clear(group_id)
        self._latest_display.pop(group_id, None)
        return changes

    def export_state(self) -> dict[str, Any]:
        state = super().export_state()
        state["coreDisplayedScoreWindow"] = self.display_window.export_state()
        return state

    @classmethod
    def from_state(
        cls,
        bank: SOTemplateBank,
        state: Mapping[str, Any],
        *,
        scoring_config=None,
        event_config: EventAlertConfig | None = None,
        observation_sink: ObservationSink | None = None,
        lifecycle_sink: LifecycleSink | None = None,
    ) -> tuple["CoreScoredSOEventRuntime", tuple[InvalidatedManualSelection, ...]]:
        raw = state.get("coreDisplayedScoreWindow")
        if not isinstance(raw, Mapping):
            raise ValueError("core-scored SO checkpoint lacks the displayed-score window")
        restored, invalidated = super().from_state(
            bank,
            state,
            scoring_config=scoring_config,
            event_config=event_config,
            observation_sink=observation_sink,
            lifecycle_sink=lifecycle_sink,
        )
        if not isinstance(restored, cls):
            raise ValueError("Core SO checkpoint restored an incompatible runtime type")
        restored.display_window.restore_state(raw)
        return restored, invalidated


__all__ = ["CoreScoredSOEventRuntime"]
