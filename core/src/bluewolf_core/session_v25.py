"""Blue Wolf CoreSession v2.5: fast detection + latest-cycle active fitting.

Forty minutes of NAV remain in memory/recovery for evidence and period context.
They are not averaged into every operational route fit. Initial detection starts
as soon as a complete closed cycle satisfies the existing structural gates. Once
a candidate exists, every five-second evaluation refits from the latest cycle.

The initial candidate is confirmed after the existing known-route stability
interval, rather than waiting for an unrelated fixed five-minute observation.
Confirmed geometry is continuously refreshed from the latest cycle while the
Route ID stays stable. Material changes still require the existing 120-second
revision confirmation.

A route-period change needs one extra mechanism: the old period cannot always
slice a complete cycle of the new route. Therefore current-state fitting remains
strictly latest-cycle based, while change discovery uses a bounded generic suffix
probe. The probe is shape-neutral and expands only in time; once a changed route
is found, its own period becomes the latest-cycle reference for revision checks.

`route_state.confirmed` is the current active latest-cycle geometry. After route
confirmation, `route_state.candidate` is intentionally retained as the fixed
revision baseline. This prevents a real slow geometry drift from disappearing
because the active fit follows it in many individually sub-threshold steps.

Clean Live startup also separates memory from computation: recent suffixes are
used to reconstruct current state, then the full retained 40-minute NAV window is
hydrated as route-history evidence without replaying every historical sample
through every lifecycle transition.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Iterable

from . import session as _legacy
from .cycle_window_v25 import latest_cycle_vehicle_samples
from .models import ChangeKind, ClosedRoute, StateChange, VehicleSample
from .route_detection import RouteDetection, detect_closed_route
from .session_v23 import CoreSession as _V23CoreSession, ROUTE_HISTORY_SECONDS


class CoreSession(_V23CoreSession):
    """Canonical streaming session using the last completed cycle for active fit."""

    def _recent_closed_detection(
        self,
        history: list[VehicleSample],
        reference_time: datetime,
    ) -> RouteDetection | None:
        """Return the first valid closed route found in recent expanding suffixes.

        Window expansion is purely temporal and bounded by retained evidence; no
        route-shape assumption is used. The detector still enforces closure, fit
        quality and completed-cycle evidence.
        """
        if len(history) < 12:
            return None
        available = max(0.0, (history[-1].sample_time_utc - history[0].sample_time_utc).total_seconds())
        if available <= 0:
            return None
        maximum = min(float(ROUTE_HISTORY_SECONDS), available)
        window = min(maximum, max(1.0, float(self.config.detection.known_route_candidate_seconds)))
        windows: list[float] = []
        while window < maximum:
            windows.append(window)
            window = min(maximum, window * 2.0)
        windows.append(maximum)

        probe_config = replace(self.config.detection, new_route_observation_seconds=0)
        seen: set[int] = set()
        for seconds in windows:
            rounded = max(1, int(round(seconds)))
            if rounded in seen:
                continue
            seen.add(rounded)
            recent = _legacy._samples_since(history, reference_time, float(rounded))
            detection = detect_closed_route(recent, probe_config)
            if detection is not None:
                return detection
        return None

    def _latest_cycle_detection(
        self,
        route_state,
        reference: ClosedRoute,
    ) -> RouteDetection | None:
        cycle = latest_cycle_vehicle_samples(
            route_state.history,
            reference.estimated_period_s,
        )
        if not cycle:
            return None
        cycle_config = replace(
            self.config.detection,
            # Closure + completed-cycle gates still apply. Do not impose an
            # additional wall-clock minimum once a period/reference exists.
            new_route_observation_seconds=0,
        )
        return detect_closed_route(cycle, cycle_config)

    def bootstrap_from_history(
        self,
        samples: Iterable[VehicleSample],
        *,
        observed_until_utc: datetime | None = None,
    ):
        """Reconstruct current state cheaply while retaining up to 40m evidence.

        Each stream is first inspected by the generic detector using expanding
        recent suffixes. If a period is found, only roughly two cycles plus the
        existing candidate-stability interval are replayed through the lifecycle.
        The full bounded NAV window is hydrated afterwards as evidence. If no
        closed route is discoverable, only a short recent suffix is replayed to
        establish current vehicle/data state; the full history is still retained.
        """
        ordered = sorted(
            samples,
            key=lambda item: (
                item.sample_time_utc,
                item.server_id,
                item.vehicle_identifier,
                item.vehicle_number,
            ),
        )
        if not ordered:
            return self.process_batch((), observed_until_utc=observed_until_utc)

        by_key: dict[tuple[int, int], list[VehicleSample]] = {}
        for sample in ordered:
            by_key.setdefault(sample.stream_key, []).append(sample)

        replay: list[VehicleSample] = []
        for stream in by_key.values():
            latest = stream[-1].sample_time_utc
            detection = self._recent_closed_detection(stream, latest)
            if detection is not None:
                replay_seconds = max(
                    2.0 * max(detection.effective.estimated_period_s, 1.0)
                    + float(self.config.detection.known_route_candidate_seconds),
                    2.0 * float(self.config.detection.known_route_candidate_seconds),
                )
            else:
                replay_seconds = 2.0 * float(self.config.detection.known_route_candidate_seconds)
            replay.extend(_legacy._samples_since(stream, latest, min(float(ROUTE_HISTORY_SECONDS), replay_seconds)))

        replay.sort(
            key=lambda item: (
                item.sample_time_utc,
                item.server_id,
                item.vehicle_identifier,
                item.vehicle_number,
            )
        )
        result = self.process_batch(replay, observed_until_utc=observed_until_utc)
        self.hydrate_recovery_history(ordered)
        return result

    def _generic_change_probe(
        self,
        sample: VehicleSample,
        route_state,
        baseline: ClosedRoute,
    ) -> RouteDetection | None:
        """Find a changed closed route without assuming its new period or shape."""
        history = route_state.history
        if len(history) < 12:
            return None
        available_seconds = max(
            0.0,
            (history[-1].sample_time_utc - history[0].sample_time_utc).total_seconds(),
        )
        if available_seconds <= 0:
            return None

        # Two baseline cycles are a natural first probe: one current-period slice
        # is already used by the active fit, while a second cycle gives a changed
        # period room to close without imposing a geometric model. The 180-second
        # floor reuses existing revision/candidate timing, not a new route law.
        base_seconds = max(
            2.0 * max(baseline.estimated_period_s, 1.0),
            float(_legacy._ROUTE_REVISION_CONFIRM_SECONDS + self.config.detection.known_route_candidate_seconds),
        )
        maximum = min(float(ROUTE_HISTORY_SECONDS), available_seconds)
        window = min(base_seconds, maximum)
        windows: list[float] = []
        while window < maximum:
            windows.append(window)
            window = min(maximum, window * 2.0)
        windows.append(maximum)

        probe_config = replace(self.config.detection, new_route_observation_seconds=0)
        seen: set[int] = set()
        for seconds in windows:
            rounded = max(1, int(round(seconds)))
            if rounded in seen:
                continue
            seen.add(rounded)
            recent = _legacy._samples_since(history, sample.sample_time_utc, float(rounded))
            detection = detect_closed_route(recent, probe_config)
            if detection is None:
                continue
            if _legacy._material_route_change(baseline, detection.effective):
                return detection
        return None

    def _update_initial_route(self, sample: VehicleSample, route_state) -> list[StateChange]:
        changes: list[StateChange] = []

        # Before a reference exists, search recent suffixes generically rather than
        # re-fitting the entire 40-minute buffer every five seconds.
        if route_state.candidate is None:
            candidate_detection = self._recent_closed_detection(route_state.history, sample.sample_time_utc)
            if candidate_detection is None:
                return changes
            route_state.candidate = candidate_detection.effective
            route_state.candidate_since_utc = sample.sample_time_utc
            changes.append(
                self._route_change(
                    sample,
                    ChangeKind.ROUTE_CANDIDATE,
                    candidate_detection,
                    revision=route_state.revision,
                )
            )
            return changes

        latest_detection = self._latest_cycle_detection(route_state, route_state.candidate)
        if latest_detection is None:
            return changes
        latest = latest_detection.effective

        # Candidate stability is structural, not just elapsed time. A materially
        # different latest cycle restarts the existing candidate stability clock.
        if _legacy._material_route_change(route_state.candidate, latest):
            route_state.candidate = latest
            route_state.candidate_since_utc = sample.sample_time_utc
            return changes

        route_state.candidate = latest
        since = route_state.candidate_since_utc or sample.sample_time_utc
        stable_seconds = (sample.sample_time_utc - since).total_seconds()
        if stable_seconds < self.config.detection.known_route_candidate_seconds:
            return changes

        confirmed = replace(latest, route_id=f"{latest.route_id}:r0")
        route_state.confirmed = confirmed
        route_state.candidate = confirmed
        route_state.pending_revision = None
        route_state.pending_since_utc = None
        changes.append(
            self._route_change(
                sample,
                ChangeKind.ROUTE_CONFIRMED,
                latest_detection,
                route_override=confirmed,
                revision=0,
            )
        )
        return changes

    def _update_confirmed_route(self, sample: VehicleSample, route_state) -> list[StateChange]:
        assert route_state.confirmed is not None
        confirmed = route_state.confirmed
        baseline = route_state.candidate or confirmed

        if route_state.pending_revision is not None:
            detection = self._latest_cycle_detection(route_state, route_state.pending_revision)
            if detection is None:
                return []
            observed = detection.effective
            if not _legacy._material_route_change(baseline, observed):
                route_state.pending_revision = None
                route_state.pending_since_utc = None
                return []
            route_state.pending_revision = observed
            assert route_state.pending_since_utc is not None
            stable_seconds = (sample.sample_time_utc - route_state.pending_since_utc).total_seconds()
            if stable_seconds < _legacy._ROUTE_REVISION_CONFIRM_SECONDS:
                return []

            previous = confirmed
            route_state.revision += 1
            revised = replace(observed, route_id=f"{observed.route_id}:r{route_state.revision}")
            route_state.confirmed = revised
            route_state.candidate = revised
            route_state.candidate_since_utc = sample.sample_time_utc
            route_state.pending_revision = None
            route_state.pending_since_utc = None
            return [
                self._route_change(
                    sample,
                    ChangeKind.ROUTE_REVISED,
                    detection,
                    route_override=revised,
                    revision=route_state.revision,
                    previous_route_id=previous.route_id,
                )
            ]

        detection = self._latest_cycle_detection(route_state, confirmed)
        if detection is not None:
            observed = detection.effective
            if not _legacy._material_route_change(baseline, observed):
                route_state.confirmed = replace(observed, route_id=confirmed.route_id)
                return []
            route_state.pending_revision = observed
            route_state.pending_since_utc = sample.sample_time_utc
            return [
                self._route_change(
                    sample,
                    ChangeKind.ROUTE_REVISION_CANDIDATE,
                    detection,
                    revision=route_state.revision + 1,
                    previous_route_id=confirmed.route_id,
                )
            ]

        change_detection = self._generic_change_probe(sample, route_state, baseline)
        if change_detection is None:
            return []
        route_state.pending_revision = change_detection.effective
        route_state.pending_since_utc = sample.sample_time_utc
        return [
            self._route_change(
                sample,
                ChangeKind.ROUTE_REVISION_CANDIDATE,
                change_detection,
                revision=route_state.revision + 1,
                previous_route_id=confirmed.route_id,
            )
        ]


__all__ = ["CoreSession", "ROUTE_HISTORY_SECONDS"]
