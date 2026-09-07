"""Evidence-based detection of two connected SO hippodrome lobes.

This module is deliberately separate from the generic closed-route detector.
A double hippodrome is not accepted from its outer envelope alone: the trace
must re-observe a physical connection, complete two independently valid SO
lobes, and show the expected shared-end geometry.
"""

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
from .route_detection import RouteDetection, detect_closed_route


_EPSILON = 1e-9
_MIN_LOBE_SAMPLES = 24


@dataclass(frozen=True, slots=True)
class DoubleHippodromeDetection:
    """Confirmed double route plus the two simple SO lobes that prove it."""

    observed: ClosedRoute
    effective: ClosedRoute
    lobes: tuple[ClosedRoute, ClosedRoute]
    fit_fraction: float
    coverage_fraction: float
    connection_time_utc: datetime
    cycle_start_utc: datetime
    cycle_end_utc: datetime


def detect_double_hippodrome(
    samples: Iterable[VehicleSample],
    config: DetectionConfig | None = None,
) -> DoubleHippodromeDetection | None:
    """Detect two adjacent hippodromes from topology, not an elongated envelope.

    The decisive evidence is a connection point observed three times over a
    complete double cycle. The first and third visits have matching velocity
    direction while the middle visit has the opposite direction. Each interval
    between visits must independently confirm as a simple SO hippodrome. The
    fitted lobes must be aligned and their facing turn centers must coincide.

    This intentionally requires a complete topological cycle. Candidate-level
    double acquisition will be added only after the confirmed topology is
    integrated into the main adaptive window search.
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
        raise ValueError(
            "detect_double_hippodrome expects samples from exactly one vehicle stream"
        )

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
    connection = _find_connection_triplet(ordered, points, detection)
    if connection is None:
        return None
    first_index, middle_index, last_index = connection

    first_detection = detect_closed_route(
        ordered[first_index : middle_index + 1],
        detection,
        require_confirmation=True,
    )
    second_detection = detect_closed_route(
        ordered[middle_index : last_index + 1],
        detection,
        require_confirmation=True,
    )
    if not _is_simple_so_lobe(first_detection) or not _is_simple_so_lobe(second_detection):
        return None
    assert first_detection is not None
    assert second_detection is not None
    first = first_detection.effective
    second = second_detection.effective

    if not _lobes_form_double(first, second, detection):
        return None

    center_lat, center_lon = _midpoint_wgs84(first, second)
    trace = tuple(
        wgs84_to_local_m(
            float(sample.latitude_deg),
            float(sample.longitude_deg),
            center_lat,
            center_lon,
        )
        for sample in ordered[first_index:last_index]
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

    center_distance = _center_distance(first, second)
    long_axis = (
        0.5 * center_distance
        + 0.5 * (first.long_axis_a_m + second.long_axis_a_m)
    )
    short_axis = 0.5 * (first.short_axis_b_m + second.short_axis_b_m)
    period = first.estimated_period_s + second.estimated_period_s
    quality = min(first.detection_quality, second.detection_quality)
    route_id = f"{ordered[0].server_id}:{ordered[0].vehicle_identifier}:double"
    effective = ClosedRoute(
        route_id=route_id,
        family=RouteFamily.SO,
        subtype=RouteSubtype.DOUBLE_HIPPODROME,
        topology=RouteTopology.DOUBLE,
        canonical_points=canonical,
        center_latitude_deg=center_lat,
        center_longitude_deg=center_lon,
        length_m=closed_polyline_length(canonical),
        long_axis_a_m=long_axis,
        short_axis_b_m=short_axis,
        orientation_deg=_mean_axis_orientation_deg(
            first.orientation_deg,
            second.orientation_deg,
        ),
        estimated_period_s=period,
        # A double contains two lobes with opposite winding. One global CW/CCW
        # label would discard real topology, so direction remains unknown.
        direction=Direction.UNKNOWN,
        detection_quality=quality,
    )

    fit_fraction = min(first_detection.fit_fraction, second_detection.fit_fraction)
    coverage_fraction = min(
        first_detection.coverage_fraction,
        second_detection.coverage_fraction,
    )
    return DoubleHippodromeDetection(
        observed=effective,
        effective=effective,
        lobes=(first, second),
        fit_fraction=fit_fraction,
        coverage_fraction=coverage_fraction,
        connection_time_utc=ordered[middle_index].sample_time_utc,
        cycle_start_utc=ordered[first_index].sample_time_utc,
        cycle_end_utc=ordered[last_index].sample_time_utc,
    )


def _find_connection_triplet(
    samples: Sequence[VehicleSample],
    points: Sequence[CanonicalPoint],
    config: DetectionConfig,
) -> tuple[int, int, int] | None:
    steps = [
        math.hypot(second.x_m - first.x_m, second.y_m - first.y_m)
        for first, second in zip(points, points[1:])
    ]
    positive_steps = [step for step in steps if step > _EPSILON]
    median_step = statistics.median(positive_steps) if positive_steps else 0.0
    position_tolerance = max(4.0, min(15.0, 2.0 * median_step))
    minimum_half_seconds = max(20.0, float(config.adaptive_min_window_seconds))

    for first_index in range(0, len(samples) - 2 * _MIN_LOBE_SAMPLES):
        first_heading = _velocity(samples[first_index])
        if first_heading is None:
            continue
        opposite_visits: list[int] = []
        for index in range(first_index + _MIN_LOBE_SAMPLES, len(samples)):
            if _distance(points[first_index], points[index]) > position_tolerance:
                continue
            heading = _velocity(samples[index])
            if heading is None:
                continue
            error = vector_angle_error_deg(
                first_heading[0],
                first_heading[1],
                heading[0],
                heading[1],
            )
            elapsed = (
                samples[index].sample_time_utc
                - samples[first_index].sample_time_utc
            ).total_seconds()
            if elapsed < minimum_half_seconds:
                continue
            if error >= 120.0:
                opposite_visits.append(index)
                continue
            if error > 35.0:
                continue

            for middle_index in reversed(opposite_visits):
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
                    first_half,
                    second_half,
                    _EPSILON,
                )
                if balance_error <= 0.25:
                    return first_index, middle_index, index
    return None


def _is_simple_so_lobe(detection: RouteDetection | None) -> bool:
    if detection is None:
        return False
    route = detection.effective
    return (
        route.family is RouteFamily.SO
        and route.subtype is RouteSubtype.HIPPODROME
        and route.topology is RouteTopology.SIMPLE
    )


def _lobes_form_double(
    first: ClosedRoute,
    second: ClosedRoute,
    config: DetectionConfig,
) -> bool:
    if (
        first.direction is not Direction.UNKNOWN
        and second.direction is not Direction.UNKNOWN
        and first.direction is second.direction
    ):
        return False

    orientation_error = _axis_error_deg(
        first.orientation_deg,
        second.orientation_deg,
    )
    if orientation_error > 15.0:
        return False

    if _relative_change(first.long_axis_a_m, second.long_axis_a_m) > 0.30:
        return False
    if _relative_change(first.short_axis_b_m, second.short_axis_b_m) > 0.30:
        return False
    if _relative_change(first.estimated_period_s, second.estimated_period_s) > 0.30:
        return False

    local_second = wgs84_to_local_m(
        second.center_latitude_deg,
        second.center_longitude_deg,
        first.center_latitude_deg,
        first.center_longitude_deg,
    )
    center_distance = math.hypot(local_second.x_m, local_second.y_m)
    if center_distance <= _EPSILON:
        return False

    center_axis_deg = math.degrees(math.atan2(local_second.y_m, local_second.x_m)) % 180.0
    if _axis_error_deg(center_axis_deg, first.orientation_deg) > 15.0:
        return False

    expected_center_distance = (
        max(first.long_axis_a_m - first.short_axis_b_m, 0.0)
        + max(second.long_axis_a_m - second.short_axis_b_m, 0.0)
    )
    if expected_center_distance <= _EPSILON:
        return False
    separation_error = abs(center_distance - expected_center_distance) / expected_center_distance
    # Geometry-change ratio is reused as the calibrated scale for how tightly
    # the two facing turn centers must coincide.
    return separation_error <= max(0.25, config.geometry_change_ratio)


def _midpoint_wgs84(first: ClosedRoute, second: ClosedRoute) -> tuple[float, float]:
    local_second = wgs84_to_local_m(
        second.center_latitude_deg,
        second.center_longitude_deg,
        first.center_latitude_deg,
        first.center_longitude_deg,
    )
    return local_m_to_wgs84(
        CanonicalPoint(local_second.x_m * 0.5, local_second.y_m * 0.5),
        first.center_latitude_deg,
        first.center_longitude_deg,
    )


def _center_distance(first: ClosedRoute, second: ClosedRoute) -> float:
    local = wgs84_to_local_m(
        second.center_latitude_deg,
        second.center_longitude_deg,
        first.center_latitude_deg,
        first.center_longitude_deg,
    )
    return math.hypot(local.x_m, local.y_m)


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


def _relative_change(first: float, second: float) -> float:
    return abs(second - first) / max(abs(first), abs(second), _EPSILON)


def _axis_error_deg(first: float, second: float) -> float:
    difference = abs((second - first) % 180.0)
    return min(difference, 180.0 - difference)


def _mean_axis_orientation_deg(first: float, second: float) -> float:
    first_rad = math.radians(first * 2.0)
    second_rad = math.radians(second * 2.0)
    x = math.cos(first_rad) + math.cos(second_rad)
    y = math.sin(first_rad) + math.sin(second_rad)
    if math.hypot(x, y) <= _EPSILON:
        return first % 180.0
    return (0.5 * math.degrees(math.atan2(y, x))) % 180.0
