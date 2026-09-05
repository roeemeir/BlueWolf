"""Robust closed-route detection for SI/SO vehicle trajectories.

The detector keeps the original robust ellipse/stadium fitter for SI and
single-hypodrome SO routes and uses the v0.8 topology classifier for continuous
Double SO and Figure-8 trajectories. Complex routes retain an empirical
one-cycle canonical shape rather than being incorrectly flattened into a
single stadium.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from types import MappingProxyType
from typing import Iterable, Mapping, Sequence

from .config import DetectionConfig
from .geometry import (
    closed_polyline_length,
    local_m_to_wgs84,
    project_onto_closed_polyline,
    resample_closed_polyline,
    vector_angle_error_deg,
    wgs84_to_local_m,
)
from .models import (
    CanonicalPoint,
    ClosedRoute,
    Direction,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
    VehicleSample,
)
from .v08_core import Point2D, RouteShape, classify_route as classify_topology


_EPSILON = 1e-9
_MIN_SAMPLES = 12


@dataclass(frozen=True, slots=True)
class RouteDetection:
    """A confirmed route with both raw and robust geometry representations."""

    observed: ClosedRoute
    effective: ClosedRoute
    fit_fraction: float
    inlier_fraction: float
    completed_cycles: float
    outlier_count: int
    diagnostics: Mapping[str, float | int | str | bool]

    def __post_init__(self) -> None:
        object.__setattr__(self, "diagnostics", MappingProxyType(dict(self.diagnostics)))
        for name in ("fit_fraction", "inlier_fraction"):
            value = float(getattr(self, name))
            if not 0.0 <= value <= 1.0:
                raise ValueError(f"{name} must be in [0, 1]")
        if self.completed_cycles < 0:
            raise ValueError("completed_cycles must be non-negative")
        if self.outlier_count < 0:
            raise ValueError("outlier_count must be non-negative")


@dataclass(frozen=True, slots=True)
class _SamplePoint:
    sample: VehicleSample
    point: CanonicalPoint


@dataclass(frozen=True, slots=True)
class _Shape:
    center: CanonicalPoint
    long_axis_m: float
    short_axis_m: float
    orientation_rad: float
    family: RouteFamily
    subtype: RouteSubtype
    topology: RouteTopology
    canonical_points: tuple[CanonicalPoint, ...]
    length_m: float


def detect_closed_route(
    samples: Iterable[VehicleSample],
    config: DetectionConfig | None = None,
) -> RouteDetection | None:
    """Detect and confirm one closed route from one canonical vehicle stream."""

    detection = config or DetectionConfig()
    ordered = tuple(
        sorted(
            (
                sample
                for sample in samples
                if sample.active is not False
                and sample.latitude_deg is not None
                and sample.longitude_deg is not None
                and sample.reliability > 0.0
            ),
            key=lambda item: item.sample_time_utc,
        )
    )
    if len(ordered) < _MIN_SAMPLES:
        return None

    stream_keys = {sample.stream_key for sample in ordered}
    if len(stream_keys) != 1:
        raise ValueError("detect_closed_route expects samples from exactly one vehicle stream")

    observation_seconds = (ordered[-1].sample_time_utc - ordered[0].sample_time_utc).total_seconds()
    if observation_seconds + _EPSILON < detection.new_route_observation_seconds:
        return None

    origin_lat = statistics.median(float(sample.latitude_deg) for sample in ordered)
    origin_lon = statistics.median(float(sample.longitude_deg) for sample in ordered)
    raw_points = tuple(
        _SamplePoint(
            sample=sample,
            point=wgs84_to_local_m(
                float(sample.latitude_deg),
                float(sample.longitude_deg),
                origin_lat,
                origin_lon,
            ),
        )
        for sample in ordered
    )

    inlier_mask = _transient_bump_mask(tuple(item.point for item in raw_points))
    effective_points = tuple(item.point for item, keep in zip(raw_points, inlier_mask, strict=True) if keep)
    if len(effective_points) < _MIN_SAMPLES:
        return None

    observed_shape = _fit_shape(tuple(item.point for item in raw_points), detection, robust=False)
    effective_shape = _fit_shape(effective_points, detection, robust=True)
    if effective_shape.short_axis_m <= _EPSILON:
        return None

    fit_tolerance_m = max(
        effective_shape.short_axis_m * detection.closure_distance_short_axis_ratio,
        1.0,
    )
    fit_fraction = _fit_fraction(effective_points, effective_shape.canonical_points, fit_tolerance_m)
    travelled_distance = _travelled_distance(effective_points)
    completed_cycles = travelled_distance / effective_shape.length_m
    closure_ok = _has_closed_cycle(
        effective_points,
        route_length_m=effective_shape.length_m,
        short_axis_m=effective_shape.short_axis_m,
        config=detection,
    )

    if completed_cycles + _EPSILON < detection.closure_minimum_phase:
        return None
    if not closure_ok:
        return None
    if fit_fraction + _EPSILON < detection.required_fit_fraction:
        return None
    if completed_cycles + _EPSILON < detection.required_completed_cycles:
        return None

    direction = _direction(effective_points, effective_shape.center)
    period_s = _estimate_period_seconds(
        raw_points,
        inlier_mask,
        route_length_m=effective_shape.length_m,
        completed_cycles=completed_cycles,
    )
    if period_s <= 0:
        return None

    raw_geometry = tuple(item.point for item in raw_points)
    observed_cycles = max(_travelled_distance(raw_geometry) / observed_shape.length_m, _EPSILON)
    observed_period_s = _estimate_period_seconds(
        raw_points,
        tuple(True for _ in raw_points),
        route_length_m=observed_shape.length_m,
        completed_cycles=observed_cycles,
    )
    if observed_period_s <= 0:
        observed_period_s = period_s

    inlier_fraction = sum(inlier_mask) / len(inlier_mask)
    quality = max(0.0, min(1.0, 0.55 * fit_fraction + 0.30 * inlier_fraction + 0.15 * min(1.0, completed_cycles)))

    server_id, vehicle_identifier = ordered[0].stream_key
    route_prefix = f"{server_id}:{vehicle_identifier}"
    observed_route = _to_closed_route(
        route_id=f"{route_prefix}:observed",
        shape=observed_shape,
        origin_latitude_deg=origin_lat,
        origin_longitude_deg=origin_lon,
        period_s=observed_period_s,
        direction=direction,
        quality=max(0.0, min(1.0, fit_fraction)),
    )
    effective_route = _to_closed_route(
        route_id=f"{route_prefix}:effective",
        shape=effective_shape,
        origin_latitude_deg=origin_lat,
        origin_longitude_deg=origin_lon,
        period_s=period_s,
        direction=direction,
        quality=quality,
    )

    return RouteDetection(
        observed=observed_route,
        effective=effective_route,
        fit_fraction=fit_fraction,
        inlier_fraction=inlier_fraction,
        completed_cycles=completed_cycles,
        outlier_count=len(inlier_mask) - sum(inlier_mask),
        diagnostics={
            "closure_ok": closure_ok,
            "sample_count": len(ordered),
            "effective_sample_count": sum(inlier_mask),
            "observation_seconds": observation_seconds,
            "axis_ratio": effective_shape.long_axis_m / effective_shape.short_axis_m,
            "fit_tolerance_m": fit_tolerance_m,
            "travelled_distance_m": travelled_distance,
            "subtype": effective_shape.subtype.value,
            "topology": effective_shape.topology.value,
        },
    )


def _fit_shape(points: Sequence[CanonicalPoint], config: DetectionConfig, *, robust: bool) -> _Shape:
    center = CanonicalPoint(
        statistics.median(point.x_m for point in points) if robust else statistics.fmean(point.x_m for point in points),
        statistics.median(point.y_m for point in points) if robust else statistics.fmean(point.y_m for point in points),
    )

    xx = statistics.fmean((point.x_m - center.x_m) ** 2 for point in points)
    yy = statistics.fmean((point.y_m - center.y_m) ** 2 for point in points)
    xy = statistics.fmean((point.x_m - center.x_m) * (point.y_m - center.y_m) for point in points)
    orientation = 0.5 * math.atan2(2.0 * xy, xx - yy)

    cos_o = math.cos(orientation)
    sin_o = math.sin(orientation)
    projected_long = tuple((point.x_m - center.x_m) * cos_o + (point.y_m - center.y_m) * sin_o for point in points)
    projected_short = tuple(-(point.x_m - center.x_m) * sin_o + (point.y_m - center.y_m) * cos_o for point in points)

    low_q, high_q = (0.05, 0.95) if robust else (0.0, 1.0)
    long_axis = max((_quantile(projected_long, high_q) - _quantile(projected_long, low_q)) / 2.0, _EPSILON)
    short_axis = max((_quantile(projected_short, high_q) - _quantile(projected_short, low_q)) / 2.0, _EPSILON)

    if short_axis > long_axis:
        long_axis, short_axis = short_axis, long_axis
        orientation += math.pi / 2.0

    ratio = long_axis / short_axis
    family = RouteFamily.SO
    subtype = RouteSubtype.HIPPODROME
    topology = RouteTopology.SIMPLE

    if ratio <= config.si_axis_ratio_max:
        family = RouteFamily.SI
        subtype = RouteSubtype.COMPACT
        canonical = _ellipse_points(center, long_axis, short_axis, orientation)
    else:
        descriptor = classify_topology(
            (Point2D(point.x_m, point.y_m) for point in points),
            period_s=1.0,
        )
        if descriptor.shape is RouteShape.FIGURE_EIGHT:
            subtype = RouteSubtype.FIGURE_EIGHT
            topology = RouteTopology.SELF_CROSSING
            canonical = _empirical_cycle_points(points, short_axis, long_axis)
        elif descriptor.shape is RouteShape.DOUBLE_HIPPODROME:
            subtype = RouteSubtype.DOUBLE_HIPPODROME
            topology = RouteTopology.DOUBLE
            canonical = _empirical_cycle_points(points, short_axis, long_axis)
        else:
            canonical = _stadium_points(center, long_axis, short_axis, orientation)

    canonical = resample_closed_polyline(canonical, min(config.canonical_point_limit, 64))
    return _Shape(
        center=center,
        long_axis_m=long_axis,
        short_axis_m=short_axis,
        orientation_rad=orientation,
        family=family,
        subtype=subtype,
        topology=topology,
        canonical_points=canonical,
        length_m=closed_polyline_length(canonical),
    )


def _empirical_cycle_points(
    points: Sequence[CanonicalPoint],
    short_axis_m: float,
    long_axis_m: float,
) -> tuple[CanonicalPoint, ...]:
    """Extract the first closed traversal from a stable complex trace.

    Complex SO shapes are intentionally not replaced with decorative ideal
    capsules. The canonical route follows the measured one-cycle geometry,
    then the public boundary resamples it to <=64 points.
    """
    if len(points) < 4:
        return tuple(points)
    start = points[0]
    first_heading = _heading(points, 0)
    closure_distance = max(short_axis_m * 0.30, 2.0)
    expected_length = max(2.0 * long_axis_m + 2.0 * math.pi * short_axis_m, 4.0 * short_axis_m)
    minimum_travel = expected_length * 0.65
    travelled = 0.0
    for index in range(1, len(points)):
        travelled += _distance(points[index - 1], points[index])
        if travelled < minimum_travel:
            continue
        if _distance(start, points[index]) > closure_distance:
            continue
        heading = _heading(points, index)
        if first_heading is not None and heading is not None and vector_angle_error_deg(first_heading[0], first_heading[1], heading[0], heading[1]) > 45.0:
            continue
        candidate = tuple(points[: index + 1])
        if len(candidate) >= 12:
            return candidate
    return tuple(points)


def _ellipse_points(center: CanonicalPoint, long_axis_m: float, short_axis_m: float, orientation_rad: float) -> tuple[CanonicalPoint, ...]:
    return tuple(
        _rotate_from_local(center, long_axis_m * math.cos(angle), short_axis_m * math.sin(angle), orientation_rad)
        for angle in (2.0 * math.pi * index / 64.0 for index in range(64))
    )


def _stadium_points(center: CanonicalPoint, long_axis_m: float, short_axis_m: float, orientation_rad: float) -> tuple[CanonicalPoint, ...]:
    radius = short_axis_m
    half_straight = max(long_axis_m - radius, 0.0)
    output: list[CanonicalPoint] = []
    turn_points = 24
    straight_points = 8

    # The semicircular caps are explicitly outward-facing.
    for index in range(turn_points):
        angle = -math.pi / 2.0 + math.pi * index / (turn_points - 1)
        output.append(_rotate_from_local(center, half_straight + radius * math.cos(angle), radius * math.sin(angle), orientation_rad))
    for index in range(1, straight_points + 1):
        fraction = index / (straight_points + 1)
        output.append(_rotate_from_local(center, half_straight * (1.0 - 2.0 * fraction), radius, orientation_rad))
    for index in range(turn_points):
        angle = math.pi / 2.0 + math.pi * index / (turn_points - 1)
        output.append(_rotate_from_local(center, -half_straight + radius * math.cos(angle), radius * math.sin(angle), orientation_rad))
    for index in range(1, straight_points + 1):
        fraction = index / (straight_points + 1)
        output.append(_rotate_from_local(center, -half_straight * (1.0 - 2.0 * fraction), -radius, orientation_rad))
    return tuple(output)


def _rotate_from_local(center: CanonicalPoint, along: float, across: float, orientation_rad: float) -> CanonicalPoint:
    cos_o = math.cos(orientation_rad)
    sin_o = math.sin(orientation_rad)
    return CanonicalPoint(center.x_m + along * cos_o - across * sin_o, center.y_m + along * sin_o + across * cos_o)


def _to_closed_route(
    *,
    route_id: str,
    shape: _Shape,
    origin_latitude_deg: float,
    origin_longitude_deg: float,
    period_s: float,
    direction: Direction,
    quality: float,
) -> ClosedRoute:
    center_latitude, center_longitude = local_m_to_wgs84(shape.center, origin_latitude_deg, origin_longitude_deg)
    return ClosedRoute(
        route_id=route_id,
        family=shape.family,
        subtype=shape.subtype,
        topology=shape.topology,
        canonical_points=shape.canonical_points,
        center_latitude_deg=center_latitude,
        center_longitude_deg=center_longitude,
        length_m=shape.length_m,
        long_axis_a_m=shape.long_axis_m,
        short_axis_b_m=shape.short_axis_m,
        orientation_deg=math.degrees(shape.orientation_rad) % 180.0,
        estimated_period_s=period_s,
        direction=direction,
        detection_quality=quality,
    )


def _transient_bump_mask(points: Sequence[CanonicalPoint]) -> tuple[bool, ...]:
    if len(points) < 3:
        return tuple(True for _ in points)
    steps = tuple(_distance(points[index - 1], points[index]) for index in range(1, len(points)))
    nonzero = tuple(step for step in steps if step > _EPSILON)
    if not nonzero:
        return tuple(True for _ in points)
    median_step = statistics.median(nonzero)
    threshold = max(4.0 * median_step, 1.0)
    mask = [True] * len(points)
    for index in range(1, len(points) - 1):
        incoming = _distance(points[index - 1], points[index])
        outgoing = _distance(points[index], points[index + 1])
        bridge = _distance(points[index - 1], points[index + 1])
        if incoming > threshold and outgoing > threshold and bridge <= max(2.5 * median_step, 1.5):
            mask[index] = False
    return tuple(mask)


def _fit_fraction(points: Sequence[CanonicalPoint], canonical: Sequence[CanonicalPoint], tolerance_m: float) -> float:
    if not points:
        return 0.0
    fitted = sum(project_onto_closed_polyline(canonical, point).distance_m <= tolerance_m for point in points)
    return fitted / len(points)


def _has_closed_cycle(
    points: Sequence[CanonicalPoint],
    *,
    route_length_m: float,
    short_axis_m: float,
    config: DetectionConfig,
) -> bool:
    if len(points) < 4:
        return False
    start = points[0]
    first_heading = _heading(points, 0)
    accumulated = 0.0
    threshold = max(short_axis_m * config.closure_distance_short_axis_ratio, 1.0)
    for index in range(1, len(points)):
        accumulated += _distance(points[index - 1], points[index])
        if accumulated < route_length_m * config.closure_minimum_phase:
            continue
        if _distance(start, points[index]) > threshold:
            continue
        heading = _heading(points, index)
        if first_heading is None or heading is None:
            return True
        if vector_angle_error_deg(first_heading[0], first_heading[1], heading[0], heading[1]) <= config.closure_direction_error_deg:
            return True
    return False


def _heading(points: Sequence[CanonicalPoint], index: int) -> tuple[float, float] | None:
    if len(points) < 2:
        return None
    if index <= 0:
        first, second = points[0], points[1]
    elif index >= len(points) - 1:
        first, second = points[-2], points[-1]
    else:
        first, second = points[index - 1], points[index + 1]
    east = second.x_m - first.x_m
    north = second.y_m - first.y_m
    if math.hypot(east, north) <= _EPSILON:
        return None
    return east, north


def _direction(points: Sequence[CanonicalPoint], center: CanonicalPoint) -> Direction:
    signed = 0.0
    for first, second in zip(points, points[1:]):
        ax = first.x_m - center.x_m
        ay = first.y_m - center.y_m
        bx = second.x_m - center.x_m
        by = second.y_m - center.y_m
        signed += ax * by - ay * bx
    if abs(signed) <= _EPSILON:
        return Direction.UNKNOWN
    return Direction.COUNTERCLOCKWISE if signed > 0 else Direction.CLOCKWISE


def _estimate_period_seconds(
    samples: Sequence[_SamplePoint],
    mask: Sequence[bool],
    *,
    route_length_m: float,
    completed_cycles: float,
) -> float:
    velocity_speeds = tuple(
        math.hypot(float(item.sample.velocity_east_mps), float(item.sample.velocity_north_mps))
        for item, keep in zip(samples, mask, strict=True)
        if keep
        and item.sample.velocity_east_mps is not None
        and item.sample.velocity_north_mps is not None
        and math.hypot(float(item.sample.velocity_east_mps), float(item.sample.velocity_north_mps)) > _EPSILON
    )
    if velocity_speeds:
        return route_length_m / statistics.median(velocity_speeds)

    derived_speeds: list[float] = []
    previous: _SamplePoint | None = None
    for item, keep in zip(samples, mask, strict=True):
        if not keep:
            continue
        if previous is not None:
            dt = (item.sample.sample_time_utc - previous.sample.sample_time_utc).total_seconds()
            if dt > 0:
                speed = _distance(previous.point, item.point) / dt
                if speed > _EPSILON:
                    derived_speeds.append(speed)
        previous = item
    if derived_speeds:
        return route_length_m / statistics.median(derived_speeds)

    duration = (samples[-1].sample.sample_time_utc - samples[0].sample.sample_time_utc).total_seconds()
    if duration <= 0:
        return 0.0
    return duration / max(completed_cycles, _EPSILON)


def _travelled_distance(points: Sequence[CanonicalPoint]) -> float:
    return sum(_distance(first, second) for first, second in zip(points, points[1:]))


def _distance(first: CanonicalPoint, second: CanonicalPoint) -> float:
    return math.hypot(second.x_m - first.x_m, second.y_m - first.y_m)


def _quantile(values: Sequence[float], fraction: float) -> float:
    if not values:
        raise ValueError("quantile requires at least one value")
    if not 0.0 <= fraction <= 1.0:
        raise ValueError("fraction must be in [0, 1]")
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = fraction * (len(ordered) - 1)
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight
