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
    new-route geometry has accumulated, while the emitted change time points
    back to the structural transition. Three consecutive usable samples are
    required to reject a single GPS excursion; this is a robustness count, not
    an elapsed-time confirmation timer.
    """

    old_canonical = _centered_canonical(previous)
    new_canonical = _centered_canonical(current)
    old_tolerance = max(previous.short_axis_b_m * 0.15, 2.0)
    new_tolerance = max(current.short_axis_b_m * 0.20, 2.0)

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

    # Search slightly before the evidence suffix as well. This recovers the
    # beginning of a change when the shortest confirmation suffix starts after
    # the first few new-route samples.
    search_margin = max(
        previous.estimated_period_s,
        current.estimated_period_s,
        float(config.adaptive_min_window_seconds),
    ) * 0.35
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

        new_explains = new_distance <= new_tolerance
        old_explains = old_distance <= old_tolerance
        if new_explains and not old_explains:
            if streak_start is None:
                streak_start = sample.sample_time_utc
            streak_count += 1
            if streak_count >= 3:
                return streak_start
        elif old_explains and not new_explains:
            streak_start = None
            streak_count = 0
        elif not new_explains:
            streak_start = None
            streak_count = 0

    return evidence_start_utc


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
