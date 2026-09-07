"""Evidence-driven comparison and onset estimation for confirmed route changes."""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from datetime import datetime
from typing import Sequence

from .config import DetectionConfig
from .geometry import project_onto_closed_polyline, wgs84_to_local_m
from .models import CanonicalPoint, ClosedRoute, Direction, RouteFamily, VehicleSample


_EPSILON = 1e-9


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


def compare_routes(
    previous: ClosedRoute,
    current: ClosedRoute,
    config: DetectionConfig,
) -> RouteDelta:
    """Decide whether ``current`` is materially different from ``previous``.

    The existing 20% geometry/period values remain the initial calibration
    point, but no elapsed-time gate is involved. Topology/family/subtype and a
    known direction reversal are structural changes. For elongated SO routes,
    orientation is also meaningful; SI orientation is intentionally ignored.
    """

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

    # A circle has no stable principal-axis orientation. Orientation becomes a
    # change signal only when at least one fit is an elongated SO route.
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
    old_expected_speed = previous.length_m / max(previous.estimated_period_s, _EPSILON)
    new_expected_speed = current.length_m / max(current.estimated_period_s, _EPSILON)
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

    # Once the new route is confirmed, search one full route cycle before the
    # shortest evidence suffix. This is historical attribution, not a wait: it
    # lets the event start at the first new-route samples even when the shortest
    # confirmation suffix begins later in that cycle.
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
        if speed is not None and old_expected_speed > _EPSILON and new_expected_speed > _EPSILON:
            old_speed_error = abs(speed - old_expected_speed) / old_expected_speed
            new_speed_error = abs(speed - new_expected_speed) / new_expected_speed
            speed_prefers_new = (
                new_speed_error + speed_preference_margin < old_speed_error
            )
            speed_prefers_old = (
                old_speed_error + speed_preference_margin < new_speed_error
            )

        # Period evidence is allowed to decide only when both route geometries
        # explain the position. A wrong geometric route cannot win merely from
        # a coincidentally similar speed.
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
        # If both routes explain position and speed is temporarily ambiguous,
        # preserve an existing streak instead of converting one noisy velocity
        # sample into a false reset.

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
    """Normalize stored canonical coordinates to the route-center frame.

    Detection V2 stores canonical geometry in a local acquisition frame while
    the public route center is WGS84. Re-centering here makes residual tests
    robust to a non-zero fitted center without changing the serialized route
    contract.
    """

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
