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
        detection = self._latest_cycle_detection(route_state, route_state.confirmed)
        if detection is None:
            return []
        observed = detection.effective

        if not _legacy._material_route_change(route_state.confirmed, observed):
            # Refresh the active fit from the latest cycle without creating a new
            # route identity/revision. This is the geometry used for current phase.
            refreshed = replace(observed, route_id=route_state.confirmed.route_id)
            route_state.confirmed = refreshed
            route_state.candidate = refreshed
            route_state.pending_revision = None
            route_state.pending_since_utc = None
            return []

        if route_state.pending_revision is None:
            route_state.pending_revision = observed
            route_state.pending_since_utc = sample.sample_time_utc
            return [
                self._route_change(
                    sample,
                    ChangeKind.ROUTE_REVISION_CANDIDATE,
                    detection,
                    revision=route_state.revision + 1,
                    previous_route_id=route_state.confirmed.route_id,
                )
            ]

        route_state.pending_revision = observed
        assert route_state.pending_since_utc is not None
        stable_seconds = (sample.sample_time_utc - route_state.pending_since_utc).total_seconds()
        if stable_seconds < _legacy._ROUTE_REVISION_CONFIRM_SECONDS:
            return []

        previous = route_state.confirmed
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


__all__ = ["CoreSession", "ROUTE_HISTORY_SECONDS"]
