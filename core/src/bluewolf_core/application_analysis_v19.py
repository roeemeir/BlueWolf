"""Blue Wolf application analysis v1.9 grouping refinement.

This module keeps the stable v1.8 application/Core contract and changes only
how SO tracks are compared for grouping.  A Double hippodrome is articulated:
a single PCA axis cannot describe both straight arms.  v1.9 therefore learns
the two dominant straight axes directly from the raw navigation velocity and
compares each learned arm as an ordinary Single segment.

The implementation is pure and has no UI, DB, filesystem, HTTP or simulator-GT
access.  The public Core API remains 1.0.0.
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

from . import application_analysis_v18 as _v18

_base = _v18._base
_ORIGINAL_LARGEST_COMPONENT = _base._largest_compatible_component


def _axis_deg(sample: Mapping[str, Any]) -> float | None:
    east = float(sample.get("velocityEast", 0.0))
    north = float(sample.get("velocityNorth", 0.0))
    if math.hypot(east, north) < 0.4:
        return None
    return math.degrees(math.atan2(north, east)) % 180.0


def _axis_diff(first: float, second: float) -> float:
    delta = abs((first - second) % 180.0)
    return min(delta, 180.0 - delta)


def _dominant_double_axes(track: Any) -> list[float]:
    """Return the two straight-arm axes of an articulated Double route.

    Straight samples form strong heading peaks while the outer U-turns and the
    centre bend spread their headings over many bins.  Folding headings to
    0..180 removes travel direction and leaves route-axis evidence only.
    """
    cycle = _v18._representative_cycle(track.samples, track.fit)
    bin_size = 5.0
    bin_count = int(180 / bin_size)
    weights = [0.0] * bin_count
    for sample in cycle:
        axis = _axis_deg(sample)
        if axis is None:
            continue
        east = float(sample.get("velocityEast", 0.0))
        north = float(sample.get("velocityNorth", 0.0))
        speed = min(30.0, math.hypot(east, north))
        index = int(axis / bin_size) % bin_count
        weights[index] += max(0.5, speed)

    if not any(weights):
        return []
    smoothed = [
        weights[(index - 1) % bin_count] * 0.5
        + weights[index]
        + weights[(index + 1) % bin_count] * 0.5
        for index in range(bin_count)
    ]
    first_index = max(range(bin_count), key=smoothed.__getitem__)
    first_axis = (first_index + 0.5) * bin_size
    candidates = [
        index for index in range(bin_count)
        if 12.0 <= _axis_diff((index + 0.5) * bin_size, first_axis) <= 75.0
    ]
    if not candidates:
        return [first_axis]
    second_index = max(candidates, key=smoothed.__getitem__)
    if smoothed[second_index] < smoothed[first_index] * 0.18:
        return [first_axis]
    second_axis = (second_index + 0.5) * bin_size
    return [first_axis, second_axis]


def _quantile(values: Sequence[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def _arm_geometry(track: Any, axis: float) -> dict[str, Any] | None:
    cycle = _v18._representative_cycle(track.samples, track.fit)
    unit = _base._unit(axis)
    normal = {"x": -unit["y"], "y": unit["x"]}
    aligned: list[tuple[float, float]] = []
    for sample in cycle:
        sample_axis = _axis_deg(sample)
        if sample_axis is None or _axis_diff(sample_axis, axis) > 10.0:
            continue
        x = float(sample["x"])
        y = float(sample["y"])
        aligned.append((x * unit["x"] + y * unit["y"], x * normal["x"] + y * normal["y"]))
    if len(aligned) < 8:
        return None

    longitudinal = [item[0] for item in aligned]
    lateral = [item[1] for item in aligned]
    lo = _quantile(longitudinal, 0.04)
    hi = _quantile(longitudinal, 0.96)
    leg = hi - lo
    if leg < max(12.0, float((track.geometry or {}).get("radius", 5.0)) * 1.2):
        return None
    centre_lateral = _quantile(lateral, 0.5)
    centre_longitudinal = (lo + hi) / 2.0
    center = {
        "x": unit["x"] * centre_longitudinal + normal["x"] * centre_lateral,
        "y": unit["y"] * centre_longitudinal + normal["y"] * centre_lateral,
    }
    return {
        "kind": "single",
        "center": center,
        "radius": max(5.0, float((track.geometry or {}).get("radius", 5.0))),
        "legLength": leg,
        "rotationDeg": axis,
    }


def _track_grouping_geometries(track: Any) -> list[Mapping[str, Any]]:
    geometry = track.geometry
    if not isinstance(geometry, Mapping):
        return []
    if track.kind != "double":
        return [geometry]
    learned = [
        arm for axis in _dominant_double_axes(track)
        if (arm := _arm_geometry(track, axis)) is not None
    ]
    # Require both arms before replacing the legacy PCA approximation.  A
    # partial observation must remain conservative rather than inventing a bend.
    return learned if len(learned) >= 2 else [geometry]


def _evidence_cost(evidence: Mapping[str, Any], settings: Mapping[str, Any]) -> float:
    return (
        float(evidence.get("angleDiffDeg", 180.0)) / max(1.0, float(settings.get("maxAngleDeg", 20.0)))
        + float(evidence.get("parallelLegs", 1e9)) / max(0.01, float(settings.get("maxParallelLegs", 1.5)))
        + float(evidence.get("lateralLegs", 1e9)) / max(0.01, float(settings.get("maxLateralLegs", 0.35)))
    )


def _track_pair_evidence(first: Any, second: Any, settings: Mapping[str, Any]) -> dict[str, Any]:
    best: dict[str, Any] | None = None
    best_cost = math.inf
    for first_geometry in _track_grouping_geometries(first):
        for second_geometry in _track_grouping_geometries(second):
            evidence = _base.so_pair_compatibility(first_geometry, second_geometry, settings)
            cost = _evidence_cost(evidence, settings)
            if best is None or (bool(evidence.get("valid")) and not bool(best.get("valid"))) or (
                bool(evidence.get("valid")) == bool(best.get("valid")) and cost < best_cost
            ):
                best = dict(evidence)
                best_cost = cost
    if best is not None:
        if first.kind == "double" or second.kind == "double":
            best["explanation"] = f"Double-arm NAV: {best['explanation']}"
        return best
    return _base.so_pair_compatibility(first.geometry or {}, second.geometry or {}, settings)


def _largest_compatible_component_v19(
    tracks: Sequence[Any],
    settings: Mapping[str, Any],
) -> tuple[list[Any], list[Any], dict[str, dict[str, Any]]]:
    if len(tracks) <= 1:
        return list(tracks), [], {}
    adjacency = [set() for _ in tracks]
    evidence: dict[str, dict[str, Any]] = {}
    for first_index in range(len(tracks)):
        for second_index in range(first_index + 1, len(tracks)):
            item = _track_pair_evidence(tracks[first_index], tracks[second_index], settings)
            evidence[f"{first_index}:{second_index}"] = item
            if item.get("valid"):
                adjacency[first_index].add(second_index)
                adjacency[second_index].add(first_index)

    visited: set[int] = set()
    components: list[list[int]] = []
    for start in range(len(tracks)):
        if start in visited:
            continue
        stack = [start]
        visited.add(start)
        component: list[int] = []
        while stack:
            index = stack.pop()
            component.append(index)
            for neighbor in adjacency[index]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    stack.append(neighbor)
        components.append(component)
    components.sort(key=lambda values: (-len(values), values[0]))
    grouped_indices = set(components[0] if components else [])
    return (
        [track for index, track in enumerate(tracks) if index in grouped_indices],
        [track for index, track in enumerate(tracks) if index not in grouped_indices],
        evidence,
    )


# v1.8 analysis performs global lookup through the stable base module, so this
# patch changes only the SO grouping primitive while retaining the exact same
# public analysis/history/event envelope.
_base._largest_compatible_component = _largest_compatible_component_v19

CORE_API_VERSION = _v18.CORE_API_VERSION
analyze_navigation_dataset = _v18.analyze_navigation_dataset
build_analysis_history = _v18.build_analysis_history
derive_events = _v18.derive_events
compare_membership = _v18.compare_membership
provenance_from_samples = _v18.provenance_from_samples
so_pair_compatibility = _v18.so_pair_compatibility

__all__ = [
    "CORE_API_VERSION",
    "analyze_navigation_dataset",
    "build_analysis_history",
    "derive_events",
    "compare_membership",
    "provenance_from_samples",
    "so_pair_compatibility",
]
