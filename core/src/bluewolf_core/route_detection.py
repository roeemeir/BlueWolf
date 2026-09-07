"""Closed-route dispatcher preserving the proven simple fitter.

Hierarchical SO topologies get first refusal at strict confirmation, then the
original SI/simple-SO detector runs unchanged. Candidate acquisition stays
simple until enough topology exists to prove a double route.
"""

from __future__ import annotations

import math
from typing import Iterable

from .config import DetectionConfig
from .geometry import vector_angle_error_deg, wgs84_to_local_m
from .models import ClosedRoute, VehicleSample
from .simple_route_detection import RouteDetection, detect_closed_route as _detect_simple


_EPSILON = 1e-9


def detect_closed_route(
    samples: Iterable[VehicleSample],
    config: DetectionConfig | None = None,
    *,
    require_confirmation: bool = True,
) -> RouteDetection | None:
    """Detect the strongest supported closed-route topology.

    Strict confirmation checks double hippodrome topology before invoking the
    unchanged simple SI/SO fitter. The double detector itself validates each
    lobe directly with the simple fitter, so this dispatcher never recurses.
    """

    detection = config or DetectionConfig()
    frozen = tuple(samples)

    if require_confirmation:
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
                    "sample_count": len(frozen),
                    "effective_sample_count": len(frozen),
                    "observation_seconds": observation_seconds,
                    "axis_ratio": route.long_axis_a_m / route.short_axis_b_m,
                    "fit_tolerance_m": 0.0,
                    "travelled_distance_m": route.length_m,
                    "coverage_fraction": double.coverage_fraction,
                    "endpoint_velocity_ok": True,
                },
            )

    simple = _detect_simple(
        frozen,
        detection,
        require_confirmation=require_confirmation,
    )
    if simple is None:
        return None
    if not require_confirmation:
        return simple

    # A half-double traces a geometrically valid single lobe and returns to the
    # same connection point, but its physical velocity reverses there because
    # the next lobe begins. Reject only that specific spatial revisit pattern.
    # Non-integer windows (for example 1.25 cycles) keep their valid simple fit.
    if not _endpoint_revisit_velocity_consistent(
        frozen,
        simple.effective,
        detection,
    ):
        return None

    diagnostics = dict(simple.diagnostics)
    diagnostics["endpoint_velocity_ok"] = True
    return RouteDetection(
        observed=simple.observed,
        effective=simple.effective,
        fit_fraction=simple.fit_fraction,
        inlier_fraction=simple.inlier_fraction,
        coverage_fraction=simple.coverage_fraction,
        completed_cycles=simple.completed_cycles,
        outlier_count=simple.outlier_count,
        diagnostics=diagnostics,
    )


def _endpoint_revisit_velocity_consistent(
    samples: tuple[VehicleSample, ...],
    route: ClosedRoute,
    config: DetectionConfig,
) -> bool:
    usable = tuple(
        sample
        for sample in samples
        if sample.active is not False
        and sample.latitude_deg is not None
        and sample.longitude_deg is not None
        and sample.reliability > 0.0
    )
    if len(usable) < 2:
        return False

    first_sample = usable[0]
    last_sample = usable[-1]
    displacement = wgs84_to_local_m(
        float(last_sample.latitude_deg),
        float(last_sample.longitude_deg),
        float(first_sample.latitude_deg),
        float(first_sample.longitude_deg),
    )
    revisit_distance = math.hypot(displacement.x_m, displacement.y_m)
    revisit_tolerance = max(
        1.0,
        route.short_axis_b_m * config.closure_distance_short_axis_ratio,
    )
    if revisit_distance > revisit_tolerance:
        return True

    first_velocity = _velocity(first_sample)
    last_velocity = _velocity(last_sample)
    if first_velocity is None or last_velocity is None:
        return True
    return (
        vector_angle_error_deg(
            first_velocity[0],
            first_velocity[1],
            last_velocity[0],
            last_velocity[1],
        )
        <= config.closure_direction_error_deg
    )


def _velocity(sample: VehicleSample) -> tuple[float, float] | None:
    if sample.velocity_east_mps is None or sample.velocity_north_mps is None:
        return None
    east = float(sample.velocity_east_mps)
    north = float(sample.velocity_north_mps)
    if math.hypot(east, north) <= _EPSILON:
        return None
    return east, north
