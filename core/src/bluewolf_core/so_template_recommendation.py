"""Event-scoped recommendation lifecycle for alternative SO templates.

Source of truth: ``core/docs/TEMPLATE_SELECTION_LIFECYCLE_HE.md``.

The engine never changes the active template. It only opens/closes a suggestion
when externally supplied, valid score evidence satisfies the approved margins:

- open: same alternative is >=30 points better for 120 consecutive seconds;
- close: an open suggestion stays <15 points better for 30 consecutive seconds;
- rejection suppresses that alternative until the current event ends.

Score calculation and template legality remain owned by the already validated
SO scoring and template-bank layers. This module consumes scores only.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
import math
from typing import Any, Mapping

from .so_template_bank import SOConstellationRoute, SOConstellationSignature
from .so_templates import SORouteKind


@dataclass(frozen=True, slots=True)
class TemplateRecommendationConfig:
    open_advantage_points: float = 30.0
    open_evidence_seconds: float = 120.0
    close_advantage_points: float = 15.0
    close_evidence_seconds: float = 30.0

    def __post_init__(self) -> None:
        values = (
            self.open_advantage_points,
            self.open_evidence_seconds,
            self.close_advantage_points,
            self.close_evidence_seconds,
        )
        if not all(math.isfinite(value) and value >= 0.0 for value in values):
            raise ValueError("recommendation thresholds must be finite and non-negative")
        if self.close_advantage_points >= self.open_advantage_points:
            raise ValueError("close advantage must be lower than open advantage")
        if self.open_evidence_seconds <= 0.0 or self.close_evidence_seconds <= 0.0:
            raise ValueError("recommendation evidence durations must be positive")


class TemplateRecommendationTransitionKind(StrEnum):
    SUGGESTED = "suggested"
    CLOSED = "closed"
    REJECTED = "rejected"


@dataclass(frozen=True, slots=True)
class TemplateRecommendationTransition:
    time_utc: datetime
    event_id: str
    group_id: str
    template_id: str
    kind: TemplateRecommendationTransitionKind
    reason: str
    advantage_points: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "time_utc", _utc(self.time_utc))
        if not self.event_id or not self.group_id or not self.template_id or not self.reason:
            raise ValueError("recommendation transition fields must be non-empty")
        if self.advantage_points is not None and not math.isfinite(self.advantage_points):
            raise ValueError("advantage_points must be finite when supplied")


@dataclass(frozen=True, slots=True)
class TemplateRecommendationSnapshot:
    event_id: str
    group_id: str
    constellation: SOConstellationSignature
    active_template_id: str
    suggested_template_id: str | None
    suggested_advantage_points: float | None
    pending_template_id: str | None
    pending_since_utc: datetime | None
    close_since_utc: datetime | None
    suppressed_template_ids: tuple[str, ...]


@dataclass(slots=True)
class _RecommendationState:
    active_template_id: str
    pending_template_id: str | None = None
    pending_since_utc: datetime | None = None
    suggested_template_id: str | None = None
    suggested_advantage_points: float | None = None
    close_since_utc: datetime | None = None
    suppressed_template_ids: set[str] = field(default_factory=set)
    last_observation_utc: datetime | None = None


RecommendationKey = tuple[
    str,
    str,
    tuple[tuple[str, tuple[str, ...]], ...],
]


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("recommendation timestamps must be timezone-aware")
    return value.astimezone(UTC)


def _key(
    event_id: str,
    group_id: str,
    constellation: SOConstellationSignature,
) -> RecommendationKey:
    if not event_id or not group_id:
        raise ValueError("event_id and group_id are required")
    return event_id, group_id, constellation.key


def _signature_from_key(
    key: tuple[tuple[str, tuple[str, ...]], ...],
) -> SOConstellationSignature:
    return SOConstellationSignature(
        tuple(
            SOConstellationRoute(
                route_kind=SORouteKind(route_kind),
                vehicle_types=tuple(vehicle_types),
            )
            for route_kind, vehicle_types in key
        )
    )


def _valid_score(value: float | None) -> float | None:
    if value is None:
        return None
    score = float(value)
    if not math.isfinite(score) or not 0.0 <= score <= 100.0:
        raise ValueError("template scores must be finite and in [0,100]")
    return score


class TemplateRecommendationEngine:
    """Deterministic, event-scoped recommendation evidence state."""

    def __init__(self, config: TemplateRecommendationConfig | None = None) -> None:
        self.config = config or TemplateRecommendationConfig()
        self._states: dict[RecommendationKey, _RecommendationState] = {}

    def observe(
        self,
        *,
        time_utc: datetime,
        event_id: str,
        group_id: str,
        constellation: SOConstellationSignature,
        active_template_id: str,
        template_scores: Mapping[str, float | None],
        evidence_valid: bool = True,
    ) -> tuple[TemplateRecommendationSnapshot, tuple[TemplateRecommendationTransition, ...]]:
        now = _utc(time_utc)
        if not active_template_id:
            raise ValueError("active_template_id is required")
        key = _key(event_id, group_id, constellation)
        state = self._states.get(key)
        if state is None:
            state = _RecommendationState(active_template_id=active_template_id)
            self._states[key] = state
        elif state.active_template_id != active_template_id:
            # A manual/default change is an external selection action, not a
            # recommendation transition. Evidence against the old active
            # template is no longer relevant and must restart.
            state.active_template_id = active_template_id
            state.pending_template_id = None
            state.pending_since_utc = None
            state.suggested_template_id = None
            state.suggested_advantage_points = None
            state.close_since_utc = None

        if state.last_observation_utc is not None and now <= state.last_observation_utc:
            raise ValueError("recommendation observations must be strictly time-ordered")
        state.last_observation_utc = now

        transitions: list[TemplateRecommendationTransition] = []
        scores = {template_id: _valid_score(score) for template_id, score in template_scores.items()}
        active_score = scores.get(active_template_id)
        valid = bool(evidence_valid and active_score is not None)

        if state.suggested_template_id is not None:
            suggested_id = state.suggested_template_id
            suggested_score = scores.get(suggested_id)
            if not valid or suggested_score is None:
                # Missing/invalid evidence interrupts a *continuous* close
                # interval but does not close the visible suggestion by itself.
                state.close_since_utc = None
                state.suggested_advantage_points = None
            else:
                advantage = suggested_score - float(active_score)
                state.suggested_advantage_points = advantage
                if advantage < self.config.close_advantage_points:
                    if state.close_since_utc is None:
                        state.close_since_utc = now
                    elif (
                        now - state.close_since_utc
                    ).total_seconds() >= self.config.close_evidence_seconds:
                        transitions.append(
                            TemplateRecommendationTransition(
                                now,
                                event_id,
                                group_id,
                                suggested_id,
                                TemplateRecommendationTransitionKind.CLOSED,
                                "advantage_below_close_threshold",
                                advantage,
                            )
                        )
                        state.suggested_template_id = None
                        state.suggested_advantage_points = None
                        state.close_since_utc = None
                else:
                    state.close_since_utc = None

            # While a suggestion is visible we deliberately do not replace it
            # with another candidate. Recommendation never auto-switches.
            state.pending_template_id = None
            state.pending_since_utc = None
            return self._snapshot(key, state), tuple(transitions)

        if not valid:
            state.pending_template_id = None
            state.pending_since_utc = None
            return self._snapshot(key, state), ()

        candidates: list[tuple[float, str]] = []
        for template_id, score in scores.items():
            if (
                template_id == active_template_id
                or template_id in state.suppressed_template_ids
                or score is None
            ):
                continue
            candidates.append((score - float(active_score), template_id))
        candidates.sort(key=lambda row: (-row[0], row[1]))

        if not candidates or candidates[0][0] < self.config.open_advantage_points:
            state.pending_template_id = None
            state.pending_since_utc = None
            return self._snapshot(key, state), ()

        advantage, candidate_id = candidates[0]
        if state.pending_template_id != candidate_id:
            state.pending_template_id = candidate_id
            state.pending_since_utc = now
            return self._snapshot(key, state), ()

        assert state.pending_since_utc is not None
        if (now - state.pending_since_utc).total_seconds() >= self.config.open_evidence_seconds:
            state.suggested_template_id = candidate_id
            state.suggested_advantage_points = advantage
            state.pending_template_id = None
            state.pending_since_utc = None
            state.close_since_utc = None
            transition = TemplateRecommendationTransition(
                now,
                event_id,
                group_id,
                candidate_id,
                TemplateRecommendationTransitionKind.SUGGESTED,
                "advantage_sustained",
                advantage,
            )
            transitions.append(transition)
        return self._snapshot(key, state), tuple(transitions)

    def reject(
        self,
        *,
        time_utc: datetime,
        event_id: str,
        group_id: str,
        constellation: SOConstellationSignature,
    ) -> TemplateRecommendationTransition:
        now = _utc(time_utc)
        key = _key(event_id, group_id, constellation)
        state = self._states.get(key)
        if state is None or state.suggested_template_id is None:
            raise ValueError("there is no active recommendation to reject")
        template_id = state.suggested_template_id
        advantage = state.suggested_advantage_points
        state.suppressed_template_ids.add(template_id)
        state.suggested_template_id = None
        state.suggested_advantage_points = None
        state.close_since_utc = None
        state.pending_template_id = None
        state.pending_since_utc = None
        return TemplateRecommendationTransition(
            now,
            event_id,
            group_id,
            template_id,
            TemplateRecommendationTransitionKind.REJECTED,
            "operator_rejected_until_event_end",
            advantage,
        )

    def end_event(self, event_id: str) -> None:
        if not event_id:
            raise ValueError("event_id is required")
        self._states = {
            key: state for key, state in self._states.items() if key[0] != event_id
        }

    def snapshot(
        self,
        *,
        event_id: str,
        group_id: str,
        constellation: SOConstellationSignature,
    ) -> TemplateRecommendationSnapshot | None:
        key = _key(event_id, group_id, constellation)
        state = self._states.get(key)
        return None if state is None else self._snapshot(key, state)

    def _snapshot(
        self,
        key: RecommendationKey,
        state: _RecommendationState,
    ) -> TemplateRecommendationSnapshot:
        event_id, group_id, signature_key = key
        return TemplateRecommendationSnapshot(
            event_id=event_id,
            group_id=group_id,
            constellation=_signature_from_key(signature_key),
            active_template_id=state.active_template_id,
            suggested_template_id=state.suggested_template_id,
            suggested_advantage_points=state.suggested_advantage_points,
            pending_template_id=state.pending_template_id,
            pending_since_utc=state.pending_since_utc,
            close_since_utc=state.close_since_utc,
            suppressed_template_ids=tuple(sorted(state.suppressed_template_ids)),
        )

    def export_state(self) -> dict[str, Any]:
        rows = []
        for key, state in sorted(self._states.items()):
            event_id, group_id, signature_key = key
            rows.append(
                {
                    "event_id": event_id,
                    "group_id": group_id,
                    "constellation": {
                        "routes": [
                            {
                                "route_kind": route_kind,
                                "vehicle_types": list(vehicle_types),
                            }
                            for route_kind, vehicle_types in signature_key
                        ]
                    },
                    "active_template_id": state.active_template_id,
                    "pending_template_id": state.pending_template_id,
                    "pending_since_utc": (
                        None if state.pending_since_utc is None else state.pending_since_utc.isoformat()
                    ),
                    "suggested_template_id": state.suggested_template_id,
                    "suggested_advantage_points": state.suggested_advantage_points,
                    "close_since_utc": (
                        None if state.close_since_utc is None else state.close_since_utc.isoformat()
                    ),
                    "suppressed_template_ids": sorted(state.suppressed_template_ids),
                    "last_observation_utc": (
                        None if state.last_observation_utc is None else state.last_observation_utc.isoformat()
                    ),
                }
            )
        return {"config": self.config.__dict__, "states": rows}

    @classmethod
    def from_state(cls, raw: Mapping[str, Any]) -> "TemplateRecommendationEngine":
        config_raw = raw.get("config", {})
        if not isinstance(config_raw, Mapping):
            raise ValueError("recommendation config state must be an object")
        engine = cls(TemplateRecommendationConfig(**dict(config_raw)))
        rows = raw.get("states", [])
        if not isinstance(rows, list):
            raise ValueError("recommendation states must be a list")
        for row in rows:
            if not isinstance(row, Mapping):
                raise ValueError("recommendation state row must be an object")
            constellation_raw = row.get("constellation")
            if not isinstance(constellation_raw, Mapping):
                raise ValueError("recommendation constellation must be an object")
            routes_raw = constellation_raw.get("routes")
            if not isinstance(routes_raw, list) or not routes_raw:
                raise ValueError("recommendation constellation routes must be a non-empty list")
            routes = []
            for route in routes_raw:
                if not isinstance(route, Mapping):
                    raise ValueError("recommendation route must be an object")
                vehicle_types = route.get("vehicle_types")
                if not isinstance(vehicle_types, list) or not vehicle_types:
                    raise ValueError("recommendation vehicle_types must be a non-empty list")
                routes.append(
                    SOConstellationRoute(
                        route_kind=SORouteKind(str(route["route_kind"])),
                        vehicle_types=tuple(str(value) for value in vehicle_types),
                    )
                )
            constellation = SOConstellationSignature(tuple(routes))
            event_id = str(row.get("event_id", ""))
            group_id = str(row.get("group_id", ""))
            key = _key(event_id, group_id, constellation)
            if key in engine._states:
                raise ValueError("duplicate recommendation state key")
            active_template_id = str(row.get("active_template_id", ""))
            if not active_template_id:
                raise ValueError("active_template_id is required in persisted state")
            def parse_time(name: str) -> datetime | None:
                value = row.get(name)
                if value is None:
                    return None
                return _utc(datetime.fromisoformat(str(value)))
            suppressed = row.get("suppressed_template_ids", [])
            if not isinstance(suppressed, list):
                raise ValueError("suppressed_template_ids must be a list")
            advantage_raw = row.get("suggested_advantage_points")
            advantage = None if advantage_raw is None else float(advantage_raw)
            if advantage is not None and not math.isfinite(advantage):
                raise ValueError("persisted suggested advantage must be finite")
            engine._states[key] = _RecommendationState(
                active_template_id=active_template_id,
                pending_template_id=(
                    None if row.get("pending_template_id") is None else str(row.get("pending_template_id"))
                ),
                pending_since_utc=parse_time("pending_since_utc"),
                suggested_template_id=(
                    None if row.get("suggested_template_id") is None else str(row.get("suggested_template_id"))
                ),
                suggested_advantage_points=advantage,
                close_since_utc=parse_time("close_since_utc"),
                suppressed_template_ids={str(value) for value in suppressed},
                last_observation_utc=parse_time("last_observation_utc"),
            )
        return engine
