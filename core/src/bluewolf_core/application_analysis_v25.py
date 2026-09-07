"""Blue Wolf application analysis v2.5 latest-cycle semantics.

The application still receives up to 40 minutes of evidence. A provisional
track uses that evidence to estimate period/topology context; the current route,
phase and scoring track are then rebuilt from the deterministic latest-cycle
window. This applies uniformly to SI, arbitrary closed SO, Double and Figure-8.
"""

from __future__ import annotations

from typing import Any, Mapping

from . import application_analysis_v18 as _v18
from . import application_analysis_v24 as _v24
from .cycle_window_v25 import latest_cycle_mapping_samples

_ORIGINAL_BUILD_TRACK = _v18._build_track


def build_track_latest_cycle(
    vehicle_id: int,
    samples: list[Mapping[str, Any]],
    config: Mapping[str, Any],
):
    provisional = _ORIGINAL_BUILD_TRACK(vehicle_id, samples, config)
    if provisional is None or provisional.period_sec is None or provisional.period_sec <= 0:
        return provisional

    cycle = latest_cycle_mapping_samples(samples, provisional.period_sec)
    if len(cycle) >= len(samples):
        return provisional
    refined = _ORIGINAL_BUILD_TRACK(vehicle_id, list(cycle), config)
    return refined if refined is not None else provisional


# v2.3's grouping implementation resolves the v1.8 track primitive at runtime.
# Install one canonical latest-cycle primitive for every v2.4/v2.5 analysis path.
_v18._build_track = build_track_latest_cycle

CORE_API_VERSION = _v24.CORE_API_VERSION
analyze_navigation_dataset = _v24.analyze_navigation_dataset
build_analysis_history = _v24.build_analysis_history
compare_membership = _v24.compare_membership
provenance_from_samples = _v24.provenance_from_samples
so_pair_compatibility = _v24.so_pair_compatibility
derive_events = _v24.derive_events

__all__ = [
    "CORE_API_VERSION",
    "analyze_navigation_dataset",
    "build_analysis_history",
    "derive_events",
    "compare_membership",
    "provenance_from_samples",
    "so_pair_compatibility",
    "build_track_latest_cycle",
]
