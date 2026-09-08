"""Active-lobe semantic phase for Double Hippodrome synchronization.

Approved semantics:
- route lifecycle uses the full Double boundary and its raw phase;
- synchronization treats the Double as two logical Single Hippodromes;
- at each timestamp the vehicle is scored on the logical Hippodrome it occupies;
- role/quarter assignment may therefore switch when the vehicle crosses to the
  other logical component;
- vehicle identifiers never determine the role.

Spatial evidence selects the active component when it is unique. If both logical
components are spatially plausible in the connection region, velocity heading
selects the component whose local tangent line matches the motion. If heading is
unavailable and position is ambiguous, no semantic phase is fabricated.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .double_lobe_geometry import derive_double_hippodrome_components_from_route
from .geometry import local_m_to_wgs84, vector_angle_error_deg
from .models import (
    CanonicalPoint,
    ClosedRoute,
    Direction,
    RouteComponent,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
)
from .so_phase import (
    SOSemanticProjection,
    build_so_phase_frame,
    project_so_semantic_phase_wgs84,
)


_EPS = 1e-12


class AmbiguousDoubleLobeProjection(ValueError):
    """Active logical Hippodrome cannot be resolved from available evidence."""


@dataclass(frozen=True, slots=True)
class DoubleLobeSemanticProjection:
    component_id: str
    semantic_phase: float
    component_projection: SOSemanticProjection
    heading_disambiguated: bool
    candidate_count: int
    heading_error_deg: float | None = None

    def __post_init__(self) -> None:
        if not self.component_id:
            raise ValueError("component_id is required")
        if not math.isfinite(self.semantic_phase) or not 0.0 <= self.semantic_phase < 1.0:
            raise ValueError("semantic_phase must be finite and in [0,1)")
        if self.candidate_count < 1:
            raise ValueError("candidate_count must be positive")
        if self.heading_error_deg is not None and not math.isfinite(self.heading_error_deg):
            raise ValueError("heading_error_deg must be finite when supplied")


def _component_route(parent: ClosedRoute, component: RouteComponent) -> ClosedRoute:
    component_latitude, component_longitude = local_m_to_wgs84(
        CanonicalPoint(
            component.center_offset_east_m,
            component.center_offset_north_m,
        ),
        parent.center_latitude_deg,
        parent.center_longitude_deg,
    )
    return ClosedRoute(
        route_id=f"{parent.route_id}:{component.component_id}",
        family=RouteFamily.SO,
        subtype=RouteSubtype.HIPPODROME,
        topology=RouteTopology.SIMPLE,
        canonical_points=component.canonical_points,
        center_latitude_deg=component_latitude,
        center_longitude_deg=component_longitude,
        length_m=component.length_m,
        long_axis_a_m=component.long_axis_a_m,
        short_axis_b_m=component.short_axis_b_m,
        orientation_deg=component.orientation_deg,
        # Local period is not consumed by phase projection. Half the full period
        # is the already-approved base-period representation for Double routes.
        estimated_period_s=parent.estimated_period_s / 2.0,
        direction=Direction.UNKNOWN,
        detection_quality=parent.detection_quality,
    )


def _validated_velocity(
    velocity_east_mps: float | None,
    velocity_north_mps: float | None,
) -> tuple[float, float] | None:
    if (velocity_east_mps is None) != (velocity_north_mps is None):
        raise ValueError("velocity east/north must both be supplied or both be absent")
    if velocity_east_mps is None:
        return None
    east = float(velocity_east_mps)
    north = float(velocity_north_mps)
    if not math.isfinite(east) or not math.isfinite(north):
        raise ValueError("velocity must be finite")
    if math.hypot(east, north) <= _EPS:
        return None
    return east, north


def _undirected_heading_error_deg(
    velocity: tuple[float, float],
    tangent_east: float,
    tangent_north: float,
) -> float:
    directed = vector_angle_error_deg(
        velocity[0],
        velocity[1],
        tangent_east,
        tangent_north,
    )
    return min(directed, abs(180.0 - directed))


def project_double_active_lobe_wgs84(
    route: ClosedRoute,
    latitude_deg: float,
    longitude_deg: float,
    *,
    reference_major_axis: tuple[float, float] | None = None,
    velocity_east_mps: float | None = None,
    velocity_north_mps: float | None = None,
    ambiguity_distance_short_axis_ratio: float = 0.05,
) -> DoubleLobeSemanticProjection:
    """Project one position onto the active logical Single Hippodrome."""

    if route.subtype is not RouteSubtype.DOUBLE_HIPPODROME:
        raise ValueError("active-lobe projection requires a Double Hippodrome")
    if not math.isfinite(ambiguity_distance_short_axis_ratio) or ambiguity_distance_short_axis_ratio < 0.0:
        raise ValueError("ambiguity_distance_short_axis_ratio must be finite and non-negative")

    components = derive_double_hippodrome_components_from_route(route)
    projected: list[tuple[RouteComponent, SOSemanticProjection]] = []
    for component in components:
        child = _component_route(route, component)
        child_frame = build_so_phase_frame(
            child,
            reference_major_axis=reference_major_axis,
        )
        projection = project_so_semantic_phase_wgs84(
            child,
            latitude_deg,
            longitude_deg,
            frame=child_frame,
        )
        projected.append((component, projection))

    projected.sort(
        key=lambda item: (
            item[1].projection.distance_m,
            item[0].component_id,
        )
    )
    nearest_distance = projected[0][1].projection.distance_m
    ambiguity_band = route.short_axis_b_m * ambiguity_distance_short_axis_ratio
    candidates = tuple(
        item
        for item in projected
        if item[1].projection.distance_m <= nearest_distance + ambiguity_band + _EPS
    )
    if len(candidates) == 1:
        component, projection = candidates[0]
        return DoubleLobeSemanticProjection(
            component_id=component.component_id,
            semantic_phase=projection.semantic_phase,
            component_projection=projection,
            heading_disambiguated=False,
            candidate_count=1,
        )

    velocity = _validated_velocity(velocity_east_mps, velocity_north_mps)
    if velocity is None:
        raise AmbiguousDoubleLobeProjection(
            "Double Hippodrome connection is component-ambiguous without heading evidence"
        )

    ranked: list[tuple[float, str, RouteComponent, SOSemanticProjection]] = []
    for component, projection in candidates:
        heading_error = _undirected_heading_error_deg(
            velocity,
            projection.projection.tangent_east,
            projection.projection.tangent_north,
        )
        ranked.append((heading_error, component.component_id, component, projection))
    ranked.sort(key=lambda item: (item[0], item[1]))
    best = ranked[0]
    if len(ranked) > 1 and abs(ranked[1][0] - best[0]) <= 1e-9:
        raise AmbiguousDoubleLobeProjection(
            "Double Hippodrome heading evidence does not distinguish the active component"
        )

    return DoubleLobeSemanticProjection(
        component_id=best[2].component_id,
        semantic_phase=best[3].semantic_phase,
        component_projection=best[3],
        heading_disambiguated=True,
        candidate_count=len(candidates),
        heading_error_deg=best[0],
    )
