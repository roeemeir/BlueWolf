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
"""

from __future__ import annotations

from dataclasses import replace

from . import session as _legacy
from .cycle_window_v25 import latest_cycle_vehicle_samples
from .models import ChangeKind, ClosedRoute, StateChange, VehicleSample
from .route_detection import RouteDetection, detect_closed_route
from .session_v23 import CoreSession as _V23CoreSession, ROUTE_HISTORY_SECONDS


class CoreSession(_V23CoreSession):
    """Canonical streaming session using the last completed cycle for active fit."""

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

    def _generic_change_probe(
        self,
        sample: VehicleSample,
        route_state,
        reference: ClosedRoute,
    ) -> RouteDetection | None:
        """Find a changed closed route without assuming its new period or shape.

        The active fit never leaves latest-cycle semantics. This probe exists only
        to discover a materially changed route when the old period no longer spans
        a complete new cycle. It examines recent suffixes from short to longer,
        bounded by the retained 40-minute evidence. No centre/axis/turn/family
        assumption is introduced; every suffix is passed to the same closed-route
        detector and must satisfy its closure/fit/completed-cycle requirements.
        """
        history = route_state.history
        if len(history) < 12:
            return None
        available_seconds = max(
            0.0,
            (history[-1].sample_time_utc - history[0].sample_time_utc).total_seconds(),
        )
        if available_seconds <= 0:
            return None

        # Two reference cycles are a natural first probe: one old-period slice is
        # already used by the active fit, while a second cycle gives a changed
        # period room to close without imposing a geometric model. The 180-second
        # floor reuses the existing revision/candidate timing, not a new route law.
        base_seconds = max(
            2.0 * max(reference.estimated_period_s, 1.0),
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
            if _legacy._material_route_change(reference, detection.effective):
                return detection
        return None

    def _update_initial_route(self, sample: VehicleSample, route_state) -> list[StateChange]:
        changes: list[StateChange] = []
        candidate_config = replace(
            self.config.detection,
            new_route_observation_seconds=self.config.detection.known_route_candidate_seconds,
        )

        # Before a reference exists we must use generic closed-route evidence.
        # The detector itself requires closure, fit quality and a completed cycle,
        # so this does not claim a route merely because 60 seconds elapsed.
        if route_state.candidate is None:
            candidate_detection = detect_closed_route(route_state.history, candidate_config)
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

        # Once a revision candidate exists, evaluate exactly its latest cycle.
        # This prevents the old route period from controlling new-route stability.
        if route_state.pending_revision is not None:
            detection = self._latest_cycle_detection(route_state, route_state.pending_revision)
            if detection is None:
                return []
            observed = detection.effective
            if not _legacy._material_route_change(confirmed, observed):
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

        # Normal operation: current geometry is always the latest completed cycle
        # under the currently confirmed period.
        detection = self._latest_cycle_detection(route_state, confirmed)
        if detection is not None:
            observed = detection.effective
            if not _legacy._material_route_change(confirmed, observed):
                refreshed = replace(observed, route_id=confirmed.route_id)
                route_state.confirmed = refreshed
                route_state.candidate = refreshed
                return []
            # A valid, materially different full cycle is already sufficient to
            # start the revision stability clock.
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

        # If the old period no longer yields a complete cycle, discover the new
        # route from a bounded generic suffix. This path is only entered during
        # suspected change, so stable-route cost remains proportional to one cycle.
        change_detection = self._generic_change_probe(sample, route_state, confirmed)
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
