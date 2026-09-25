"""Public Blue Wolf session enriched with SO semantic phase.

This layer composes on top of the validated route + structural-group session.
It deliberately leaves ``VehicleFrameResult.phase`` untouched for backward
compatibility and adds ``semantic_phase`` only for confirmed SO routes.

SO Route Instances inside one group share a projective mean major-axis
reference. The mean uses doubled orientation angles, so it is independent of
axis sign, vehicle identifier and sample arrival order. Individual route frames
then align their local Q0/Q2 sign to that common group reference.

For Double Hippodrome, ``semantic_phase`` is intentionally *not* the full-double
phase. It is the local phase on the currently active logical Single Hippodrome;
``active_so_component_id`` reports which derived lobe supplied that evidence.
Thus role switching is geometry-driven rather than tied to vehicle identity.

No new lifecycle state is introduced here: references and Double lobe geometry
are derived from confirmed geometry. Checkpoint replay therefore remains
deterministic without hidden mutable role state.
"""
from __future__ import annotations

import math
from dataclasses import replace
from datetime import UTC, datetime
from itertools import groupby
from typing import Iterable

from .config import CoreConfig
from .double_lobe_phase import (
    AmbiguousDoubleLobeProjection,
    project_double_active_lobe_wgs84,
)
from .integrated_session import (
    DEFAULT_ALGORITHM_VERSION,
    CoreSession as IntegratedCoreSession,
)
from .models import (
    ClosedRoute,
    CoreBatchResult,
    RouteFamily,
    RouteSubtype,
    VehicleFrameResult,
    VehicleSample,
)
from .so_phase import (
    AmbiguousSOPhaseProjection,
    UnsupportedSOPhaseGeometry,
    build_so_phase_frame,
    project_so_semantic_phase_wgs84,
)


_EPS = 1e-12


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("time must be timezone-aware")
    return value.astimezone(UTC)


def _oriented_world_axis(east: float, north: float) -> tuple[float, float]:
    """Pick one deterministic sign for an unoriented projective axis."""

    if abs(east) >= abs(north):
        if east < 0.0:
            east, north = -east, -north
    elif north < 0.0:
        east, north = -east, -north
    return east, north


def _projective_mean_axis(orientation_deg: tuple[float, ...]) -> tuple[float, float] | None:
    """Mean unoriented 2D axes via doubled angles, independent of input order."""

    if not orientation_deg:
        return None
    twice_cos = 0.0
    twice_sin = 0.0
    for value in orientation_deg:
        if not math.isfinite(value):
            return None
        angle = math.radians(value % 180.0)
        twice_cos += math.cos(2.0 * angle)
        twice_sin += math.sin(2.0 * angle)
    if math.hypot(twice_cos, twice_sin) <= _EPS:
        return None
    mean = 0.5 * math.atan2(twice_sin, twice_cos)
    return _oriented_world_axis(math.cos(mean), math.sin(mean))


