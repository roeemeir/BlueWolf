"""Velocity-aware phase projection for self-crossing closed routes."""

from __future__ import annotations

import math
from typing import Iterable

from .geometry import PolylineProjection, vector_angle_error_deg, wgs84_to_local_m
from .models import CanonicalPoint, ClosedRoute


_EPSILON = 1e-12


def project_self_crossing_wgs84(
    route: ClosedRoute,
    latitude_deg: float,
    longitude_deg: float,
    velocity_east_mps: float,
    velocity_north_mps: float,
) -> PolylineProjection:
    """Disambiguate two nearby branches using the observed velocity heading.

    This helper is intentionally opt-in. Ordinary SI/SO routes continue using
    the existing closest-segment projection. At a self crossing, position alone
    can map to two route phases; among spatially plausible segments we choose
    the tangent most consistent with the measured velocity.
    """

    local = wgs84_to_local_m(
        latitude_deg,
        longitude_deg,
        route.center_latitude_deg,
        route.center_longitude_deg,
    )
    ambiguity_distance_m = max(0.5, min(5.0, 0.10 * route.short_axis_b_m))
    return project_self_crossing_polyline(
        route.canonical_points,
        local,
        velocity_east_mps,
        velocity_north_mps,
        ambiguity_distance_m=ambiguity_distance_m,
    )


def project_self_crossing_polyline(
    points: Iterable[CanonicalPoint],
    query: CanonicalPoint,
    velocity_east_mps: float,
    velocity_north_mps: float,
    *,
    ambiguity_distance_m: float,
) -> PolylineProjection:
    frozen = tuple(points)
    if len(frozen) < 3:
        raise ValueError("a closed polyline requires at least three points")
    if ambiguity_distance_m < 0:
        raise ValueError("ambiguity_distance_m must be non-negative")
    if math.hypot(velocity_east_mps, velocity_north_mps) <= _EPSILON:
        raise ValueError("velocity vector must be non-zero")

    segments: list[tuple[CanonicalPoint, CanonicalPoint, float]] = []
    total = 0.0
    for index, start in enumerate(frozen):
        end = frozen[(index + 1) % len(frozen)]
        length = math.hypot(end.x_m - start.x_m, end.y_m - start.y_m)
        if length <= _EPSILON:
            raise ValueError("consecutive canonical points must be distinct")
        segments.append((start, end, length))
        total += length

    candidates: list[
        tuple[float, float, int, float, CanonicalPoint, float, float]
    ] = []
    traversed = 0.0
    for index, (start, end, length) in enumerate(segments):
        dx = end.x_m - start.x_m
        dy = end.y_m - start.y_m
        raw_fraction = (
            (query.x_m - start.x_m) * dx + (query.y_m - start.y_m) * dy
        ) / (length * length)
        fraction = min(1.0, max(0.0, raw_fraction))
        projected = CanonicalPoint(
            start.x_m + dx * fraction,
            start.y_m + dy * fraction,
        )
        distance = math.hypot(query.x_m - projected.x_m, query.y_m - projected.y_m)
        tangent_east = dx / length
        tangent_north = dy / length
        heading_error = vector_angle_error_deg(
            velocity_east_mps,
            velocity_north_mps,
            tangent_east,
            tangent_north,
        )
        phase = (traversed + length * fraction) / total
        candidates.append(
            (
                distance,
                heading_error,
                index,
                phase,
                projected,
                tangent_east,
                tangent_north,
            )
        )
        traversed += length

    minimum_distance = min(candidate[0] for candidate in candidates)
    plausible = tuple(
        candidate
        for candidate in candidates
        if candidate[0] <= minimum_distance + ambiguity_distance_m
    )
    best = min(plausible, key=lambda item: (item[1], item[0], item[2], item[3]))
    distance, _, index, phase, projected, tangent_east, tangent_north = best
    return PolylineProjection(
        phase=phase % 1.0,
        distance_m=distance,
        projected=projected,
        tangent_east=tangent_east,
        tangent_north=tangent_north,
        segment_index=index,
    )
