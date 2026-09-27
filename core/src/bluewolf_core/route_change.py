"""Evidence-driven comparison and onset estimation for confirmed route changes."""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from datetime import datetime
from typing import Sequence

from .config import DetectionConfig
from .geometry import (
    project_onto_closed_polyline,
    vector_angle_error_deg,
    wgs84_to_local_m,
)
from .models import CanonicalPoint, ClosedRoute, Direction, RouteFamily, VehicleSample


_EPSILON = 1e-9
_GEOMETRY_REASONS = frozenset(
    {"family", "subtype", "topology", "center", "long_axis", "short_axis", "orientation"}
)


@dataclass(frozen=True, slots=True)
class RouteDelta:
    """Normalized difference between two fitted routes."""

    changed: bool
    reasons: tuple[str, ...]
    center_short_axis_ratio: float
    long_axis_ratio: float
    short_axis_ratio: float
    period_ratio: float
    orientation_error_deg: float


def route_change_suspected(
    sample: VehicleSample,
    route: ClosedRoute,
    config: DetectionConfig,
) -> bool:
    """Cheaply decide whether an expensive replacement search is justified.

    A stable confirmed route should not be re-fit every five seconds. This gate
    checks only the current point, speed and direction against the confirmed
    route. It never confirms a change; it merely opens the expensive adaptive
    multi-window search when the current route stops explaining the motion.

    V2 canonical points are ordered by observed phase/time, so the polyline
    tangent already represents ``route.direction``. Do not flip clockwise
    tangents a second time.
    """

    if (
        sample.active is False
        or sample.latitude_deg is None
        or sample.longitude_deg is None
    ):
        return False

    canonical = _centered_canonical(route)
    if len(canonical) < 3:
        return True
    local = wgs84_to_local_m(
        float(sample.latitude_deg),
        float(sample.longitude_deg),
        route.center_latitude_deg,
        route.center_longitude_deg,
    )
    projection = project_onto_closed_polyline(canonical, local)

    position_gate = max(route.short_axis_b_m * 0.25, 3.0)
    if projection.distance_m > position_gate:
        return True

    speed = _sample_speed(sample)
    if speed is not None:
        expected_speed = route.length_m / max(route.estimated_period_s, _EPSILON)
        if expected_speed > _EPSILON:
            speed_error = abs(speed - expected_speed) / expected_speed
            speed_gate = max(0.15, config.period_change_ratio * 0.75)
            if speed_error > speed_gate:
                return True

    if (
        route.direction is not Direction.UNKNOWN
        and sample.velocity_east_mps is not None
        and sample.velocity_north_mps is not None
    ):
        east = float(sample.velocity_east_mps)
        north = float(sample.velocity_north_mps)
        if math.hypot(east, north) > _EPSILON:
            direction_error = vector_angle_error_deg(
                east,
                north,
                projection.tangent_east,
                projection.tangent_north,
            )
            if direction_error > max(
                45.0,
                config.closure_direction_error_deg * 1.5,
            ):
                return True

    return False


def compare_routes(
    previous: ClosedRoute,
    current: ClosedRoute,
    config: DetectionConfig,
) -> RouteDelta:
    """Decide whether ``current`` is materially different from ``previous``."""

    local_center = wgs84_to_local_m(
        current.center_latitude_deg,
        current.center_longitude_deg,
        previous.center_latitude_deg,
        previous.center_longitude_deg,
    )
    center_distance = math.hypot(local_center.x_m, local_center.y_m)
    center_scale = max(
        previous.short_axis_b_m,
        current.short_axis_b_m,
        _EPSILON,
    )
    center_ratio = center_distance / center_scale
    long_ratio = _relative_change(previous.long_axis_a_m, current.long_axis_a_m)
    short_ratio = _relative_change(previous.short_axis_b_m, current.short_axis_b_m)
    period_ratio = _relative_change(
        previous.estimated_period_s,
        current.estimated_period_s,
    )
    orientation_error = _axis_orientation_error_deg(
        previous.orientation_deg,
        current.orientation_deg,
    )

    reasons: list[str] = []
    if previous.family is not current.family:
        reasons.append("family")
    if previous.subtype is not current.subtype:
        reasons.append("subtype")
    if previous.topology is not current.topology:
        reasons.append("topology")
    if (
        previous.direction is not Direction.UNKNOWN
        and current.direction is not Direction.UNKNOWN
        and previous.direction is not current.direction
    ):
        reasons.append("direction")

    geometry_threshold = config.geometry_change_ratio
    if center_ratio + _EPSILON >= geometry_threshold:
        reasons.append("center")
    if long_ratio + _EPSILON >= geometry_threshold:
        reasons.append("long_axis")
    if short_ratio + _EPSILON >= geometry_threshold:
        reasons.append("short_axis")
    if period_ratio + _EPSILON >= config.period_change_ratio:
        reasons.append("period")

    if (
        previous.family is RouteFamily.SO or current.family is RouteFamily.SO
    ) and orientation_error + _EPSILON >= geometry_threshold * 90.0:
        reasons.append("orientation")

    return RouteDelta(
        changed=bool(reasons),
        reasons=tuple(reasons),
        center_short_axis_ratio=center_ratio,
        long_axis_ratio=long_ratio,
        short_axis_ratio=short_ratio,
        period_ratio=period_ratio,
        orientation_error_deg=orientation_error,
    )


