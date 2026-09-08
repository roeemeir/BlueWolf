"""Stateful streaming shell and recoverable checkpoint for the core."""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Iterable, Mapping, Sequence

from .config import CoreConfig, DetectionConfig
from .geometry import project_wgs84, vector_angle_error_deg, wgs84_to_local_m
from .models import (
    CanonicalPoint,
    ChangeKind,
    ClosedRoute,
    CoreBatchResult,
    Direction,
    FieldQuality,
    RegionKind,
    RouteFamily,
    RouteRegion,
    RouteSubtype,
    RouteTopology,
    StateChange,
    VehicleFrameResult,
    VehicleSample,
)
from .partial_route_candidate import (
    PartialRouteEvidence,
    extract_partial_route_evidence,
    partial_candidate_ready,
)
from .route_change import (
    compare_routes,
    estimate_change_onset,
    replacement_evidence_supports_new_route,
    route_change_suspected,
)
from .route_detection import RouteDetection
from .vector_route_detection import detect_closed_route_vector


CHECKPOINT_SCHEMA_VERSION = 3
RESULT_SCHEMA_VERSION = 1


class CheckpointCompatibilityError(ValueError):
    """Raised when a checkpoint cannot safely restore this core session."""


@dataclass(slots=True)
class _VehicleRuntimeState:
    server_id: int
    vehicle_identifier: int
    last_sample_time_utc: datetime
    active: bool | None
    latitude_deg: float | None
    longitude_deg: float | None
    reliability: float
    no_data: bool = False
    expired: bool = False


@dataclass(slots=True)
class _RouteRuntimeState:
    history: list[VehicleSample] = field(default_factory=list)
    candidate_evidence: PartialRouteEvidence | None = None
    confirmed: ClosedRoute | None = None
    last_evaluation_time_utc: datetime | None = None


@dataclass(frozen=True, slots=True)
class _AdaptiveRouteMatch:
    detection: RouteDetection
    window_start_utc: datetime
    window_seconds: float


