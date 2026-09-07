"""Closed-route dispatcher preserving the proven simple fitter.

Hierarchical SO topologies get first refusal only when cheap topological evidence
makes them plausible, then the original SI/simple-SO detector runs unchanged.
Candidate acquisition stays simple until enough topology exists to prove a
higher-order route.
"""

from __future__ import annotations

import math
import statistics
from typing import Iterable

from .config import DetectionConfig
from .geometry import vector_angle_error_deg, wgs84_to_local_m
from .models import RouteFamily, VehicleSample
from .simple_route_detection import RouteDetection, detect_closed_route as _detect_simple


_EPSILON = 1e-9


def detect_closed_route(
    samples: Iterable[VehicleSample],
    config: DetectionConfig | None = None,
    *,
    require_confirmation: bool = True,
) -> RouteDetection | None:
    """Detect the strongest supported closed-route topology.

    A cheap spatial/heading revisit gate decides whether Double Hippodrome is
    even plausible. This keeps ordinary SI/SO confirmation inexpensive. When an
    opposite-heading revisit exists, a full topology proof gets first refusal;
    until it succeeds, a simple SO fit is not confirmed from the same ambiguous
    evidence window.
    """

    detection = config or DetectionConfig()
    frozen = tuple(samples)
    double_evidence = require_confirmation and _has_opposite_heading_revisit(
        frozen,
        detection,
    )

    if double_evidence:
        from .double_hippodrome import detect_double_hippodrome

        double = detect_double_hippodrome(frozen, detection)
        if double is not None:
            observation_seconds = (
                double.cycle_end_utc - double.cycle_start_utc
            ).total_seconds()
            route = double.effective
            return RouteDetection(
                observed=double.observed,
                effective=route,
                fit_fraction=double.fit_fraction,
                inlier_fraction=double.fit_fraction,
                coverage_fraction=double.coverage_fraction,
                completed_cycles=1.0,
                outlier_count=0,
                diagnostics={
                    "candidate_ready": True,
                    "confirmation_ready": True,
                    "closure_ok": True,
                    "double_topology": True,
                    "opposite_revisit_evidence": True,
                    "sample_count": len(frozen),
                    "effective_sample_count": len(frozen),
                    "observation_seconds": observation_seconds,
                    "axis_ratio": route.long_axis_a_m / route.short_axis_b_m,
                    "fit_tolerance_m": 0.0,
                    "travelled_distance_m": route.length_m,
                    "coverage_fraction": double.coverage_fraction,
                },
            )

    simple = _detect_simple(
        frozen,
        detection,
        require_confirmation=require_confirmation,
    )
    if simple is None:
        return None

    # An opposite-heading revisit is incompatible with a completed simple SO
    # cycle: a real single hippodrome returns to a point with the same tangent
    # direction. Once this evidence appears, keep the route unconfirmed until
    # the second lobe is proven rather than publishing a transient Single.
    if (
        require_confirmation
        and double_evidence
        and simple.effective.family is RouteFamily.SO
    ):
        return None
    return simple


def _has_opposite_heading_revisit(
    samples: tuple[VehicleSample, ...],
    config: DetectionConfig,
) -> bool:
    """Return True when geometry contains a plausible lobe connection revisit.

    Positions are indexed in a tolerance-sized spatial hash, so ordinary route
    checks are near O(n) instead of invoking the O(n^2) Double topology search.
    The gate is evidence-only: elapsed time supplies a minimum separation but
    never a confirmation timer.
    """

    usable = tuple(
        sample
        for sample in samples
        if sample.active is not False
        and sample.latitude_deg is not None
        and sample.longitude_deg is not None
        and sample.reliability > 0.0
    )
    if len(usable) < 12:
        return False

    origin_lat = float(usable[0].latitude_deg)
    origin_lon = float(usable[0].longitude_deg)
    points = tuple(
        wgs84_to_local_m(
            float(sample.latitude_deg),
            float(sample.longitude_deg),
            origin_lat,
            origin_lon,
        )
        for sample in usable
    )
    positive_steps = tuple(
        math.hypot(second.x_m - first.x_m, second.y_m - first.y_m)
        for first, second in zip(points, points[1:])
        if math.hypot(second.x_m - first.x_m, second.y_m - first.y_m) > _EPSILON
    )
    median_step = statistics.median(positive_steps) if positive_steps else 0.0
    tolerance = max(4.0, min(15.0, 2.0 * median_step))
    cell_size = max(tolerance, 1.0)
    minimum_separation_s = max(20.0, float(config.adaptive_min_window_seconds))
    buckets: dict[tuple[int, int], list[int]] = {}

    for index, (sample, point) in enumerate(zip(usable, points, strict=True)):
        cell_x = math.floor(point.x_m / cell_size)
        cell_y = math.floor(point.y_m / cell_size)
        current_velocity = _velocity(sample)
        if current_velocity is not None:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for previous_index in buckets.get((cell_x + dx, cell_y + dy), ()):
                        previous = usable[previous_index]
                        elapsed = (
                            sample.sample_time_utc - previous.sample_time_utc
                        ).total_seconds()
                        if elapsed < minimum_separation_s:
                            continue
                        previous_point = points[previous_index]
                        if (
                            math.hypot(
                                point.x_m - previous_point.x_m,
                                point.y_m - previous_point.y_m,
                            )
                            > tolerance
                        ):
                            continue
                        previous_velocity = _velocity(previous)
                        if previous_velocity is None:
                            continue
                        if (
                            vector_angle_error_deg(
                                previous_velocity[0],
                                previous_velocity[1],
                                current_velocity[0],
                                current_velocity[1],
                            )
                            >= 120.0
                        ):
                            return True
        buckets.setdefault((cell_x, cell_y), []).append(index)
    return False


def _velocity(sample: VehicleSample) -> tuple[float, float] | None:
    if sample.velocity_east_mps is None or sample.velocity_north_mps is None:
        return None
    east = float(sample.velocity_east_mps)
    north = float(sample.velocity_north_mps)
    if math.hypot(east, north) <= _EPSILON:
        return None
    return east, north
