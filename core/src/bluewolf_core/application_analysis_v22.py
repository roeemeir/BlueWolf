"""Blue Wolf application analysis v2.2 optimization + topology hardening.

The public Core API and scoring semantics remain unchanged from v2.1. v2.2:
1. removes an O(frames * samples) historical slicing path by indexing source
   timestamps once and using binary search for each lookback window;
2. tightens Figure-8 classification so an incidental noisy segment crossing in
   a Single/Double route is not enough. A crossed-leg hippodrome must also pass
   materially through its fitted centre, as the real crossed legs do.

The module remains pure: no UI, DB, HTTP, filesystem, Influx client or GT access.
"""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from datetime import UTC, datetime, timedelta
from typing import Any, Mapping, Sequence

from . import application_analysis_v21 as _v21
from .v08_core import Point2D, RouteShape, classify_route

_v18 = _v21._v18
_base = _v18._base
_FIGURE8_MAX_NORMALIZED_AREA = 0.012
_FIGURE8_MAX_CENTER_CROSSING_RATIO = 0.45


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _center_crossing_ratio(samples: Sequence[Mapping[str, Any]], fit: Any) -> float:
    """Minimum route distance from fitted centre, normalized by route half-width.

    A true Figure-8 crossed-leg hippodrome crosses close to its centre. Normal
    Single/Double routes travel around the centre with roughly one radius of
    clearance, so repeated noisy traversals may create tiny intersections but
    should not satisfy this structural centre-crossing test.
    """
    if not samples:
        return math.inf
    cx = float(fit.center["x"])
    cy = float(fit.center["y"])
    half_width = max(1.0, float(fit.minor_span) / 2.0)
    nearest = min(
        math.hypot(float(sample["x"]) - cx, float(sample["y"]) - cy)
        for sample in samples
    )
    return nearest / half_width


def _topology_kind_v22(samples: Sequence[Mapping[str, Any]], fit: Any) -> str:
    aspect = fit.major_span / max(1.0, fit.minor_span)
    if aspect < 1.32:
        return "circle"

    cycle = _v18._representative_cycle(samples, fit)
    if len(cycle) < 20:
        return _base._estimate_kind(samples, fit)

    speed = _base._mean_speed(cycle)
    length = _v18._closed_length(cycle)
    rough_period = length / speed if speed > 0.15 and length > 1.0 else 120.0
    try:
        descriptor = classify_route(
            (Point2D(*_v18._xy(sample)) for sample in cycle),
            max(1.0, rough_period),
        )
    except (ValueError, ZeroDivisionError):
        return _base._estimate_kind(samples, fit)

    if descriptor.shape is RouteShape.FIGURE_EIGHT:
        normalized_area = _v21._normalized_signed_area(cycle)
        centre_crossing = _center_crossing_ratio(cycle, fit)
        if (
            normalized_area <= _FIGURE8_MAX_NORMALIZED_AREA
            and centre_crossing <= _FIGURE8_MAX_CENTER_CROSSING_RATIO
        ):
            return "figure8"
        if descriptor.waist_ratio < 0.70:
            return "double"
        return _base._estimate_kind(samples, fit)
    if descriptor.shape is RouteShape.DOUBLE_HIPPODROME:
        return "double"
    if descriptor.shape is RouteShape.HIPPODROME:
        return "single"
    if descriptor.shape is RouteShape.COMPACT:
        return "circle"
    return _base._estimate_kind(samples, fit)


# v1.8/v2.x application analysis performs topology lookup through the stable
# base module. Replace only the pure primitive; contracts/persistence stay fixed.
_v18._topology_kind = _topology_kind_v22


def build_analysis_history(
    dataset: Mapping[str, Any],
    config: Mapping[str, Any],
    max_frames: int = 61,
    lookback_minutes: int = 12,
) -> list[dict[str, Any]]:
    """Build historical frames with one timestamp index for the full replay.

    The previous implementation rescanned every source sample for every output
    frame and reparsed every timestamp on each scan. For a 24-hour investigation
    with 120 frames that multiplied otherwise cheap window selection work by
    roughly 120. Here timestamps are parsed exactly once for the index and each
    frame is sliced with bisect in O(log N + window_size).
    """
    samples = [sample for sample in dataset.get("samples", []) if isinstance(sample, Mapping)]
    if not samples:
        return []

    indexed = sorted(
        ((_parse_time(str(sample["timestamp"])), sample) for sample in samples),
        key=lambda item: item[0],
    )
    indexed_times = [item[0] for item in indexed]

    # Preserve legacy frame-selection semantics: unique wire timestamps,
    # chronologically ordered, sampled with floor(len/max_frames) stride and
    # always including the final timestamp.
    unique_wire_times = sorted(
        {str(sample["timestamp"]) for sample in samples},
        key=_parse_time,
    )
    if not unique_wire_times:
        return []
    safe_max_frames = max(1, int(max_frames))
    step = max(1, len(unique_wire_times) // safe_max_frames)
    selected = [value for index, value in enumerate(unique_wire_times) if index % step == 0]
    if selected[-1] != unique_wire_times[-1]:
        selected.append(unique_wire_times[-1])

    provenance = dataset.get("provenance", {})
    source = str(provenance.get("source", "simulation"))
    server_id = str(provenance.get("serverId", "1"))
    warnings: Sequence[str] = provenance.get("warnings", []) if isinstance(provenance, Mapping) else []
    lookback = timedelta(minutes=max(1, int(lookback_minutes)))
    output: list[dict[str, Any]] = []

    for timestamp in selected:
        end = _parse_time(timestamp)
        start = end - lookback
        left = bisect_left(indexed_times, start)
        right = bisect_right(indexed_times, end)
        sliced = [item[1] for item in indexed[left:right]]
        slice_dataset = {
            "samples": sliced,
            "provenance": _v21.provenance_from_samples(
                source,
                server_id,
                start,
                end,
                sliced,
                warnings,
            ),
        }
        output.append({
            "timestamp": timestamp,
            "analysis": _v21.analyze_navigation_dataset(slice_dataset, config),
        })
    return output


CORE_API_VERSION = _v21.CORE_API_VERSION
analyze_navigation_dataset = _v21.analyze_navigation_dataset
derive_events = _v21.derive_events
compare_membership = _v21.compare_membership
provenance_from_samples = _v21.provenance_from_samples
so_pair_compatibility = _v21.so_pair_compatibility

__all__ = [
    "CORE_API_VERSION",
    "analyze_navigation_dataset",
    "build_analysis_history",
    "derive_events",
    "compare_membership",
    "provenance_from_samples",
    "so_pair_compatibility",
]
