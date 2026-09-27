"""Event-scoped low-score alerts and SO template recommendations.

Conformance sources:
- core/docs/V1_SPEC_HE.md sections 7, 8 and 11.
- core/docs/TEMPLATE_SELECTION_LIFECYCLE_HE.md.

This module deliberately does not alter route detection, structural grouping or
active template selection. The caller supplies an event context token that
changes whenever the upstream route/group/synchronization context changes. A
new token opens a new event; elapsed time is used only where V1 explicitly
defines temporal alert/recommendation hysteresis.

Template comparison scores are supplied by the scoring layer. They must all
use the same score dimension; this engine never computes a synchronization
score and never auto-selects a recommended template.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
import math
from types import MappingProxyType
from typing import Any, Mapping

from .config import CoreConfig
from .models import ChangeKind, StateChange


@dataclass(frozen=True, slots=True)
class EventAlertConfig:
    low_score_below: float = 50.0
    low_score_seconds: float = 10.0
    recovery_score: float = 60.0
    recovery_seconds: float = 20.0
    recommendation_open_advantage: float = 30.0
    recommendation_open_seconds: float = 120.0
    recommendation_close_advantage: float = 15.0
    recommendation_close_seconds: float = 30.0
    event_finalize_seconds: float = 120.0

    def __post_init__(self) -> None:
        values = (
            self.low_score_below,
            self.low_score_seconds,
            self.recovery_score,
            self.recovery_seconds,
            self.recommendation_open_advantage,
            self.recommendation_open_seconds,
            self.recommendation_close_advantage,
            self.recommendation_close_seconds,
            self.event_finalize_seconds,
        )
        if any(not math.isfinite(float(value)) for value in values):
            raise ValueError("event/alert configuration must be finite")
        if not 0.0 <= self.low_score_below <= 100.0:
            raise ValueError("low_score_below must be in [0, 100]")
        if not 0.0 <= self.recovery_score <= 100.0:
            raise ValueError("recovery_score must be in [0, 100]")
        if self.recovery_score < self.low_score_below:
            raise ValueError("recovery_score cannot be below low_score_below")
        if min(
            self.low_score_seconds,
            self.recovery_seconds,
            self.recommendation_open_seconds,
            self.recommendation_close_seconds,
            self.event_finalize_seconds,
        ) <= 0.0:
            raise ValueError("event/alert durations must be positive")
        if self.recommendation_open_advantage <= self.recommendation_close_advantage:
            raise ValueError(
                "recommendation open advantage must exceed close advantage"
            )
        if self.recommendation_close_advantage < 0.0:
            raise ValueError("recommendation close advantage must be non-negative")

    @classmethod
    def from_core_config(cls, config: CoreConfig) -> "EventAlertConfig":
        return cls(
            low_score_below=float(config.scoring.low_score_below),
            low_score_seconds=float(config.scoring.alert_open_seconds),
            recovery_score=float(config.scoring.alert_recovery_score),
            recovery_seconds=float(config.scoring.alert_recovery_seconds),
            event_finalize_seconds=float(config.timing.event_finalize_seconds),
        )


@dataclass(frozen=True, slots=True)
class EventObservation:
    sample_time_utc: datetime
    server_id: int
    group_id: str
    context_key: str
    group_score: float | None
    score_valid: bool
    active_template_id: str | None = None
    template_scores: Mapping[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "sample_time_utc", _utc(self.sample_time_utc))
        if not self.group_id:
            raise ValueError("group_id is required")
        if not self.context_key:
            raise ValueError("context_key is required")
        if self.active_template_id == "":
            raise ValueError("active_template_id must be non-empty when supplied")
        if self.group_score is not None:
            _validate_score("group_score", self.group_score)
        normalized: dict[str, float] = {}
        for template_id, score in self.template_scores.items():
            if not template_id:
                raise ValueError("template score ids must be non-empty")
            _validate_score(f"template_scores[{template_id!r}]", score)
            normalized[str(template_id)] = float(score)
        object.__setattr__(self, "template_scores", MappingProxyType(normalized))


@dataclass(frozen=True, slots=True)
class EventAlertSnapshot:
    event_id: str
    server_id: int
    group_id: str
    context_key: str
    event_start_utc: datetime
    active_template_id: str | None
    low_score_alert_active: bool
    suggested_template_id: str | None
    rejected_template_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class EventAlertResult:
    snapshot: EventAlertSnapshot
    changes: tuple[StateChange, ...]


@dataclass(slots=True)
class _ActiveEventState:
    event_id: str
    server_id: int
    group_id: str
    context_key: str
    event_start_utc: datetime
    active_template_id: str | None
    last_observation_utc: datetime
    low_start_utc: datetime | None = None
    low_alert_active: bool = False
    recovery_start_utc: datetime | None = None
    recommendation_candidate_id: str | None = None
    recommendation_candidate_start_utc: datetime | None = None
    suggested_template_id: str | None = None
    suggestion_close_start_utc: datetime | None = None
    rejected_template_ids: set[str] = field(default_factory=set)


@dataclass(slots=True)
class _EndedEventState:
    event_id: str
    server_id: int
    group_id: str
    context_key: str
    event_start_utc: datetime
    event_end_utc: datetime
    finalize_at_utc: datetime
    reason: str


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("time must be timezone-aware")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _parse_time(value: object) -> datetime:
    return _utc(datetime.fromisoformat(str(value).replace("Z", "+00:00")))


def _validate_score(name: str, value: float) -> None:
    numeric = float(value)
    if not math.isfinite(numeric) or not 0.0 <= numeric <= 100.0:
        raise ValueError(f"{name} must be finite and in [0, 100]")


def _elapsed(now: datetime, start: datetime | None) -> float:
    return 0.0 if start is None else (now - start).total_seconds()


def _event_id(group_id: str, start: datetime) -> str:
    return f"{group_id}@{_iso(start)}"


class EventAlertEngine:
    """Deterministic event, low-score alert and recommendation lifecycle.

    ``context_key`` is an upstream semantic token (for example a stable digest
    of group membership + confirmed routes + selected synchronization
    configuration). The engine does not infer that token from score, so score
    degradation can never split a structural group or route event by itself.
    """

    def __init__(self, config: EventAlertConfig | None = None) -> None:
        self.config = config or EventAlertConfig()
        self._active_by_group: dict[str, _ActiveEventState] = {}
        self._ended: dict[str, _EndedEventState] = {}

    def observe(self, observation: EventObservation) -> EventAlertResult:
        now = observation.sample_time_utc
        changes = list(self.advance(now))
        state = self._active_by_group.get(observation.group_id)
        signature_changed = (
            state is not None
            and (
                state.server_id != observation.server_id
                or state.context_key != observation.context_key
                or state.active_template_id != observation.active_template_id
            )
        )
        if signature_changed:
            changes.extend(self._end_state(state, now, reason="context_changed"))
            state = None

        if state is None:
            state = _ActiveEventState(
                event_id=_event_id(observation.group_id, now),
                server_id=observation.server_id,
                group_id=observation.group_id,
                context_key=observation.context_key,
                event_start_utc=now,
                active_template_id=observation.active_template_id,
                last_observation_utc=now,
            )
            self._active_by_group[observation.group_id] = state
            changes.append(
                StateChange(
                    change_time_utc=now,
                    kind=ChangeKind.EVENT_OPENED,
                    server_id=observation.server_id,
                    group_id=observation.group_id,
                    event_id=state.event_id,
                    details={
                        "context_key": observation.context_key,
                        "active_template_id": observation.active_template_id or "",
                    },
                )
            )
        elif now <= state.last_observation_utc:
            raise ValueError("event observations must be strictly time-ordered per group")

        state.last_observation_utc = now
        changes.extend(self._update_low_score_alert(state, observation))
        changes.extend(self._update_template_recommendation(state, observation))
        return EventAlertResult(self._snapshot(state), tuple(changes))

    def end_group(
        self,
        group_id: str,
        end_time_utc: datetime,
        *,
        reason: str = "group_inactive",
    ) -> tuple[StateChange, ...]:
        if not group_id:
            raise ValueError("group_id is required")
        if not reason:
            raise ValueError("reason is required")
        now = _utc(end_time_utc)
        changes = list(self.advance(now))
        state = self._active_by_group.get(group_id)
        if state is None:
            return tuple(changes)
        if now < state.last_observation_utc:
            raise ValueError("event end cannot precede last observation")
        changes.extend(self._end_state(state, now, reason=reason))
        return tuple(changes)

    def reject_suggestion(
        self,
        group_id: str,
        rejected_at_utc: datetime,
    ) -> EventAlertSnapshot:
        state = self._active_by_group.get(group_id)
        if state is None:
            raise ValueError("group has no active event")
        when = _utc(rejected_at_utc)
        if when < state.last_observation_utc:
            raise ValueError("rejection cannot precede last observation")
        if state.suggested_template_id is None:
            raise ValueError("group has no active template suggestion")
        state.rejected_template_ids.add(state.suggested_template_id)
        state.suggested_template_id = None
        state.suggestion_close_start_utc = None
        state.recommendation_candidate_id = None
        state.recommendation_candidate_start_utc = None
        return self._snapshot(state)

    def snapshot(self, group_id: str) -> EventAlertSnapshot | None:
        state = self._active_by_group.get(group_id)
        return None if state is None else self._snapshot(state)

    def advance(self, observed_until_utc: datetime) -> tuple[StateChange, ...]:
        now = _utc(observed_until_utc)
        changes: list[StateChange] = []
        ready = sorted(
            (state for state in self._ended.values() if state.finalize_at_utc <= now),
            key=lambda state: (state.finalize_at_utc, state.event_id),
        )
        for state in ready:
            changes.append(
                StateChange(
                    change_time_utc=state.event_end_utc,
                    kind=ChangeKind.EVENT_CLOSED,
                    server_id=state.server_id,
                    group_id=state.group_id,
                    event_id=state.event_id,
                    details={
                        "context_key": state.context_key,
                        "reason": state.reason,
                        "finalized_time_utc": _iso(state.finalize_at_utc),
                    },
                )
            )
            self._ended.pop(state.event_id, None)
        return tuple(changes)

    def _end_state(
        self,
        state: _ActiveEventState,
        end_time_utc: datetime,
        *,
        reason: str,
    ) -> tuple[StateChange, ...]:
        changes: list[StateChange] = []
        if state.low_alert_active:
            changes.append(
                StateChange(
                    change_time_utc=end_time_utc,
                    kind=ChangeKind.ALERT_CLOSED,
                    server_id=state.server_id,
                    group_id=state.group_id,
                    event_id=state.event_id,
                    details={"alert_type": "low_score", "reason": "event_ended"},
                )
            )
        finalize_at = datetime.fromtimestamp(
            end_time_utc.timestamp() + self.config.event_finalize_seconds,
            tz=UTC,
        )
        self._ended[state.event_id] = _EndedEventState(
            event_id=state.event_id,
            server_id=state.server_id,
            group_id=state.group_id,
            context_key=state.context_key,
            event_start_utc=state.event_start_utc,
            event_end_utc=end_time_utc,
            finalize_at_utc=finalize_at,
            reason=reason,
        )
        self._active_by_group.pop(state.group_id, None)
        return tuple(changes)

    def _update_low_score_alert(
        self,
        state: _ActiveEventState,
        observation: EventObservation,
    ) -> tuple[StateChange, ...]:
        now = observation.sample_time_utc
        if not observation.score_valid or observation.group_score is None:
            if not state.low_alert_active:
                state.low_start_utc = None
            state.recovery_start_utc = None
            return ()

        score = float(observation.group_score)
        if not state.low_alert_active:
            state.recovery_start_utc = None
            if score < self.config.low_score_below:
                if state.low_start_utc is None:
                    state.low_start_utc = now
                if _elapsed(now, state.low_start_utc) >= self.config.low_score_seconds:
                    onset = state.low_start_utc
                    state.low_alert_active = True
                    state.low_start_utc = None
                    return (
                        StateChange(
                            change_time_utc=now,
                            kind=ChangeKind.ALERT_OPENED,
                            server_id=state.server_id,
                            group_id=state.group_id,
                            event_id=state.event_id,
                            details={
                                "alert_type": "low_score",
                                "score": score,
                                "threshold": self.config.low_score_below,
                                "onset_time_utc": _iso(onset),
                            },
                        ),
                    )
            else:
                state.low_start_utc = None
            return ()

        if score >= self.config.recovery_score:
            if state.recovery_start_utc is None:
                state.recovery_start_utc = now
            if _elapsed(now, state.recovery_start_utc) >= self.config.recovery_seconds:
                recovery = state.recovery_start_utc
                state.low_alert_active = False
                state.recovery_start_utc = None
                return (
                    StateChange(
                        change_time_utc=now,
                        kind=ChangeKind.ALERT_CLOSED,
                        server_id=state.server_id,
                        group_id=state.group_id,
                        event_id=state.event_id,
                        details={
                            "alert_type": "low_score",
                            "score": score,
                            "recovery_threshold": self.config.recovery_score,
                            "recovery_start_utc": _iso(recovery),
                        },
                    ),
                )
        else:
            state.recovery_start_utc = None
        return ()

    def _update_template_recommendation(
        self,
        state: _ActiveEventState,
        observation: EventObservation,
    ) -> tuple[StateChange, ...]:
        now = observation.sample_time_utc
        active_id = state.active_template_id
        scores = observation.template_scores
        if not observation.score_valid or active_id is None or active_id not in scores:
            if state.suggested_template_id is None:
                state.recommendation_candidate_id = None
                state.recommendation_candidate_start_utc = None
            state.suggestion_close_start_utc = None
            return ()

        active_score = scores[active_id]
        if state.suggested_template_id is not None:
            suggested_id = state.suggested_template_id
            suggested_score = scores.get(suggested_id)
            if suggested_score is None:
                state.suggestion_close_start_utc = None
                return ()
            advantage = suggested_score - active_score
            if advantage < self.config.recommendation_close_advantage:
                if state.suggestion_close_start_utc is None:
                    state.suggestion_close_start_utc = now
                if (
                    _elapsed(now, state.suggestion_close_start_utc)
                    >= self.config.recommendation_close_seconds
                ):
                    state.suggested_template_id = None
                    state.suggestion_close_start_utc = None
                    state.recommendation_candidate_id = None
                    state.recommendation_candidate_start_utc = None
            else:
                state.suggestion_close_start_utc = None
            return ()

        candidates = [
            (score, template_id)
            for template_id, score in scores.items()
            if template_id != active_id and template_id not in state.rejected_template_ids
        ]
        if not candidates:
            state.recommendation_candidate_id = None
            state.recommendation_candidate_start_utc = None
            return ()
        best_score, best_id = max(candidates, key=lambda item: (item[0], item[1]))
        advantage = best_score - active_score
        if advantage < self.config.recommendation_open_advantage:
            state.recommendation_candidate_id = None
            state.recommendation_candidate_start_utc = None
            return ()

        if state.recommendation_candidate_id != best_id:
            state.recommendation_candidate_id = best_id
            state.recommendation_candidate_start_utc = now
            return ()
        if state.recommendation_candidate_start_utc is None:
            state.recommendation_candidate_start_utc = now
            return ()
        if (
            _elapsed(now, state.recommendation_candidate_start_utc)
            < self.config.recommendation_open_seconds
        ):
            return ()

        streak_start = state.recommendation_candidate_start_utc
        state.suggested_template_id = best_id
        state.suggestion_close_start_utc = None
        state.recommendation_candidate_id = None
        state.recommendation_candidate_start_utc = None
        return (
            StateChange(
                change_time_utc=now,
                kind=ChangeKind.TEMPLATE_SUGGESTED,
                server_id=state.server_id,
                group_id=state.group_id,
                event_id=state.event_id,
                details={
                    "active_template_id": active_id,
                    "suggested_template_id": best_id,
                    "active_score": active_score,
                    "suggested_score": best_score,
                    "advantage": advantage,
                    "evidence_start_utc": _iso(streak_start),
                },
            ),
        )

    @staticmethod
    def _snapshot(state: _ActiveEventState) -> EventAlertSnapshot:
        return EventAlertSnapshot(
            event_id=state.event_id,
            server_id=state.server_id,
            group_id=state.group_id,
            context_key=state.context_key,
            event_start_utc=state.event_start_utc,
            active_template_id=state.active_template_id,
            low_score_alert_active=state.low_alert_active,
            suggested_template_id=state.suggested_template_id,
            rejected_template_ids=tuple(sorted(state.rejected_template_ids)),
        )

    def export_state(self) -> dict[str, Any]:
        active = []
        for group_id, state in sorted(self._active_by_group.items()):
            if group_id != state.group_id:
                raise AssertionError("event registry key/state mismatch")
            active.append(
                {
                    "event_id": state.event_id,
                    "server_id": state.server_id,
                    "group_id": state.group_id,
                    "context_key": state.context_key,
                    "event_start_utc": _iso(state.event_start_utc),
                    "active_template_id": state.active_template_id,
                    "last_observation_utc": _iso(state.last_observation_utc),
                    "low_start_utc": None if state.low_start_utc is None else _iso(state.low_start_utc),
                    "low_alert_active": state.low_alert_active,
                    "recovery_start_utc": None if state.recovery_start_utc is None else _iso(state.recovery_start_utc),
                    "recommendation_candidate_id": state.recommendation_candidate_id,
                    "recommendation_candidate_start_utc": None if state.recommendation_candidate_start_utc is None else _iso(state.recommendation_candidate_start_utc),
                    "suggested_template_id": state.suggested_template_id,
                    "suggestion_close_start_utc": None if state.suggestion_close_start_utc is None else _iso(state.suggestion_close_start_utc),
                    "rejected_template_ids": sorted(state.rejected_template_ids),
                }
            )
        ended = []
        for event_id, state in sorted(self._ended.items()):
            if event_id != state.event_id:
                raise AssertionError("ended event registry key/state mismatch")
            ended.append(
                {
                    "event_id": state.event_id,
                    "server_id": state.server_id,
                    "group_id": state.group_id,
                    "context_key": state.context_key,
                    "event_start_utc": _iso(state.event_start_utc),
                    "event_end_utc": _iso(state.event_end_utc),
                    "finalize_at_utc": _iso(state.finalize_at_utc),
                    "reason": state.reason,
                }
            )
        return {"active_events": active, "ended_events": ended}

    @classmethod
    def from_state(
        cls,
        state: Mapping[str, Any],
        *,
        config: EventAlertConfig | None = None,
    ) -> "EventAlertEngine":
        engine = cls(config=config)
        raw_active = state.get("active_events", [])
        raw_ended = state.get("ended_events", [])
        if not isinstance(raw_active, list) or not isinstance(raw_ended, list):
            raise ValueError("event alert state lists are malformed")
        for raw in raw_active:
            if not isinstance(raw, Mapping):
                raise ValueError("active event state must be an object")
            group_id = str(raw.get("group_id", ""))
            if not group_id or group_id in engine._active_by_group:
                raise ValueError("active event group ids must be non-empty and unique")
            rejected = raw.get("rejected_template_ids", [])
            if not isinstance(rejected, list):
                raise ValueError("rejected_template_ids must be a list")
            event = _ActiveEventState(
                event_id=str(raw.get("event_id", "")),
                server_id=int(raw.get("server_id")),
                group_id=group_id,
                context_key=str(raw.get("context_key", "")),
                event_start_utc=_parse_time(raw.get("event_start_utc")),
                active_template_id=(None if raw.get("active_template_id") is None else str(raw.get("active_template_id"))),
                last_observation_utc=_parse_time(raw.get("last_observation_utc")),
                low_start_utc=(None if raw.get("low_start_utc") is None else _parse_time(raw.get("low_start_utc"))),
                low_alert_active=bool(raw.get("low_alert_active", False)),
                recovery_start_utc=(None if raw.get("recovery_start_utc") is None else _parse_time(raw.get("recovery_start_utc"))),
                recommendation_candidate_id=(None if raw.get("recommendation_candidate_id") is None else str(raw.get("recommendation_candidate_id"))),
                recommendation_candidate_start_utc=(None if raw.get("recommendation_candidate_start_utc") is None else _parse_time(raw.get("recommendation_candidate_start_utc"))),
                suggested_template_id=(None if raw.get("suggested_template_id") is None else str(raw.get("suggested_template_id"))),
                suggestion_close_start_utc=(None if raw.get("suggestion_close_start_utc") is None else _parse_time(raw.get("suggestion_close_start_utc"))),
                rejected_template_ids={str(item) for item in rejected},
            )
            if not event.event_id or not event.context_key:
                raise ValueError("restored event id/context are required")
            engine._active_by_group[group_id] = event
        for raw in raw_ended:
            if not isinstance(raw, Mapping):
                raise ValueError("ended event state must be an object")
            event_id = str(raw.get("event_id", ""))
            if not event_id or event_id in engine._ended:
                raise ValueError("ended event ids must be non-empty and unique")
            engine._ended[event_id] = _EndedEventState(
                event_id=event_id,
                server_id=int(raw.get("server_id")),
                group_id=str(raw.get("group_id", "")),
                context_key=str(raw.get("context_key", "")),
                event_start_utc=_parse_time(raw.get("event_start_utc")),
                event_end_utc=_parse_time(raw.get("event_end_utc")),
                finalize_at_utc=_parse_time(raw.get("finalize_at_utc")),
                reason=str(raw.get("reason", "")),
            )
        return engine
