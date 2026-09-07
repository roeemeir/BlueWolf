"""Evidence-based detection of a self-crossing SO figure-eight route."""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Sequence

from .config import DetectionConfig
from .geometry import (
    closed_polyline_length,
    local_m_to_wgs84,
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


_EPSILON = 1e-9
_MIN_LOBE_SAMPLES = 24


@dataclass(frozen=True, slots=True)
class FigureEightDetection:
    """Confirmed self-crossing route and evidence used to prove its topology."""

    observed: ClosedRoute
    effective: ClosedRoute
    fit_fraction: float
    coverage_fraction: float
    crossing_time_utc: datetime
    cycle_start_utc: datetime
    cycle_end_utc: datetime
    crossing_angle_deg: float


def detect_figure_eight(
    samples: Iterable[VehicleSample],
    config: DetectionConfig | None = None,
) -> FigureEightDetection | None:
    """Confirm a self-crossing SO route without creating new sync semantics.

    A figure-eight must revisit one physical crossing three times over a full
    cycle. Start and end tangents agree; the middle tangent crosses at a
    material non-parallel, non-opposite angle. The two intervals around the
    middle revisit must form spatially separated lobes with opposite winding.
    The returned route is ``family=SO`` so templates/scoring use ordinary
    Single-SO laws; subtype/topology preserve geometry for route display/GT.
    """

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
    if len(ordered) < 2 * _MIN_LOBE_SAMPLES + 1:
        return None
    if len({sample.stream_key for sample in ordered}) != 1:
        raise ValueError("detect_figure_eight expects exactly one vehicle stream")

    origin_lat = statistics.median(float(sample.latitude_deg) for sample in ordered)
    origin_lon = statistics.median(float(sample.longitude_deg) for sample in ordered)
    points = tuple(
        wgs84_to_local_m(
            float(sample.latitude_deg),
            float(sample.longitude_deg),
            origin_lat,
            origin_lon,
        )
        for sample in ordered
    )
    crossing = _find_crossing_triplet(ordered, points, detection)
    if crossing is None:
        return None
    first_index, middle_index, last_index, crossing_angle = crossing

    first_lobe = points[first_index : middle_index + 1]
    second_lobe = points[middle_index : last_index + 1]
    crossing_point = _mean_point(
        (points[first_index], points[middle_index], points[last_index])
    )
    if not _lobes_prove_self_crossing(first_lobe, second_lobe, crossing_point):
        return None

    center_lat, center_lon = local_m_to_wgs84(
        crossing_point,
        origin_lat,
        origin_lon,
    )
    trace = tuple(
        CanonicalPoint(point.x_m - crossing_point.x_m, point.y_m - crossing_point.y_m)
        for point in points[first_index:last_index]
    )
    if len(trace) < 3:
        return None
    try:
        canonical = resample_closed_polyline(
            trace,
            min(detection.canonical_point_limit, 64),
        )
    except ValueError:
        return None

    orientation_deg, long_axis, short_axis = _principal_extents(trace)
    if short_axis <= _EPSILON or long_axis <= short_axis:
        return None

    period_s = (
        ordered[last_index].sample_time_utc
        - ordered[first_index].sample_time_utc
    ).total_seconds()
    if period_s <= 0:
        return None

    half_one = (
        ordered[middle_index].sample_time_utc
        - ordered[first_index].sample_time_utc
    ).total_seconds()
    half_two = (
        ordered[last_index].sample_time_utc
        - ordered[middle_index].sample_time_utc
    ).total_seconds()
    balance = 1.0 - abs(half_one - half_two) / max(half_one, half_two, _EPSILON)
    quality = max(0.0, min(1.0, 0.65 + 0.20 * balance + 0.15 * _crossing_quality(crossing_angle)))

    route_id = f"{ordered[0].server_id}:{ordered[0].vehicle_identifier}:figure8"
    route = ClosedRoute(
        route_id=route_id,
        family=RouteFamily.SO,
        subtype=RouteSubtype.FIGURE_EIGHT,
        topology=RouteTopology.SELF_CROSSING,
        canonical_points=canonical,
        center_latitude_deg=center_lat,
        center_longitude_deg=center_lon,
        length_m=closed_polyline_length(canonical),
        long_axis_a_m=long_axis,
        short_axis_b_m=short_axis,
        orientation_deg=orientation_deg,
        estimated_period_s=period_s,
        direction=Direction.UNKNOWN,
        detection_quality=quality,
    )
    return FigureEightDetection(
        observed=route,
        effective=route,
        fit_fraction=quality,
        coverage_fraction=1.0,
        crossing_time_utc=ordered[middle_index].sample_time_utc,
        cycle_start_utc=ordered[first_index].sample_time_utc,
        cycle_end_utc=ordered[last_index].sample_time_utc,
        crossing_angle_deg=crossing_angle,
    )


def _find_crossing_triplet(
    samples: Sequence[VehicleSample],
    points: Sequence[CanonicalPoint],
    config: DetectionConfig,
) -> tuple[int, int, int, float] | None:
    positive_steps = tuple(
        _distance(first, second)
        for first, second in zip(points, points[1:])
        if _distance(first, second) > _EPSILON
    )
    median_step = statistics.median(positive_steps) if positive_steps else 0.0
    position_tolerance = max(4.0, min(15.0, 2.0 * median_step))
    minimum_half_seconds = max(20.0, float(config.adaptive_min_window_seconds))

    best: tuple[float, int, int, int, float] | None = None
    for first_index in range(0, len(samples) - 2 * _MIN_LOBE_SAMPLES):
        first_heading = _velocity(samples[first_index])
        if first_heading is None:
            continue
        middle_candidates: list[tuple[int, float, float]] = []
        for index in range(first_index + _MIN_LOBE_SAMPLES, len(samples)):
            revisit_distance = _distance(points[first_index], points[index])
            if revisit_distance > position_tolerance:
                continue
            heading = _velocity(samples[index])
            if heading is None:
                continue
            elapsed = (
                samples[index].sample_time_utc - samples[first_index].sample_time_utc
            ).total_seconds()
            if elapsed < minimum_half_seconds:
                continue
            heading_error = vector_angle_error_deg(
                first_heading[0], first_heading[1], heading[0], heading[1]
            )
            if 35.0 <= heading_error <= 145.0:
                middle_candidates.append((index, revisit_distance, heading_error))
                continue
            if heading_error > 35.0 or index - first_index < 2 * _MIN_LOBE_SAMPLES:
                continue

            for middle_index, middle_distance, crossing_angle in middle_candidates:
                if index - middle_index < _MIN_LOBE_SAMPLES:
                    continue
                first_half = (
                    samples[middle_index].sample_time_utc
                    - samples[first_index].sample_time_utc
                ).total_seconds()
                second_half = (
                    samples[index].sample_time_utc
                    - samples[middle_index].sample_time_utc
                ).total_seconds()
                if min(first_half, second_half) < minimum_half_seconds:
                    continue
                balance_error = abs(first_half - second_half) / max(
                    first_half, second_half, _EPSILON
                )
                if balance_error > 0.25:
                    continue
                score = (
                    balance_error
                    + revisit_distance / position_tolerance
                    + middle_distance / position_tolerance
                    + abs(crossing_angle - 90.0) / 180.0
                )
                candidate = (
                    score,
                    first_index,
                    middle_index,
                    index,
                    crossing_angle,
                )
                if best is None or candidate < best:
                    best = candidate
    if best is None:
        return None
    _, first_index, middle_index, last_index, crossing_angle = best
    return first_index, middle_index, last_index, crossing_angle


def _lobes_prove_self_crossing(
    first_lobe: Sequence[CanonicalPoint],
    second_lobe: Sequence[CanonicalPoint],
    crossing: CanonicalPoint,
) -> bool:
    if len(first_lobe) < _MIN_LOBE_SAMPLES or len(second_lobe) < _MIN_LOBE_SAMPLES:
        return False
    first_area = _signed_area(first_lobe, crossing)
    second_area = _signed_area(second_lobe, crossing)
    if abs(first_area) <= _EPSILON or abs(second_area) <= _EPSILON:
        return False
    if first_area * second_area >= 0:
        return False

    first_center = _mean_point(first_lobe[1:-1] or first_lobe)
    second_center = _mean_point(second_lobe[1:-1] or second_lobe)
    first_vector = (
        first_center.x_m - crossing.x_m,
        first_center.y_m - crossing.y_m,
    )
    second_vector = (
        second_center.x_m - crossing.x_m,
        second_center.y_m - crossing.y_m,
    )
    first_norm = math.hypot(*first_vector)
    second_norm = math.hypot(*second_vector)
    if min(first_norm, second_norm) <= _EPSILON:
        return False
    cosine = (
        first_vector[0] * second_vector[0] + first_vector[1] * second_vector[1]
    ) / (first_norm * second_norm)
    return cosine <= -0.5


def _signed_area(points: Sequence[CanonicalPoint], crossing: CanonicalPoint) -> float:
    closed = (crossing,) + tuple(points[1:-1]) + (crossing,)
    return 0.5 * sum(
        first.x_m * second.y_m - first.y_m * second.x_m
        for first, second in zip(closed, closed[1:])
    )


def _principal_extents(
    points: Sequence[CanonicalPoint],
) -> tuple[float, float, float]:
    xx = statistics.fmean(point.x_m * point.x_m for point in points)
    yy = statistics.fmean(point.y_m * point.y_m for point in points)
    xy = statistics.fmean(point.x_m * point.y_m for point in points)
    angle = 0.5 * math.atan2(2.0 * xy, xx - yy)
    cosine = math.cos(angle)
    sine = math.sin(angle)
    along = tuple(point.x_m * cosine + point.y_m * sine for point in points)
    across = tuple(-point.x_m * sine + point.y_m * cosine for point in points)
    long_axis = _robust_abs_extent(along)
    short_axis = _robust_abs_extent(across)
    if short_axis > long_axis:
        long_axis, short_axis = short_axis, long_axis
        angle += math.pi / 2.0
    return math.degrees(angle) % 180.0, long_axis, short_axis


def _robust_abs_extent(values: Sequence[float]) -> float:
    ordered = sorted(abs(value) for value in values)
    if not ordered:
        return 0.0
    index = min(int(round(0.99 * (len(ordered) - 1))), len(ordered) - 1)
    return max(ordered[index], _EPSILON)


def _crossing_quality(angle_deg: float) -> float:
    return max(0.0, 1.0 - abs(angle_deg - 90.0) / 55.0)


def _mean_point(points: Sequence[CanonicalPoint]) -> CanonicalPoint:
    return CanonicalPoint(
        statistics.fmean(point.x_m for point in points),
        statistics.fmean(point.y_m for point in points),
    )


def _velocity(sample: VehicleSample) -> tuple[float, float] | None:
    if sample.velocity_east_mps is None or sample.velocity_north_mps is None:
        return None
    east = float(sample.velocity_east_mps)
    north = float(sample.velocity_north_mps)
    if math.hypot(east, north) <= _EPSILON:
        return None
    return east, north


def _distance(first: CanonicalPoint, second: CanonicalPoint) -> float:
    return math.hypot(second.x_m - first.x_m, second.y_m - first.y_m)