def replacement_evidence_supports_new_route(
    history: Sequence[VehicleSample],
    evidence_start_utc: datetime,
    previous: ClosedRoute,
    current: ClosedRoute,
    reasons: Sequence[str],
    config: DetectionConfig,
) -> bool:
    """Require the evidence window to prefer the replacement over the old fit.

    A strict closed-route fit can still move because a suffix contains a
    non-integer number of cycles and therefore over-samples one phase region.
    Geometry changes are accepted only when decisive position residuals in the
    candidate window predominantly prefer the new route. Period changes use the
    analogous expected-speed comparison. These are evidence-purity gates, not
    elapsed-time holds.
    """

    reason_set = set(reasons)
    if reason_set & _GEOMETRY_REASONS:
        old_canonical = _centered_canonical(previous)
        new_canonical = _centered_canonical(current)
        if len(old_canonical) < 3 or len(new_canonical) < 3:
            return False

        decisive = 0
        supports_new = 0
        geometry_margin_m = max(
            min(previous.short_axis_b_m, current.short_axis_b_m)
            * config.geometry_change_ratio
            * 0.25,
            1.0,
        )
        for sample in history:
            if sample.sample_time_utc < evidence_start_utc:
                continue
            if (
                sample.active is False
                or sample.latitude_deg is None
                or sample.longitude_deg is None
                or sample.reliability <= 0.0
            ):
                continue
            old_local = wgs84_to_local_m(
                float(sample.latitude_deg),
                float(sample.longitude_deg),
                previous.center_latitude_deg,
                previous.center_longitude_deg,
            )
            new_local = wgs84_to_local_m(
                float(sample.latitude_deg),
                float(sample.longitude_deg),
                current.center_latitude_deg,
                current.center_longitude_deg,
            )
            old_distance = project_onto_closed_polyline(
                old_canonical,
                old_local,
            ).distance_m
            new_distance = project_onto_closed_polyline(
                new_canonical,
                new_local,
            ).distance_m
            if abs(old_distance - new_distance) < geometry_margin_m:
                continue
            decisive += 1
            if new_distance < old_distance:
                supports_new += 1

        if decisive < config.replacement_min_decisive_speed_samples:
            return False
        if (
            supports_new / decisive
            < config.replacement_min_new_speed_support_fraction
        ):
            return False

    if "period" in reason_set:
        old_expected = previous.length_m / max(
            previous.estimated_period_s,
            _EPSILON,
        )
        new_expected = current.length_m / max(
            current.estimated_period_s,
            _EPSILON,
        )
        if old_expected <= _EPSILON or new_expected <= _EPSILON:
            return True

        decisive = 0
        supports_new = 0
        margin = config.replacement_speed_decision_margin
        for sample in history:
            if sample.sample_time_utc < evidence_start_utc:
                continue
            speed = _sample_speed(sample)
            if speed is None:
                continue
            old_error = abs(speed - old_expected) / old_expected
            new_error = abs(speed - new_expected) / new_expected
            if abs(old_error - new_error) < margin:
                continue
            decisive += 1
            if new_error < old_error:
                supports_new += 1

        if decisive < config.replacement_min_decisive_speed_samples:
            return False
        if (
            supports_new / decisive
            < config.replacement_min_new_speed_support_fraction
        ):
            return False

    return True


