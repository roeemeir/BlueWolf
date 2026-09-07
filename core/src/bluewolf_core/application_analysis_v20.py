"""v2.0 disturbance-estimator refinement.

The v1.9 estimator already selects the correct local route branch. This module
also learns the nominal speed from historical NAV travelling on that same local
directed leg. Using one whole-route mean speed can leave a tangential residual
larger than a small real disturbance and rotate the estimated vector even when
its magnitude is reasonable.

All evidence remains NAV-only; simulator GT is not imported or referenced.
"""

from __future__ import annotations

import math
from typing import Any, Mapping

from . import application_analysis_v19 as _v19

_base = _v19._base
_V19_WIND_ESTIMATE = _base._wind_estimate


def _local_nominal_speed(track: Any, heading_deg: float) -> float:
    samples = track.samples
    training = samples[: max(3, int(len(samples) * 0.8))]
    candidates: list[float] = []
    for sample in training:
        east = float(sample.get("velocityEast", 0.0))
        north = float(sample.get("velocityNorth", 0.0))
        speed = math.hypot(east, north)
        if not math.isfinite(speed) or speed <= 0.1:
            continue
        sample_heading = _base._current_heading(sample)
        if abs(_base._wrap180(sample_heading - heading_deg)) <= 18.0:
            candidates.append(speed)
    if len(candidates) >= 5:
        return _base._median(candidates)
    return _base._mean_speed(samples)


def _wind_estimate_v20(track: Any, provenance: Mapping[str, Any]) -> dict[str, float]:
    if track.kind == "circle":
        return _V19_WIND_ESTIMATE(track, provenance)

    heading = _v19._local_route_heading(track)
    if heading is None:
        return _V19_WIND_ESTIMATE(track, provenance)

    nominal_speed = _local_nominal_speed(track, heading)
    angle = math.radians(heading)
    expected_east = math.sin(angle) * nominal_speed
    expected_north = math.cos(angle) * nominal_speed
    residual_east = float(track.current.get("velocityEast", 0.0)) - expected_east
    residual_north = float(track.current.get("velocityNorth", 0.0)) - expected_north
    residual_mps = math.hypot(residual_east, residual_north)
    completeness = provenance.get("completenessPct")
    data_factor = min(100.0, len(track.samples) / 12.0 * 100.0) if completeness is None else float(completeness)
    confidence = _base._clamp(float(track.route_score) * 0.72 + data_factor * 0.28, 0.0, 99.0)
    return {
        "speedKnots": residual_mps * 1.9438444924406,
        "bearingDeg": 0.0 if residual_mps < 0.05 else _base._wrap360(math.degrees(math.atan2(residual_east, residual_north))),
        "confidencePct": confidence,
        "residualNorth": residual_north,
        "residualEast": residual_east,
    }


_base._wind_estimate = _wind_estimate_v20

CORE_API_VERSION = _v19.CORE_API_VERSION
analyze_navigation_dataset = _v19.analyze_navigation_dataset
build_analysis_history = _v19.build_analysis_history
derive_events = _v19.derive_events
compare_membership = _v19.compare_membership
provenance_from_samples = _v19.provenance_from_samples
so_pair_compatibility = _v19.so_pair_compatibility

__all__ = [
    "CORE_API_VERSION",
    "analyze_navigation_dataset",
    "build_analysis_history",
    "derive_events",
    "compare_membership",
    "provenance_from_samples",
    "so_pair_compatibility",
]
