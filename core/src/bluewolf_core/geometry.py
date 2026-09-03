"""Scale-independent geometry shared by every closed-route family."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

from .models import CanonicalPoint, ClosedRoute


EARTH_RADIUS_M = 6_378_137.0
_EPSILON = 1e-12


@dataclass(frozen=True, slots=True)
class PolylineProjection:
    phase: float
    distance_m: float
    projected: CanonicalPoint
    tangent_east: float
    tangent_north: float
    segment_index: int


def _points(value: Iterable[CanonicalPoint]) -> tuple[CanonicalPoint, ...]:
    points = tuple(value)
    if len(points) < 3:
        raise ValueError("a closed polyline requires at least three points")
    return points


def _segments(
    points: tuple[CanonicalPoint, ...],
) -> tuple[tuple[CanonicalPoint, CanonicalPoint, float], ...]:
    output = []
    for index, start in enumerate(points):
        end = points[(index + 1) % len(points)]
        length = math.hypot(end.x_m - start.x_m, end.y_m - start.y_m)
        if length <= _EPSILON:
            raise ValueError("consecutive canonical points must be distinct")
        output.append((start, end, length))
    return tuple(output)


def closed_polyline_length(points: Iterable[CanonicalPoint]) -> float:
    return sum(segment[2] for segment in _segments(_points(points)))


def point_at_phase(
    points: Iterable[CanonicalPoint], phase: float
) -> tuple[CanonicalPoint, int, float]:
    """Return point, segment index and segment fraction at arc-length phase."""
    if not math.isfinite(phase):
        raise ValueError("phase must be finite")
    frozen = _points(points)
    segments = _segments(frozen)
    total = sum(segment[2] for segment in segments)
    target = (phase % 1.0) * total
    traversed = 0.0
    for index, (start, end, length) in enumerate(segments):
        if target < traversed + length or index == len(segments) - 1:
            fraction = min(1.0, max(0.0, (target - traversed) / length))
            return (
                CanonicalPoint(
                    start.x_m + (end.x_m - start.x_m) * fraction,
                    start.y_m + (end.y_m - start.y_m) * fraction,
                ),
                index,
                fraction,
            )
        traversed += length
    raise AssertionError("unreachable")


def resample_closed_polyline(
    points: Iterable[CanonicalPoint], count: int
) -> tuple[CanonicalPoint, ...]:
    if not 3 <= count <= 64:
        raise ValueError("count must be in [3, 64]")
    frozen = _points(points)
    return tuple(point_at_phase(frozen, index / count)[0] for index in range(count))


def project_onto_closed_polyline(
    points: Iterable[CanonicalPoint], query: CanonicalPoint
) -> PolylineProjection:
    """Project onto the closest segment and return normalized arc-length phase."""
    frozen = _points(points)
    segments = _segments(frozen)
    total = sum(segment[2] for segment in segments)
    best: tuple[float, int, float, CanonicalPoint, float, float] | None = None
    traversed = 0.0
    for index, (start, end, length) in enumerate(segments):
        dx = end.x_m - start.x_m
        dy = end.y_m - start.y_m
        raw_fraction = (
            (query.x_m - start.x_m) * dx + (query.y_m - start.y_m) * dy
        ) / (length * length)
        fraction = min(1.0, max(0.0, raw_fraction))
        projected = CanonicalPoint(start.x_m + dx * fraction, start.y_m + dy * fraction)
        distance = math.hypot(query.x_m - projected.x_m, query.y_m - projected.y_m)
        candidate = (
            distance,
            index,
            fraction,
            projected,
            dx / length,
            dy / length,
        )
        if best is None or candidate[:3] < best[:3]:
            best = candidate
        traversed += length
    if best is None:
        raise AssertionError("unreachable")

    distance, index, fraction, projected, tangent_east, tangent_north = best
    before = sum(segment[2] for segment in segments[:index])
    phase = (before + segments[index][2] * fraction) / total
    return PolylineProjection(
        phase=phase % 1.0,
        distance_m=distance,
        projected=projected,
        tangent_east=tangent_east,
        tangent_north=tangent_north,
        segment_index=index,
    )


def circular_phase_distance(first: float, second: float) -> float:
    """Shortest unsigned distance between cycle phases, in [0, 0.5]."""
    if not math.isfinite(first) or not math.isfinite(second):
        raise ValueError("phases must be finite")
    difference = abs((first - second) % 1.0)
    return min(difference, 1.0 - difference)


def vector_angle_error_deg(
    east: float,
    north: float,
    reference_east: float,
    reference_north: float,
) -> float:
    """Unsigned directional error in [0, 180] degrees."""
    speed = math.hypot(east, north)
    reference_speed = math.hypot(reference_east, reference_north)
    if speed <= _EPSILON or reference_speed <= _EPSILON:
        raise ValueError("angle requires two non-zero vectors")
    cosine = (east * reference_east + north * reference_north) / (
        speed * reference_speed
    )
    return math.degrees(math.acos(min(1.0, max(-1.0, cosine))))


def tangent_error_deg(
    projection: PolylineProjection,
    velocity_east_mps: float,
    velocity_north_mps: float,
    *,
    phase_sign: int = 1,
) -> float:
    if phase_sign not in (-1, 1):
        raise ValueError("phase_sign must be -1 or 1")
    return vector_angle_error_deg(
        velocity_east_mps,
        velocity_north_mps,
        projection.tangent_east * phase_sign,
        projection.tangent_north * phase_sign,
    )


def menger_curvature(
    first: CanonicalPoint, middle: CanonicalPoint, last: CanonicalPoint
) -> float:
    """Signed three-point curvature; scale changes are handled naturally."""
    first_side = math.hypot(middle.x_m - first.x_m, middle.y_m - first.y_m)
    second_side = math.hypot(last.x_m - middle.x_m, last.y_m - middle.y_m)
    third_side = math.hypot(last.x_m - first.x_m, last.y_m - first.y_m)
    denominator = first_side * second_side * third_side
    if denominator <= _EPSILON:
        return 0.0
    twice_area = (
        (middle.x_m - first.x_m) * (last.y_m - first.y_m)
        - (middle.y_m - first.y_m) * (last.x_m - first.x_m)
    )
    return 2.0 * twice_area / denominator


def curvature_at_phase(
    points: Iterable[CanonicalPoint], phase: float, *, phase_window: float = 0.02
) -> float:
    if not 0 < phase_window < 0.5:
        raise ValueError("phase_window must be in (0, 0.5)")
    frozen = _points(points)
    return menger_curvature(
        point_at_phase(frozen, phase - phase_window)[0],
        point_at_phase(frozen, phase)[0],
        point_at_phase(frozen, phase + phase_window)[0],
    )


def normalized_curvature_error(
    observed_curvature: float,
    expected_curvature: float,
    route_length_m: float,
) -> float:
    """Normalize without an absolute minimum radius, preserving scale invariance."""
    if route_length_m <= 0:
        raise ValueError("route_length_m must be positive")
    route_scale_curvature = 2.0 * math.pi / route_length_m
    denominator = max(abs(expected_curvature), route_scale_curvature)
    return abs(observed_curvature - expected_curvature) / denominator


def wgs84_to_local_m(
    latitude_deg: float,
    longitude_deg: float,
    center_latitude_deg: float,
    center_longitude_deg: float,
) -> CanonicalPoint:
    center_latitude_rad = math.radians(center_latitude_deg)
    east = math.radians(longitude_deg - center_longitude_deg) * EARTH_RADIUS_M * math.cos(
        center_latitude_rad
    )
    north = math.radians(latitude_deg - center_latitude_deg) * EARTH_RADIUS_M
    return CanonicalPoint(east, north)


def local_m_to_wgs84(
    point: CanonicalPoint,
    center_latitude_deg: float,
    center_longitude_deg: float,
) -> tuple[float, float]:
    center_latitude_rad = math.radians(center_latitude_deg)
    latitude = center_latitude_deg + math.degrees(point.y_m / EARTH_RADIUS_M)
    longitude = center_longitude_deg + math.degrees(
        point.x_m / (EARTH_RADIUS_M * math.cos(center_latitude_rad))
    )
    return latitude, longitude


def project_wgs84(route: ClosedRoute, latitude_deg: float, longitude_deg: float) -> PolylineProjection:
    local = wgs84_to_local_m(
        latitude_deg,
        longitude_deg,
        route.center_latitude_deg,
        route.center_longitude_deg,
    )
    return project_onto_closed_polyline(route.canonical_points, local)
