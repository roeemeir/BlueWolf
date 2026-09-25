"""Explicit SI-only Core score bridge; never feed guessed scores to event/Web.

The selected SI scorer advances exactly once for each live observation. Its
actual valid GroupScores.total is smoothed exclusively for display and low-score
alerts; alternative-template comparisons remain raw. The existing invalid mode
and SO production path remain unchanged until separately accepted.
"""
from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
import math
from typing import Any

from bluewolf_core.core_display_score import CoreDisplayedScoreWindow
from bluewolf_core.event_alert import EventAlertEngine, EventAlertConfig, EventObservation
from bluewolf_core.live_si_runtime import (
    LiveSIRuntime,
    LiveSIEventRuntimeResult,
    SIObservationSink,
    SILifecycleSink,
    _context_key,
    _navigation_evidence,
    _route_evidence,
    _score_value,
    _scoring_inputs,
)
from bluewolf_core.event_recompute import SIEventObservationFrame
from bluewolf_core.live_si_scoring import LiveSIMemberInput
from bluewolf_core.models import ChangeKind, RouteFamily, StateChange
from bluewolf_core.si_scoring import score_si_template
from bluewolf_core.templates import NoLegalTemplateAssignment, SynchronizationTemplate
from bluewolf_core.config import ScoringConfig

from .contract import LIVE_RUNTIME_SCHEMA_VERSION
from .ingest_coordinator import IngestPollResult
from .producer import DisplayedScoreValue, RuntimePublicationResult
from .service import RuntimeSnapshotStore
from .si_contract import build_si_live_runtime_snapshot
from .si_producer import LiveSIRuntimeProducer, _detected_route_payload, _utc
from bluewolf_core.si_ring_roles import AmbiguousSIRingAssignment, NoLegalSIRingAssignment


