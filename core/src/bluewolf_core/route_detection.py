"""Closed-route dispatcher preserving the proven simple fitter.

The dispatcher gives hierarchical SO topologies first refusal at strict
confirmation, then falls back to the original SI/simple-SO detector unchanged.
Candidate acquisition remains simple for now so partial double evidence cannot
be promoted before a complete double topology has been observed.
"""

from __future__ import annotations

import math
from contextvars import ContextVar
from typing import Iterable

from .config import DetectionConfig
from .geometry import vector_angle_error_deg
from .models import VehicleSample
from .simple_route_detection import RouteDetection, detect_closed_route as _detect_simple


_DOUBLE_SEARCH_ACTIVE: ContextVar[bool] = ContextVar(
    "bluewolf_double_route_search_active",
    default=False,
)
_EPSILON = 1e-9


def detect_closed_route(
    samples: Iterable[VehicleSample],
    config: DetectionConfig | None = None,
    *,
    require_confirmation: bool = True,
) -> RouteDetection | None:
    """Detect the strongest supported closed-route topology.

    Strict confirmation checks double hippodrome topology before invoking the
    unchanged simple SI/SO fitter. While the double detector validates its two
    lobes it recursively calls this public function; a context-local guard sends
    those nested calls straight to the simple fitter, avoiding recursion without
    global mutable state or monkey-patching.
    """

    detection = config or DetectionConfig()
    frozen = tuple(samples)
    nested_double_search = _DOUBLE_SEARCH_ACTIVE.get()

    if require_confirmation and not nested_double_search:
        token = _DOUBLE_SEARCH_ACTIVE.set(True)
        try:
            from .double_hippodrome import detect_double_hippodrome

            double = detect_double_hippodrome(frozen, detection)
        finally:
            _DOUBLE_SEARCH_ACTIVE.reset(token)

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

    # Nested calls are the two lobe fits used to prove a double. At the shared
    # connection the next sample belongs to the next lobe, so endpoint velocity
    # is not a valid single-lobe closure condition for those internal fits.
    if nested_double_search or not require_confirmation:
        return simple

    if not _endpoint_velocity_consistent(frozen, detection):
        return None
    if bool(simple.diagnostics.get("endpoint_velocity_ok", True)):
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
    return simple


def _endpoint_velocity_consistent(
    samples: tuple[VehicleSample, ...],
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

    first = _velocity(usable[0])
    last = _velocity(usable[-1])
    if first is None or last is None:
        return True
    return (
        vector_angle_error_deg(first[0], first[1], last[0], last[1])
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