def estimate_change_onset(
    history: Sequence[VehicleSample],
    previous: ClosedRoute,
    current: ClosedRoute,
    evidence_start_utc: datetime,
    config: DetectionConfig,
) -> datetime:
    """Estimate the first sample explained by the new route but not the old.

    This is deliberately retrospective. Confirmation can happen after enough
    new-route evidence has accumulated, while the emitted change time points
    back to the structural transition. Position residuals identify geometry
    changes; speed-vs-period residuals identify period-only changes on the same
    geometry. Three consecutive usable samples reject a single GPS/velocity
    excursion; this is a robustness count, not an elapsed-time confirmation
    timer.
    """

    old_canonical = _centered_canonical(previous)
    new_canonical = _centered_canonical(current)
    old_tolerance = max(previous.short_axis_b_m * 0.15, 2.0)
    new_tolerance = max(current.short_axis_b_m * 0.20, 2.0)
    old_expected_speed = previous.length_m / max(
        previous.estimated_period_s,
        _EPSILON,
    )
    new_expected_speed = current.length_m / max(
        current.estimated_period_s,
        _EPSILON,
    )
    speed_preference_margin = min(0.08, config.period_change_ratio * 0.40)

    usable = [
        sample
        for sample in history
        if sample.active is not False
        and sample.latitude_deg is not None
        and sample.longitude_deg is not None
        and sample.reliability > 0.0
    ]
    if not usable:
        return evidence_start_utc

    search_margin = max(
        previous.estimated_period_s,
        current.estimated_period_s,
        float(config.adaptive_min_window_seconds),
    ) * 1.10
    search_from = evidence_start_utc.timestamp() - search_margin

    streak_start: datetime | None = None
    streak_count = 0
    for sample in usable:
        if sample.sample_time_utc.timestamp() < search_from:
            continue
        assert sample.latitude_deg is not None
        assert sample.longitude_deg is not None
        old_local = wgs84_to_local_m(
            float(sample.latitude_deg),
            float(sample.longitude_deg),
            previous.center_latitude_deg,
            previous.center_longitude_deg,
        )
        new_local = wgs84_to_local_m(
            float(sample.latitude_deg),
            float(sample.longitude_deg),
            current.center_latitude_deg,
            current.center_longitude_deg,
        )
        old_distance = project_onto_closed_polyline(old_canonical, old_local).distance_m
        new_distance = project_onto_closed_polyline(new_canonical, new_local).distance_m

        new_position_ok = new_distance <= new_tolerance
        old_position_ok = old_distance <= old_tolerance
        position_prefers_new = new_position_ok and not old_position_ok
        position_prefers_old = old_position_ok and not new_position_ok

        speed_prefers_new = False
        speed_prefers_old = False
        speed = _sample_speed(sample)
        if (
            speed is not None
            and old_expected_speed > _EPSILON
            and new_expected_speed > _EPSILON
        ):
            old_speed_error = abs(speed - old_expected_speed) / old_expected_speed
            new_speed_error = abs(speed - new_expected_speed) / new_expected_speed
            speed_prefers_new = (
                new_speed_error + speed_preference_margin < old_speed_error
            )
            speed_prefers_old = (
                old_speed_error + speed_preference_margin < new_speed_error
            )

        new_explains = position_prefers_new or (
            new_position_ok and old_position_ok and speed_prefers_new
        )
        old_explains = position_prefers_old or (
            new_position_ok and old_position_ok and speed_prefers_old
        )

        if new_explains and not old_explains:
            if streak_start is None:
                streak_start = sample.sample_time_utc
            streak_count += 1
            if streak_count >= 3:
                return streak_start
        elif old_explains and not new_explains:
            streak_start = None
            streak_count = 0
        elif not new_position_ok:
            streak_start = None
            streak_count = 0

    return evidence_start_utc


def _sample_speed(sample: VehicleSample) -> float | None:
    if sample.velocity_east_mps is None or sample.velocity_north_mps is None:
        return None
    speed = math.hypot(
        float(sample.velocity_east_mps),
        float(sample.velocity_north_mps),
    )
    return speed if speed > _EPSILON else None


def _centered_canonical(route: ClosedRoute) -> tuple[CanonicalPoint, ...]:
    if not route.canonical_points:
        return ()
    center_x = statistics.fmean(point.x_m for point in route.canonical_points)
    center_y = statistics.fmean(point.y_m for point in route.canonical_points)
    return tuple(
        CanonicalPoint(point.x_m - center_x, point.y_m - center_y)
        for point in route.canonical_points
    )


def _relative_change(previous: float, current: float) -> float:
    denominator = max(abs(previous), _EPSILON)
    return abs(current - previous) / denominator


def _axis_orientation_error_deg(first: float, second: float) -> float:
    difference = abs((second - first) % 180.0)
    return min(difference, 180.0 - difference)