@dataclass(frozen=True, slots=True)
class _PartialCandidateMatch:
    evidence: PartialRouteEvidence
    window_start_utc: datetime
    window_seconds: float
    sample_count: int


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("time must be timezone-aware")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _config_fingerprint(config: CoreConfig) -> str:
    payload = json.dumps(config.to_dict(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class CoreSession:
    """Long-lived algorithm session with deterministic route lifecycle state."""

    def __init__(
        self,
        config: CoreConfig | None = None,
        algorithm_version: str = "0.5.0",
    ) -> None:
        self.config = config or CoreConfig()
        self.algorithm_version = algorithm_version
        self._states: dict[tuple[int, int], _VehicleRuntimeState] = {}
        self._routes: dict[tuple[int, int], _RouteRuntimeState] = {}
        self._processed_until_utc: datetime | None = None

    @property
    def processed_until_utc(self) -> datetime | None:
        return self._processed_until_utc

    def process_batch(
        self,
        samples: Iterable[VehicleSample],
        *,
        observed_until_utc: datetime | None = None,
    ) -> CoreBatchResult:
        ordered = sorted(
            samples,
            key=lambda item: (
                item.sample_time_utc,
                item.server_id,
                item.vehicle_identifier,
                item.vehicle_number,
            ),
        )
        changes: list[StateChange] = []
        frames: list[VehicleFrameResult] = []

        for sample in ordered:
            key = sample.stream_key
            current = self._states.get(key)
            if current is not None:
                if sample.sample_time_utc <= current.last_sample_time_utc:
                    # Query overlap is intentional. A changed historical value
                    # is applied by replaying from a checkpoint in a fresh session.
                    continue
                advance = self._advance_one(current, sample.sample_time_utc)
                changes.extend(advance)
                if any(item.kind is ChangeKind.VEHICLE_EXPIRED for item in advance):
                    self._routes.pop(key, None)
                if current.no_data:
                    changes.append(
                        StateChange(
                            sample.sample_time_utc,
                            ChangeKind.DATA_RESUMED,
                            sample.server_id,
                            sample.vehicle_identifier,
                        )
                    )
            else:
                current = _VehicleRuntimeState(
                    server_id=sample.server_id,
                    vehicle_identifier=sample.vehicle_identifier,
                    last_sample_time_utc=sample.sample_time_utc,
                    active=None,
                    latitude_deg=sample.latitude_deg,
                    longitude_deg=sample.longitude_deg,
                    reliability=sample.reliability,
                )
                self._states[key] = current

            previous_active = current.active
            if sample.active is True and previous_active is not True:
                changes.append(
                    StateChange(
                        sample.sample_time_utc,
                        ChangeKind.VEHICLE_ACTIVATED,
                        sample.server_id,
                        sample.vehicle_identifier,
                    )
                )
            elif sample.active is False and previous_active is True:
                changes.append(
                    StateChange(
                        sample.sample_time_utc,
                        ChangeKind.VEHICLE_DEACTIVATED,
                        sample.server_id,
                        sample.vehicle_identifier,
                    )
                )

            current.last_sample_time_utc = sample.sample_time_utc
            current.active = sample.active
            current.latitude_deg = sample.latitude_deg
            current.longitude_deg = sample.longitude_deg
            current.reliability = sample.reliability
            current.no_data = False
            current.expired = False

            changes.extend(self._update_route_state(sample))
            route_state = self._routes.get(key)
            confirmed = route_state.confirmed if route_state is not None else None
            route_id: str | None = None
            phase: float | None = None
            if (
                confirmed is not None
                and sample.active is not False
                and sample.latitude_deg is not None
                and sample.longitude_deg is not None
            ):
                route_id = confirmed.route_id
                phase = project_wgs84(
                    confirmed,
                    sample.latitude_deg,
                    sample.longitude_deg,
                ).phase

            frames.append(
                VehicleFrameResult(
                    sample_time_utc=sample.sample_time_utc,
                    server_id=sample.server_id,
                    vehicle_identifier=sample.vehicle_identifier,
                    active=sample.active,
                    latitude_deg=sample.latitude_deg,
                    longitude_deg=sample.longitude_deg,
                    reliability=sample.reliability,
                    route_id=route_id,
                    phase=phase,
                )
            )

        newest_sample = ordered[-1].sample_time_utc if ordered else None
        observed = _utc(observed_until_utc) if observed_until_utc is not None else newest_sample
        if observed is not None:
            if self._processed_until_utc is not None and observed < self._processed_until_utc:
                raise ValueError("observed_until_utc cannot move backwards")
            for key, state in self._states.items():
                advance = self._advance_one(state, observed)
                changes.extend(advance)
                if any(item.kind is ChangeKind.VEHICLE_EXPIRED for item in advance):
                    self._routes.pop(key, None)
            self._processed_until_utc = observed

        changes.sort(
            key=lambda item: (
                item.change_time_utc,
                item.server_id,
                item.vehicle_identifier if item.vehicle_identifier is not None else -1,
                item.kind.value,
            )
        )
        return CoreBatchResult(
            schema_version=RESULT_SCHEMA_VERSION,
            algorithm_version=self.algorithm_version,
            frames=tuple(frames),
            changes=tuple(changes),
            processed_until_utc=self._processed_until_utc,
        )

    def _update_route_state(self, sample: VehicleSample) -> list[StateChange]:
        key = sample.stream_key
        if sample.active is False:
            self._routes.pop(key, None)
            return []
        if sample.latitude_deg is None or sample.longitude_deg is None:
            return []

        route_state = self._routes.setdefault(key, _RouteRuntimeState())
        route_state.history.append(sample)
        cutoff = sample.sample_time_utc - timedelta(
            seconds=self.config.detection.max_history_seconds
        )
        if route_state.history and route_state.history[0].sample_time_utc < cutoff:
            route_state.history = [
                item for item in route_state.history if item.sample_time_utc >= cutoff
            ]

        last_eval = route_state.last_evaluation_time_utc
        if (
            last_eval is not None
            and (sample.sample_time_utc - last_eval).total_seconds()
            < self.config.timing.live_batch_seconds
        ):
            return []
        route_state.last_evaluation_time_utc = sample.sample_time_utc

        # Once a route is confirmed, acquisition never freezes. Stable motion
        # remains cheap; only a current mismatch opens the evidence-driven V2
        # replacement search.
        if route_state.confirmed is not None:
            if not route_change_suspected(
                sample,
                route_state.confirmed,
                self.config.detection,
            ):
                return []

            replacement = _find_adaptive_route(
                route_state.history,
                self.config.detection,
                require_confirmation=True,
            )
            if replacement is None:
                return []

            previous_route = route_state.confirmed
            next_route = replacement.detection.effective
            delta = compare_routes(previous_route, next_route, self.config.detection)
            if not delta.changed:
                return []

            if not replacement_evidence_supports_new_route(
                route_state.history,
                replacement.window_start_utc,
                previous_route,
                next_route,
                delta.reasons,
                self.config.detection,
            ):
                return []

            onset = estimate_change_onset(
                route_state.history,
                previous_route,
                next_route,
                replacement.window_start_utc,
                self.config.detection,
            )
            route_state.candidate_evidence = None
            route_state.confirmed = next_route
            return [
                self._route_change(
                    sample,
                    ChangeKind.ROUTE_CONFIRMED,
                    replacement,
                    change_time_utc=onset,
                    previous_route=previous_route,
                    change_reasons=delta.reasons,
                    change_metrics={
                        "center_short_axis_ratio": delta.center_short_axis_ratio,
                        "long_axis_ratio": delta.long_axis_ratio,
                        "short_axis_ratio": delta.short_axis_ratio,
                        "period_ratio": delta.period_ratio,
                        "orientation_error_deg": delta.orientation_error_deg,
                    },
                )
            ]

        changes: list[StateChange] = []
        if route_state.candidate_evidence is None:
            candidate = _find_partial_candidate(
                route_state.history,
                self.config.detection,
            )
            if candidate is not None:
                route_state.candidate_evidence = candidate.evidence
                changes.append(self._partial_candidate_change(sample, candidate))

        # The partial candidate is only permission to spend on recurrence and
        # topology inference. It does not supply a route identity itself.
        if route_state.candidate_evidence is None:
            return changes

        confirmed = _find_adaptive_route(
            route_state.history,
            self.config.detection,
            require_confirmation=True,
        )
        if confirmed is not None:
            route_state.candidate_evidence = None
            route_state.confirmed = confirmed.detection.effective
            changes.append(
                self._route_change(sample, ChangeKind.ROUTE_CONFIRMED, confirmed)
            )
        return changes

    def _partial_candidate_change(
        self,
        sample: VehicleSample,
        match: _PartialCandidateMatch,
    ) -> StateChange:
        evidence = match.evidence
        return StateChange(
            sample.sample_time_utc,
            ChangeKind.ROUTE_CANDIDATE,
            sample.server_id,
            sample.vehicle_identifier,
            details={
                "candidate_kind": "partial_route_evidence",
                "turn_fraction": evidence.turn_fraction,
                "smooth_heading_fraction": evidence.smooth_heading_fraction,
                "turn_sign_persistence": evidence.turn_sign_persistence,
                "path_efficiency": evidence.path_efficiency,
                "contiguous_observation_fraction": evidence.contiguous_observation_fraction,
                "observed_travel_m": evidence.observed_travel_m,
                "evidence_window_start_utc": _iso(match.window_start_utc),
                "evidence_window_seconds": match.window_seconds,
                "evidence_sample_count": match.sample_count,
                "history_ceiling_seconds": self.config.detection.max_history_seconds,
            },
        )

    def _route_change(
        self,
        sample: VehicleSample,
        kind: ChangeKind,
        match: _AdaptiveRouteMatch,
        *,
        change_time_utc: datetime | None = None,
        previous_route: ClosedRoute | None = None,
        change_reasons: Sequence[str] = (),
        change_metrics: Mapping[str, float] | None = None,
    ) -> StateChange:
        detection = match.detection
        route = detection.effective
        details: dict[str, Any] = {
            "route_id": route.route_id,
            "family": route.family.value,
            "subtype": route.subtype.value,
            "topology": route.topology.value,
            "direction": route.direction.value,
            "estimated_period_s": route.estimated_period_s,
            "long_axis_a_m": route.long_axis_a_m,
            "short_axis_b_m": route.short_axis_b_m,
            "orientation_deg": route.orientation_deg,
            "detection_quality": route.detection_quality,
            "fit_fraction": detection.fit_fraction,
            "coverage_fraction": detection.coverage_fraction,
            "completed_cycles": detection.completed_cycles,
            "closure_ok": bool(detection.diagnostics.get("closure_ok", False)),
            "detector": str(detection.diagnostics.get("detector", "unknown")),
            "evidence_window_start_utc": _iso(match.window_start_utc),
            "evidence_window_seconds": match.window_seconds,
            "history_ceiling_seconds": self.config.detection.max_history_seconds,
            "replacement": previous_route is not None,
        }
        if previous_route is not None:
            details.update(
                {
                    "previous_route_id": previous_route.route_id,
                    "previous_family": previous_route.family.value,
                    "previous_subtype": previous_route.subtype.value,
                    "previous_direction": previous_route.direction.value,
                    "previous_estimated_period_s": previous_route.estimated_period_s,
                    "previous_long_axis_a_m": previous_route.long_axis_a_m,
                    "previous_short_axis_b_m": previous_route.short_axis_b_m,
                    "previous_orientation_deg": previous_route.orientation_deg,
                    "change_reasons": list(change_reasons),
                    "detection_time_utc": _iso(sample.sample_time_utc),
                    "retroactive_onset": change_time_utc is not None
                    and change_time_utc < sample.sample_time_utc,
                }
            )
            if change_metrics:
                details["change_metrics"] = dict(change_metrics)

        return StateChange(
            change_time_utc or sample.sample_time_utc,
            kind,
            sample.server_id,
            sample.vehicle_identifier,
            details=details,
        )

    def _advance_one(
        self, state: _VehicleRuntimeState, observed_until: datetime
    ) -> list[StateChange]:
        changes: list[StateChange] = []
        no_data_at = state.last_sample_time_utc + timedelta(
            seconds=self.config.timing.no_data_display_seconds
        )
        expires_at = state.last_sample_time_utc + timedelta(
            seconds=self.config.grouping.membership_hold_seconds
        )
        if observed_until >= no_data_at and not state.no_data:
            state.no_data = True
            changes.append(
                StateChange(
                    no_data_at,
                    ChangeKind.DATA_LOST,
                    state.server_id,
                    state.vehicle_identifier,
                )
            )
        if observed_until >= expires_at and not state.expired:
            state.expired = True
            changes.append(
                StateChange(
                    expires_at,
                    ChangeKind.VEHICLE_EXPIRED,
                    state.server_id,
                    state.vehicle_identifier,
                )
            )
        return changes

    def export_checkpoint(self) -> bytes:
        """Return a deterministic, portable snapshot of the in-memory structs."""
        states = []
        for key in sorted(self._states):
            item = self._states[key]
            states.append(
                {
                    "server_id": item.server_id,
                    "vehicle_identifier": item.vehicle_identifier,
                    "last_sample_time_utc": _iso(item.last_sample_time_utc),
                    "active": item.active,
                    "latitude_deg": item.latitude_deg,
                    "longitude_deg": item.longitude_deg,
                    "reliability": item.reliability,
                    "no_data": item.no_data,
                    "expired": item.expired,
                }
            )

        routes = []
        for key in sorted(self._routes):
            item = self._routes[key]
            routes.append(
                {
                    "server_id": key[0],
                    "vehicle_identifier": key[1],
                    "last_evaluation_time_utc": (
                        _iso(item.last_evaluation_time_utc)
                        if item.last_evaluation_time_utc is not None
                        else None
                    ),
                    "candidate_evidence": (
                        _partial_evidence_to_dict(item.candidate_evidence)
                        if item.candidate_evidence is not None
                        else None
                    ),
                    "confirmed": (
                        _route_to_dict(item.confirmed)
                        if item.confirmed is not None
                        else None
                    ),
                    "history": [_sample_to_dict(sample) for sample in item.history],
                }
            )

        payload = {
            "checkpoint_schema_version": CHECKPOINT_SCHEMA_VERSION,
            "algorithm_version": self.algorithm_version,
            "configuration_fingerprint": _config_fingerprint(self.config),
            "processed_until_utc": (
                _iso(self._processed_until_utc)
                if self._processed_until_utc is not None
                else None
            ),
            "states": states,
            "routes": routes,
        }
        return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")

    @classmethod
    def from_checkpoint(
        cls,
        checkpoint: bytes | str,
        *,
        config: CoreConfig | None = None,
        algorithm_version: str = "0.5.0",
    ) -> CoreSession:
        config = config or CoreConfig()
        raw: Mapping[str, Any] = json.loads(
            checkpoint.decode("utf-8") if isinstance(checkpoint, bytes) else checkpoint
        )
        if raw.get("checkpoint_schema_version") != CHECKPOINT_SCHEMA_VERSION:
            raise CheckpointCompatibilityError("unsupported checkpoint schema")
        if raw.get("algorithm_version") != algorithm_version:
            raise CheckpointCompatibilityError("algorithm version does not match checkpoint")
        if raw.get("configuration_fingerprint") != _config_fingerprint(config):
            raise CheckpointCompatibilityError("configuration does not match checkpoint")

        session = cls(config=config, algorithm_version=algorithm_version)
        processed = raw.get("processed_until_utc")
        session._processed_until_utc = (
            _parse_time(processed) if isinstance(processed, str) else None
        )

        for value in raw.get("states", []):
            state = _VehicleRuntimeState(
                server_id=int(value["server_id"]),
                vehicle_identifier=int(value["vehicle_identifier"]),
                last_sample_time_utc=_parse_time(value["last_sample_time_utc"]),
                active=value.get("active"),
                latitude_deg=(
                    float(value["latitude_deg"])
                    if value.get("latitude_deg") is not None
                    else None
                ),
                longitude_deg=(
                    float(value["longitude_deg"])
                    if value.get("longitude_deg") is not None
                    else None
                ),
                reliability=float(value["reliability"]),
                no_data=bool(value.get("no_data", False)),
                expired=bool(value.get("expired", False)),
            )
            session._states[(state.server_id, state.vehicle_identifier)] = state

        for value in raw.get("routes", []):
            key = (int(value["server_id"]), int(value["vehicle_identifier"]))
            last_evaluation = value.get("last_evaluation_time_utc")
            candidate_raw = value.get("candidate_evidence")
            confirmed_raw = value.get("confirmed")
            session._routes[key] = _RouteRuntimeState(
                history=[_sample_from_dict(item) for item in value.get("history", [])],
                candidate_evidence=(
                    _partial_evidence_from_dict(candidate_raw)
                    if isinstance(candidate_raw, Mapping)
                    else None
                ),
                confirmed=(
                    _route_from_dict(confirmed_raw)
                    if isinstance(confirmed_raw, Mapping)
                    else None
                ),
                last_evaluation_time_utc=(
                    _parse_time(last_evaluation)
                    if isinstance(last_evaluation, str)
                    else None
                ),
            )
        return session

    def debug_state(self) -> dict[str, Any]:
        """Stable diagnostics for self/explainability tests; not an operator API."""
        routes = []
        for key in sorted(self._routes):
            item = self._routes[key]
            candidate = item.candidate_evidence
            routes.append(
                {
                    "server_id": key[0],
                    "vehicle_identifier": key[1],
                    "history_count": len(item.history),
                    "history_start_utc": (
                        _iso(item.history[0].sample_time_utc) if item.history else None
                    ),
                    "history_end_utc": (
                        _iso(item.history[-1].sample_time_utc) if item.history else None
                    ),
                    "candidate_active": candidate is not None,
                    "candidate_window_start_utc": (
                        _iso(candidate.window_start_utc) if candidate is not None else None
                    ),
                    "candidate_turn_fraction": (
                        candidate.turn_fraction if candidate is not None else None
                    ),
                    "confirmed_route_id": (
                        item.confirmed.route_id if item.confirmed is not None else None
                    ),
                    "last_evaluation_time_utc": (
                        _iso(item.last_evaluation_time_utc)
                        if item.last_evaluation_time_utc is not None
                        else None
                    ),
                }
            )
        return {
            "processed_until_utc": (
                _iso(self._processed_until_utc)
                if self._processed_until_utc is not None
                else None
            ),
            "vehicles": [asdict(self._states[key]) for key in sorted(self._states)],
            "routes": routes,
        }


def _find_partial_candidate(
    history: Sequence[VehicleSample],
    config: DetectionConfig,
) -> _PartialCandidateMatch | None:
    """Find a recent topology-neutral candidate by sample evidence, not time.

    Window sizes grow by sample count. This avoids translating the 1s/2s/5s
    navigation cadence into an implicit waiting timer while keeping free-motion
    evaluation bounded. The growth factor controls search cost/precision only.
    """

    if len(history) < 8:
        return None

    counts: list[int] = []
    current = min(8, len(history))
    while current < len(history):
        counts.append(current)
        current = min(
            len(history),
            max(current + 1, int(math.ceil(current * config.adaptive_window_growth_factor))),
        )
    if not counts or counts[-1] != len(history):
        counts.append(len(history))

    for count in counts:
        window = tuple(history[-count:])
        evidence = extract_partial_route_evidence(window)
        if evidence is None or not partial_candidate_ready(evidence, config):
            continue
        window_seconds = (
            window[-1].sample_time_utc - window[0].sample_time_utc
        ).total_seconds()
        return _PartialCandidateMatch(
            evidence=evidence,
            window_start_utc=window[0].sample_time_utc,
            window_seconds=window_seconds,
            sample_count=len(window),
        )
    return None


def _find_adaptive_route(
    history: Sequence[VehicleSample],
    config: DetectionConfig,
    *,
    require_confirmation: bool,
) -> _AdaptiveRouteMatch | None:
    """Return the shortest recent evidence window that satisfies V2 route gates.

    Confirmation first uses geometric re-observation: earlier samples nearest
    the current position (with compatible velocity heading when available) are
    candidate cycle boundaries. This finds the actual repeated path even when
    older free/approach motion exists in the 40-minute buffer.

    A bounded geometric suffix search remains as fallback. Its refinement
    resolution is search precision only, never a waiting timer.
    """
    if len(history) < 8:
        return None

    if require_confirmation:
        closure_matches: list[_AdaptiveRouteMatch] = []
        for duration in _closure_guided_durations(history, config):
            match = _detect_suffix(
                history,
                duration,
                config,
                require_confirmation=True,
            )
            if match is not None:
                closure_matches.append(match)
        if closure_matches:
            return min(closure_matches, key=lambda item: item.window_seconds)

    end_time = history[-1].sample_time_utc
    span_seconds = max(
        0.0,
        (end_time - history[0].sample_time_utc).total_seconds(),
    )
    if span_seconds <= 0:
        return None

    min_window = min(float(config.adaptive_min_window_seconds), span_seconds)
    durations: list[float] = []
    current = min_window
    while current < span_seconds:
        durations.append(current)
        next_window = current * config.adaptive_window_growth_factor
        current = max(current + 1.0, next_window)
    durations.append(span_seconds)

    previous_duration = 0.0
    first_match: _AdaptiveRouteMatch | None = None
    first_match_duration = 0.0
    for duration in durations:
        match = _detect_suffix(
            history,
            duration,
            config,
            require_confirmation=require_confirmation,
        )
        if match is not None:
            first_match = match
            first_match_duration = duration
            break
        previous_duration = duration

    if first_match is None:
        return None

    lower = previous_duration
    upper = first_match_duration
    best = first_match
    resolution = float(config.adaptive_window_refine_seconds)
    while upper - lower > resolution:
        middle = (lower + upper) / 2.0
        match = _detect_suffix(
            history,
            middle,
            config,
            require_confirmation=require_confirmation,
        )
        if match is None:
            lower = middle
        else:
            upper = middle
            best = match
    return best


def _closure_guided_durations(
    history: Sequence[VehicleSample],
    config: DetectionConfig,
) -> tuple[float, ...]:
    """Propose cycle windows from spatial/heading re-observation.

    No fixed spatial threshold is used here: nearest historical revisits are
    merely hypotheses. The route detector's fitted short axis, closure ratio,
    fit and coverage gates make the actual decision.
    """
    current = history[-1]
    if current.latitude_deg is None or current.longitude_deg is None:
        return ()

    current_velocity = _sample_velocity(current)
    candidates: list[tuple[float, float]] = []
    minimum_duration = float(config.adaptive_min_window_seconds)
    for previous in history[:-1]:
        if previous.latitude_deg is None or previous.longitude_deg is None:
            continue
        duration = (current.sample_time_utc - previous.sample_time_utc).total_seconds()
        if duration < minimum_duration:
            continue

        previous_velocity = _sample_velocity(previous)
        if current_velocity is not None and previous_velocity is not None:
            heading_error = vector_angle_error_deg(
                current_velocity[0],
                current_velocity[1],
                previous_velocity[0],
                previous_velocity[1],
            )
            if heading_error > max(60.0, config.closure_direction_error_deg * 2.0):
                continue

        local = wgs84_to_local_m(
            float(previous.latitude_deg),
            float(previous.longitude_deg),
            float(current.latitude_deg),
            float(current.longitude_deg),
        )
        candidates.append((math.hypot(local.x_m, local.y_m), duration))

    selected: list[float] = []
    separation = max(10.0, float(config.adaptive_window_refine_seconds))
    for _, duration in sorted(candidates, key=lambda item: (item[0], item[1])):
        if any(abs(duration - known) < separation for known in selected):
            continue
        selected.append(duration)
        if len(selected) >= 16:
            break
    return tuple(sorted(selected))


def _sample_velocity(sample: VehicleSample) -> tuple[float, float] | None:
    if sample.velocity_east_mps is None or sample.velocity_north_mps is None:
        return None
    east = float(sample.velocity_east_mps)
    north = float(sample.velocity_north_mps)
    if math.hypot(east, north) <= 1e-9:
        return None
    return east, north


def _detect_suffix(
    history: Sequence[VehicleSample],
    duration_seconds: float,
    config: DetectionConfig,
    *,
    require_confirmation: bool,
) -> _AdaptiveRouteMatch | None:
    end_time = history[-1].sample_time_utc
    cutoff = end_time - timedelta(seconds=max(duration_seconds, 0.0))
    window = tuple(sample for sample in history if sample.sample_time_utc >= cutoff)
    if len(window) < 8:
        return None
    detection = detect_closed_route_vector(
        window,
        config,
        require_confirmation=require_confirmation,
    )
    if detection is None:
        return None
    window_seconds = (
        window[-1].sample_time_utc - window[0].sample_time_utc
    ).total_seconds()
    return _AdaptiveRouteMatch(
        detection=detection,
        window_start_utc=window[0].sample_time_utc,
        window_seconds=window_seconds,
    )


def _partial_evidence_to_dict(evidence: PartialRouteEvidence) -> dict[str, Any]:
    return {
        "stream_key": [evidence.stream_key[0], evidence.stream_key[1]],
        "window_start_utc": _iso(evidence.window_start_utc),
        "window_end_utc": _iso(evidence.window_end_utc),
        "source_sample_count": evidence.source_sample_count,
        "observed_grid_count": evidence.observed_grid_count,
        "observed_travel_m": evidence.observed_travel_m,
        "turn_fraction": evidence.turn_fraction,
        "smooth_heading_fraction": evidence.smooth_heading_fraction,
        "turn_sign_persistence": evidence.turn_sign_persistence,
        "path_efficiency": evidence.path_efficiency,
        "contiguous_observation_fraction": evidence.contiguous_observation_fraction,
        "observed_runs": [
            [{"x_m": point.x_m, "y_m": point.y_m} for point in run]
            for run in evidence.observed_runs
        ],
    }


def _partial_evidence_from_dict(value: Mapping[str, Any]) -> PartialRouteEvidence:
    stream_key = list(value.get("stream_key", (0, 0)))
    if len(stream_key) != 2:
        raise CheckpointCompatibilityError("invalid partial candidate stream key")
    return PartialRouteEvidence(
        stream_key=(int(stream_key[0]), int(stream_key[1])),
        window_start_utc=_parse_time(str(value["window_start_utc"])),
        window_end_utc=_parse_time(str(value["window_end_utc"])),
        source_sample_count=int(value["source_sample_count"]),
        observed_grid_count=int(value["observed_grid_count"]),
        observed_travel_m=float(value["observed_travel_m"]),
        turn_fraction=float(value["turn_fraction"]),
        smooth_heading_fraction=float(value["smooth_heading_fraction"]),
        turn_sign_persistence=float(value["turn_sign_persistence"]),
        path_efficiency=float(value["path_efficiency"]),
        contiguous_observation_fraction=float(value["contiguous_observation_fraction"]),
        observed_runs=tuple(
            tuple(
                CanonicalPoint(float(point["x_m"]), float(point["y_m"]))
                for point in run
            )
            for run in value.get("observed_runs", [])
        ),
    )


def _sample_to_dict(sample: VehicleSample) -> dict[str, Any]:
    return {
        "sample_time_utc": _iso(sample.sample_time_utc),
        "server_id": sample.server_id,
        "vehicle_number": sample.vehicle_number,
        "vehicle_identifier": sample.vehicle_identifier,
        "active": sample.active,
        "latitude_deg": sample.latitude_deg,
        "longitude_deg": sample.longitude_deg,
        "altitude_m": sample.altitude_m,
        "velocity_north_mps": sample.velocity_north_mps,
        "velocity_east_mps": sample.velocity_east_mps,
        "reliability": sample.reliability,
        "field_quality": {
            key: value.value for key, value in sorted(sample.field_quality.items())
        },
    }


def _sample_from_dict(value: Mapping[str, Any]) -> VehicleSample:
    return VehicleSample(
        sample_time_utc=_parse_time(str(value["sample_time_utc"])),
        server_id=int(value["server_id"]),
        vehicle_number=int(value["vehicle_number"]),
        vehicle_identifier=int(value["vehicle_identifier"]),
        active=value.get("active"),
        latitude_deg=(
            float(value["latitude_deg"])
            if value.get("latitude_deg") is not None
            else None
        ),
        longitude_deg=(
            float(value["longitude_deg"])
            if value.get("longitude_deg") is not None
            else None
        ),
        altitude_m=(
            float(value["altitude_m"])
            if value.get("altitude_m") is not None
            else None
        ),
        velocity_north_mps=(
            float(value["velocity_north_mps"])
            if value.get("velocity_north_mps") is not None
            else None
        ),
        velocity_east_mps=(
            float(value["velocity_east_mps"])
            if value.get("velocity_east_mps") is not None
            else None
        ),
        reliability=float(value.get("reliability", 1.0)),
        field_quality={
            str(key): FieldQuality(str(item))
            for key, item in dict(value.get("field_quality", {})).items()
        },
    )


def _route_to_dict(route: ClosedRoute) -> dict[str, Any]:
    return {
        "route_id": route.route_id,
        "family": route.family.value,
        "subtype": route.subtype.value,
        "topology": route.topology.value,
        "canonical_points": [
            {"x_m": point.x_m, "y_m": point.y_m}
            for point in route.canonical_points
        ],
        "center_latitude_deg": route.center_latitude_deg,
        "center_longitude_deg": route.center_longitude_deg,
        "length_m": route.length_m,
        "long_axis_a_m": route.long_axis_a_m,
        "short_axis_b_m": route.short_axis_b_m,
        "orientation_deg": route.orientation_deg,
        "estimated_period_s": route.estimated_period_s,
        "direction": route.direction.value,
        "detection_quality": route.detection_quality,
        "regions": [
            {
                "kind": region.kind.value,
                "start_phase": region.start_phase,
                "end_phase": region.end_phase,
                "label": region.label,
            }
            for region in route.regions
        ],
    }


def _route_from_dict(value: Mapping[str, Any]) -> ClosedRoute:
    return ClosedRoute(
        route_id=str(value["route_id"]),
        family=RouteFamily(str(value["family"])),
        subtype=RouteSubtype(str(value["subtype"])),
        topology=RouteTopology(str(value["topology"])),
        canonical_points=tuple(
            CanonicalPoint(float(point["x_m"]), float(point["y_m"]))
            for point in value.get("canonical_points", [])
        ),
        center_latitude_deg=float(value["center_latitude_deg"]),
        center_longitude_deg=float(value["center_longitude_deg"]),
        length_m=float(value["length_m"]),
        long_axis_a_m=float(value["long_axis_a_m"]),
        short_axis_b_m=float(value["short_axis_b_m"]),
        orientation_deg=float(value["orientation_deg"]),
        estimated_period_s=float(value["estimated_period_s"]),
        direction=Direction(str(value["direction"])),
        detection_quality=float(value["detection_quality"]),
        regions=tuple(
            RouteRegion(
                RegionKind(str(region["kind"])),
                float(region["start_phase"]),
                float(region["end_phase"]),
                str(region.get("label", "")),
            )
            for region in value.get("regions", [])
        ),
    )