class CoreSession(IntegratedCoreSession):
    """Integrated deterministic session with SO semantic-phase output."""

    def __init__(
        self,
        config: CoreConfig | None = None,
        algorithm_version: str = DEFAULT_ALGORITHM_VERSION,
    ) -> None:
        super().__init__(config=config, algorithm_version=algorithm_version)

    def confirmed_route(
        self,
        server_id: int,
        vehicle_identifier: int,
    ) -> ClosedRoute | None:
        """Return the current confirmed route for one stream without exposing state.

        ``ClosedRoute`` is immutable, so callers may safely consume this object
        for application/runtime composition. Missing, expired or never-confirmed
        streams return ``None`` rather than exposing the internal route lifecycle.
        """

        if isinstance(server_id, bool) or not isinstance(server_id, int) or server_id < 0:
            raise ValueError("server_id must be a non-negative integer")
        if (
            isinstance(vehicle_identifier, bool)
            or not isinstance(vehicle_identifier, int)
            or vehicle_identifier < 0
        ):
            raise ValueError("vehicle_identifier must be a non-negative integer")
        state = self._routes.get((server_id, vehicle_identifier))
        return state.confirmed if state is not None else None

    def process_batch(
        self,
        samples: Iterable[VehicleSample],
        *,
        observed_until_utc: datetime | None = None,
    ) -> CoreBatchResult:
        observed = _utc(observed_until_utc) if observed_until_utc is not None else None
        ordered = sorted(
            samples,
            key=lambda item: (
                item.sample_time_utc,
                item.server_id,
                item.vehicle_identifier,
                item.vehicle_number,
            ),
        )
        frames: list[VehicleFrameResult] = []
        changes = []

        for _, bucket_iter in groupby(ordered, key=lambda item: item.sample_time_utc):
            bucket = tuple(bucket_iter)
            result = super().process_batch(bucket)
            sample_by_key = {sample.stream_key: sample for sample in bucket}
            references = self._so_group_reference_axes()
            frames.extend(
                self._with_semantic_phase(
                    frame,
                    sample_by_key.get((frame.server_id, frame.vehicle_identifier)),
                    references,
                )
                for frame in result.frames
            )
            changes.extend(result.changes)

        newest_sample = ordered[-1].sample_time_utc if ordered else None
        if observed is not None and (
            newest_sample is None or observed > newest_sample
        ):
            tail = super().process_batch((), observed_until_utc=observed)
            changes.extend(tail.changes)

        return CoreBatchResult(
            schema_version=1,
            algorithm_version=self.algorithm_version,
            frames=tuple(frames),
            changes=tuple(changes),
            processed_until_utc=self._processed_until_utc,
        )

    def _so_group_reference_axes(self) -> dict[str, tuple[float, float]]:
        output: dict[str, tuple[float, float]] = {}
        for group in self._grouping.groups:
            if group.family is not RouteFamily.SO:
                continue
            orientations: list[float] = []
            for key in group.member_keys:
                route_state = self._routes.get(key)
                route = route_state.confirmed if route_state is not None else None
                if route is not None and route.family is RouteFamily.SO:
                    orientations.append(route.orientation_deg)
            reference = _projective_mean_axis(tuple(orientations))
            if reference is not None:
                output[group.group_id] = reference
        return output

    def _with_semantic_phase(
        self,
        frame: VehicleFrameResult,
        sample: VehicleSample | None,
        references: dict[str, tuple[float, float]],
    ) -> VehicleFrameResult:
        if (
            frame.route_id is None
            or frame.latitude_deg is None
            or frame.longitude_deg is None
            or frame.active is False
        ):
            return frame

        key = (frame.server_id, frame.vehicle_identifier)
        route_state = self._routes.get(key)
        route = route_state.confirmed if route_state is not None else None
        if (
            route is None
            or route.route_id != frame.route_id
            or route.family is not RouteFamily.SO
        ):
            return frame

        reference = references.get(frame.group_id) if frame.group_id is not None else None
        velocity_east = None
        velocity_north = None
        if (
            sample is not None
            and sample.velocity_east_mps is not None
            and sample.velocity_north_mps is not None
        ):
            velocity_east = sample.velocity_east_mps
            velocity_north = sample.velocity_north_mps

        semantic: float | None = None
        active_component_id: str | None = None
        try:
            if route.subtype is RouteSubtype.DOUBLE_HIPPODROME:
                double_projection = project_double_active_lobe_wgs84(
                    route,
                    frame.latitude_deg,
                    frame.longitude_deg,
                    reference_major_axis=reference,
                    velocity_east_mps=velocity_east,
                    velocity_north_mps=velocity_north,
                    ambiguity_distance_short_axis_ratio=(
                        self.config.scoring.distance_short_axis_ratio.full_score_through
                    ),
                )
                semantic = double_projection.semantic_phase
                active_component_id = double_projection.component_id
            else:
                phase_frame = build_so_phase_frame(
                    route,
                    reference_major_axis=reference,
                )
                semantic = project_so_semantic_phase_wgs84(
                    route,
                    frame.latitude_deg,
                    frame.longitude_deg,
                    frame=phase_frame,
                    velocity_east_mps=velocity_east,
                    velocity_north_mps=velocity_north,
                    ambiguity_distance_short_axis_ratio=(
                        self.config.scoring.distance_short_axis_ratio.full_score_through
                    ),
                ).semantic_phase
        except (
            AmbiguousDoubleLobeProjection,
            AmbiguousSOPhaseProjection,
            UnsupportedSOPhaseGeometry,
        ):
            # Ambiguous connection/crossing evidence is missing information, not
            # permission to fabricate a role or phase for this timestamp.
            semantic = None
            active_component_id = None

        return replace(
            frame,
            semantic_phase=semantic,
            active_so_component_id=active_component_id,
        )
