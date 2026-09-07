"""Blue Wolf application analysis v2.2 historical replay optimization.

The public Core API and all scoring/topology semantics remain unchanged from
v2.1. This version removes an O(frames * samples) historical slicing path.
A 24-hour replay now parses/sorts the source timestamps once, then uses binary
search to extract each lookback window before running the exact same current
analysis on that window.

The module remains pure: no UI, DB, HTTP, filesystem, Influx client or GT access.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from datetime import UTC, datetime, timedelta
from typing import Any, Mapping, Sequence

from . import application_analysis_v21 as _v21


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


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

    # Preserve the legacy frame-selection semantics: unique wire timestamps,
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