class CoreScoredSIRuntime(LiveSIRuntime):
    """Reuse the real selected scorer exactly once and publish its same-tick value."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.display_window = CoreDisplayedScoreWindow()
        self._latest_display: dict[str, tuple[datetime, DisplayedScoreValue]] = {}

    def latest_displayed(self, group_id: str, timestamp: datetime) -> DisplayedScoreValue:
        latest = self._latest_display.get(group_id)
        if latest is None or latest[0] != _utc(timestamp):
            raise ValueError("no same-observation Core displayed score is available")
        return latest[1]

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
        if displayed_score_valid or displayed_group_score is not None:
            raise ValueError("Core SI mode rejects externally supplied displayed scores")
        if not members:
            raise ValueError("live SI runtime requires at least one member")
        timestamps = {item.sample.sample_time_utc for item in members}
        server_ids = {item.sample.server_id for item in members}
        if len(timestamps) != 1 or len(server_ids) != 1:
            raise ValueError("live SI runtime requires one server and one common timestamp")
        self._latest_display.pop(group_id, None)

        # This is the SINGLE temporal scoring pass; never call it again to
        # obtain a group score for the contract, history or event engine.
        live = self.scorer(group_id, template).score_group(
            group_id, members, reference_period_s=reference_period_s,
        )
        inputs = _scoring_inputs(members, live)
        scoring_by_template = {}
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
                        minimum_valid_vehicles=self.minimum_valid_vehicles,
                    )
                except NoLegalTemplateAssignment:
                    continue
        for candidate_id, result in scoring_by_template.items():
            raw = _score_value(result.group_scores, self.comparison_dimension)
            if raw is not None:
                comparison_scores[candidate_id] = raw

        now = next(iter(timestamps)).astimezone(UTC)
        server_id = next(iter(server_ids))
        context_key = _context_key(members, active_template_id=template.template_id)
        actual_scores = live.scoring.group_scores if live.scoring is not None else None
        score, valid = self.display_window.observe(group_id, context_key, now, actual_scores)
        displayed = DisplayedScoreValue(score, valid)
        before = self.event_engine.snapshot(group_id)
        event = self.event_engine.observe(
            EventObservation(
                sample_time_utc=now,
                server_id=server_id,
                group_id=group_id,
                context_key=context_key,
                group_score=score if valid else None,
                score_valid=valid,
                active_template_id=template.template_id,
                template_scores=comparison_scores,
            )
        )
        self._latest_display[group_id] = (now, displayed)

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
            self.observation_sink(SIEventObservationFrame(
                event_id=event.snapshot.event_id,
                server_id=server_id,
                group_id=group_id,
                sample_time_utc=now,
                observations=inputs,
                active_template_id=template.template_id,
                pending_reason=live.pending_reason if not inputs else None,
                navigation=_navigation_evidence(members),
                routes=_route_evidence(members),
            ))
        return LiveSIEventRuntimeResult(
            group_id=group_id,
            context_key=context_key,
            live_scoring=live,
            scoring_by_template=scoring_by_template,
            comparison_scores=comparison_scores,
            event=event,
        )

    def remove_group(self, group_id: str) -> None:
        super().remove_group(group_id)
        self.display_window.clear(group_id)
        self._latest_display.pop(group_id, None)

    def export_state(self) -> dict[str, object]:
        state = super().export_state()
        state["coreDisplayedScoreWindow"] = self.display_window.export_state()
        return state

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
    ) -> "CoreScoredSIRuntime":
        restored = super().from_state(
            templates,
            state,
            scoring_config=scoring_config,
            event_config=event_config,
            observation_sink=observation_sink,
            lifecycle_sink=lifecycle_sink,
        )
        raw_window = state.get("coreDisplayedScoreWindow")
        if not isinstance(raw_window, Mapping):
            raise ValueError("core-scored SI checkpoint lacks displayed-score window")
        restored.display_window.restore_state(raw_window)
        return restored


class CoreScoredSIRuntimeProducer(LiveSIRuntimeProducer):
    """Publish only scores actually produced by the matching SI runtime tick."""

    def publish_poll(self, poll: IngestPollResult) -> RuntimePublicationResult:
        if any(sample.server_id != self.server_id for sample in poll.samples):
            raise ValueError("poll contains samples from a different server")
        grouping = self.session.grouping_snapshot()
        active_groups = tuple(
            group for group in grouping.groups
            if group.server_id == self.server_id and group.family is RouteFamily.SI
        )
        active_ids = {group.group_id for group in active_groups}
        for ended in sorted(self._structurally_active_groups - active_ids):
            self.runtime.end_group(ended, poll.window.end_time_utc, reason="structural_group_ended")
        self._structurally_active_groups = active_ids
        self.runtime.advance_events(poll.window.end_time_utc)
        sample_index = self._sample_index(poll.samples, self.server_id)
        payloads: list[tuple[str, datetime, dict[str, object]]] = []
        skipped: dict[str, str] = {}
        for group in sorted(active_groups, key=lambda item: item.group_id):
            try:
                assignment, profiles, routes = self._resolve_group(group)
            except (NoLegalSIRingAssignment, AmbiguousSIRingAssignment) as exc:
                skipped[group.group_id] = str(exc)
                continue
            selected = self._frames_for_group(poll.core_result.frames, group)
            if selected is None:
                skipped[group.group_id] = "no_complete_common_timestamp"
                continue
            observed_at, frames = selected
            members = self._member_inputs(
                group, assignment, profiles, routes, observed_at, frames, sample_index,
            )
            if members is None:
                skipped[group.group_id] = "runtime_member_evidence_incomplete_or_route_mismatch"
                continue
            runtime_result = self.runtime.process_snapshot(
                group.group_id,
                assignment.template,
                members,
                reference_period_s=group.base_period_s,
                displayed_group_score=None,
                displayed_score_valid=False,
            )
            # Read the result of the already-committed SAME scoring pass.
            displayed = self.runtime.latest_displayed(group.group_id, observed_at)
            result = runtime_result.live_scoring
            one = build_si_live_runtime_snapshot(
                result,
                members,
                server_id=self.server_id,
                observed_at_utc=observed_at,
                arena=self.arena,
                displayed_score=displayed,
                vehicle_ids={member.member_id: int(member.member_id) for member in members},
                color=self.color,
            )
            payload = one["groups"]["si"]
            payload["detectedRoutes"] = _detected_route_payload(members)
            if runtime_result.event is not None:
                event = runtime_result.event.snapshot
                payload["event"] = {
                    "id": event.event_id,
                    "contextKey": event.context_key,
                    "startedAt": event.event_start_utc.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                    "active": True,
                }
                if event.low_score_alert_active:
                    payload["alert"] = {
                        "id": f"{event.event_id}:low-score",
                        "title": "ציון קבוצה נמוך",
                        "detail": "הציון המוצג נמצא מתחת לסף ההתראה למשך הזמן הנדרש.",
                        "severity": "warning",
                    }
                if event.suggested_template_id and event.active_template_id:
                    suggested_score = runtime_result.comparison_scores.get(event.suggested_template_id)
                    active_score = runtime_result.comparison_scores.get(event.active_template_id)
                    if suggested_score is not None and active_score is not None:
                        payload["recommendation"] = {
                            "templateId": event.suggested_template_id,
                            "activeTemplateId": event.active_template_id,
                            "dimension": self.runtime.comparison_dimension,
                            "improvementPoints": float(suggested_score - active_score),
                            "ready": True,
                        }
            payloads.append((group.group_id, _utc(observed_at), payload))
        if not payloads:
            return RuntimePublicationResult(None, (), skipped)
        payloads.sort(key=lambda item: item[0])
        observed_at = max(item[1] for item in payloads)
        groups = [item[2] for item in payloads]
        vehicle_count = sum(len(group.get("members", [])) for group in groups)
        snapshot: dict[str, object] = {
            "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
            "serverId": str(self.server_id),
            "arena": self.arena,
            "status": f"{len(groups)} קבוצות SI · {vehicle_count} רכבים",
            "observedAt": observed_at.isoformat().replace("+00:00", "Z"),
            "source": {
                "kind": "python-core",
                "health": "healthy",
                "detail": f"CoreScoredSIRuntimeProducer · {len(groups)} SI groups · real selected-template score",
            },
            "groups": {"si": groups[0]},
            "groupList": groups,
        }
        self.store.publish(snapshot)
        return RuntimePublicationResult(
            __import__("types").MappingProxyType(snapshot),
            tuple(item[0] for item in payloads),
            skipped,
        )


__all__ = ["CoreScoredSIRuntime", "CoreScoredSIRuntimeProducer"]
