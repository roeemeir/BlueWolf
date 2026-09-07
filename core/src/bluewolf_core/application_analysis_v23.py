"""Blue Wolf application analysis v2.3 grouping semantics.

v2.3 keeps the v2.2 topology/performance work and changes grouping semantics:
- SO axis angle is evidence/display only, never a production grouping gate.
- Two SO routes connect when at least one pair of physical turns is within
  1.5 mean leg lengths and their route travel direction/front is consistent.
- SI and SO may each contain multiple independent groups. Components are sorted
  largest-first; every compatible component with at least two routes is kept.
- The legacy `groups.si` / `groups.so` fields remain the largest groups for UI
  compatibility, while `groupSets.si` / `groupSets.so` expose every group.

The module remains pure: no UI, DB, HTTP, filesystem, Influx or simulator GT.
"""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from datetime import timedelta
from typing import Any, Mapping, Sequence

from . import application_analysis_v18 as _v18
from . import application_analysis_v19 as _v19
from . import application_analysis_v22 as _v22  # installs v2.2 topology primitive

_base = _v18._base
MAX_SO_TURN_CONNECTION_LEGS = 1.5


def _front_direction(geometry: Mapping[str, Any]) -> int | None:
    raw = geometry.get("direction")
    if raw in (-1, 1):
        return int(raw)
    return None


def so_pair_compatibility(
    first: Mapping[str, Any],
    second: Mapping[str, Any],
    settings: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Production SO connection law based on connected turns, not axis angle.

    `maxAngleDeg` and the old lateral threshold are intentionally ignored for
    validity. They remain UI/template-builder concerns. The returned angle is
    retained as evidence and may legitimately exceed 90 degrees.
    """
    settings = settings or {}
    max_turn_legs = float(settings.get("maxTurnDistanceLegs", MAX_SO_TURN_CONNECTION_LEGS))
    first_direction = _front_direction(first)
    second_direction = _front_direction(second)
    front_aligned = (
        first_direction is None
        or second_direction is None
        or first_direction == second_direction
    )

    best: dict[str, Any] | None = None
    best_cost = math.inf
    for first_segment in _v18._segments(first):
        for second_segment in _v18._segments(second):
            first_axis = float(first_segment["angleDeg"])
            second_axis = float(second_segment["angleDeg"])
            angle_diff = abs(_base._wrap180(first_axis - second_axis))
            mean_leg = max(1.0, (float(first_segment["leg"]) + float(second_segment["leg"])) / 2.0)
            for first_turn in first_segment["turns"]:
                for second_turn in second_segment["turns"]:
                    dx = float(second_turn["x"]) - float(first_turn["x"])
                    dy = float(second_turn["y"]) - float(first_turn["y"])
                    turn_distance = math.hypot(dx, dy)
                    turn_legs = turn_distance / mean_leg

                    # Preserve the old decomposition only as diagnostic evidence.
                    unit = _base._unit(first_axis)
                    normal = {"x": -unit["y"], "y": unit["x"]}
                    parallel_distance = abs(dx * unit["x"] + dy * unit["y"])
                    lateral_distance = abs(dx * normal["x"] + dy * normal["y"])
                    parallel_legs = parallel_distance / mean_leg
                    lateral_legs = lateral_distance / mean_leg

                    valid = front_aligned and turn_legs <= max_turn_legs
                    cost = turn_legs + (0.0 if front_aligned else 1000.0)
                    explanation = (
                        f"חיבור SO תקין: הפניות הקרובות במרחק {turn_legs:.2f} Leg, "
                        f"חזית {'אחידה' if front_aligned else 'מנוגדת'}, הפרש axes {angle_diff:.1f}° (מידע בלבד)."
                        if valid
                        else f"SO לא מחובר: מרחק פניות {turn_legs:.2f} Leg (סף {max_turn_legs:g}), "
                        f"חזית {'אחידה' if front_aligned else 'מנוגדת'}, הפרש axes {angle_diff:.1f}° (אינו סף קיבוץ)."
                    )
                    candidate = {
                        "valid": valid,
                        "angleDiffDeg": angle_diff,
                        "parallelDistance": parallel_distance,
                        "lateralDistance": lateral_distance,
                        "turnDistance": turn_distance,
                        "meanLeg": mean_leg,
                        "parallelLegs": parallel_legs,
                        "lateralLegs": lateral_legs,
                        "turnDistanceLegs": turn_legs,
                        "axisDeg": first_axis,
                        "frontAligned": front_aligned,
                        "explanation": explanation,
                    }
                    if best is None or (valid and not bool(best["valid"])) or (
                        valid == bool(best["valid"]) and cost < best_cost
                    ):
                        best = candidate
                        best_cost = cost
    return best or {
        "valid": False,
        "angleDiffDeg": 180.0,
        "parallelDistance": 1e9,
        "lateralDistance": 1e9,
        "turnDistance": 1e9,
        "meanLeg": 1.0,
        "parallelLegs": 1e9,
        "lateralLegs": 1e9,
        "turnDistanceLegs": 1e9,
        "axisDeg": 0.0,
        "frontAligned": False,
        "explanation": "לא ניתן לחשב חיבור בין הפניות.",
    }


# v1.9's Double arm learning remains useful. Inject the actual route direction
# into every learned grouping geometry before applying the v2.3 turn law.
def _track_pair_evidence(first: Any, second: Any, settings: Mapping[str, Any]) -> dict[str, Any]:
    best: dict[str, Any] | None = None
    best_cost = math.inf
    for first_raw in _v19._track_grouping_geometries(first):
        for second_raw in _v19._track_grouping_geometries(second):
            first_geometry = dict(first_raw)
            second_geometry = dict(second_raw)
            first_geometry["direction"] = int(first.direction)
            second_geometry["direction"] = int(second.direction)
            evidence = so_pair_compatibility(first_geometry, second_geometry, settings)
            cost = float(evidence.get("turnDistanceLegs", 1e9)) + (0.0 if evidence.get("frontAligned") else 1000.0)
            if best is None or (bool(evidence.get("valid")) and not bool(best.get("valid"))) or (
                bool(evidence.get("valid")) == bool(best.get("valid")) and cost < best_cost
            ):
                best = dict(evidence)
                best_cost = cost
    return best or so_pair_compatibility(first.geometry or {}, second.geometry or {}, settings)


def _components_from_adjacency(adjacency: Sequence[set[int]]) -> list[list[int]]:
    visited: set[int] = set()
    components: list[list[int]] = []
    for start in range(len(adjacency)):
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
        components.append(sorted(component))
    components.sort(key=lambda values: (-len(values), values[0] if values else 10**9))
    return components


def _si_components(circles: Sequence[Any]) -> list[list[Any]]:
    adjacency = [set() for _ in circles]
    for first_index in range(len(circles)):
        first = circles[first_index]
        for second_index in range(first_index + 1, len(circles)):
            second = circles[second_index]
            center_limit = max(first.fit.minor_span, second.fit.minor_span) * 0.7
            compatible = (
                first.direction == second.direction
                and _base._distance(first.fit.center, second.fit.center) <= center_limit
            )
            if compatible:
                adjacency[first_index].add(second_index)
                adjacency[second_index].add(first_index)
    return [
        [circles[index] for index in component]
        for component in _components_from_adjacency(adjacency)
        if len(component) >= 2
    ]


def _so_components(
    tracks: Sequence[Any],
    settings: Mapping[str, Any],
) -> tuple[list[list[Any]], dict[str, dict[str, Any]]]:
    adjacency = [set() for _ in tracks]
    evidence: dict[str, dict[str, Any]] = {}
    for first_index in range(len(tracks)):
        for second_index in range(first_index + 1, len(tracks)):
            item = _track_pair_evidence(tracks[first_index], tracks[second_index], settings)
            evidence[f"{first_index}:{second_index}"] = item
            if item.get("valid"):
                adjacency[first_index].add(second_index)
                adjacency[second_index].add(first_index)
    components = [
        [tracks[index] for index in component]
        for component in _components_from_adjacency(adjacency)
        if len(component) >= 2
    ]
    return components, evidence


def _si_group(tracks: Sequence[Any], index: int, provenance: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    timing = _base._period_stats(tracks)
    angles = _base._si_observed_angles(tracks)
    route_score = _base._mean([track.route_score for track in tracks])
    route_parts = _base._aggregate_route_parts(tracks)
    desired = list((config.get("siTemplate") or {}).get("values", []))
    score = _base._si_scores(
        angles, desired, route_score, route_parts,
        timing["periodErrorPct"], timing["motionErrorPct"], config,
    )
    group_id = "SI-NAV" if index == 0 else f"SI-NAV-{index + 1}"
    return {
        "key": "si", "id": group_id, "name": f"קבוצת SI {index + 1}", "family": "SI",
        "members": [track.vehicle_id for track in tracks], "score": score,
        "routeScore": route_score, "observedAngles": angles, "observedRelations": [],
        "periodErrorPct": timing["periodErrorPct"], "motionErrorPct": timing["motionErrorPct"],
        "vehicles": _base._group_vehicle_scores(tracks, score, timing, provenance, config),
    }


def _so_group(tracks: Sequence[Any], index: int, provenance: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    timing = _base._period_stats(tracks)
    # Ordering is presentation/template relation ordering only; connectivity was
    # already decided independently by the physical turn graph above.
    ordered = sorted(tracks, key=lambda track: (track.fit.center["x"], track.fit.center["y"], track.vehicle_id))
    relations = [
        _base._classify_phase(ordered[position + 1].phase - ordered[position].phase)
        for position in range(max(0, len(ordered) - 1))
    ]
    route_score = _base._mean([track.route_score for track in tracks])
    route_parts = _base._aggregate_route_parts(tracks)
    score = _base._so_scores(
        relations, _base._template_relations(config), route_score, route_parts,
        timing["periodErrorPct"], timing["motionErrorPct"], config,
    )
    group_id = "SO-NAV" if index == 0 else f"SO-NAV-{index + 1}"
    return {
        "key": "so", "id": group_id, "name": f"קבוצת SO {index + 1}", "family": "SO",
        "members": [track.vehicle_id for track in tracks], "score": score,
        "routeScore": route_score, "observedAngles": [], "observedRelations": relations,
        "periodErrorPct": timing["periodErrorPct"], "motionErrorPct": timing["motionErrorPct"],
        "vehicles": _base._group_vehicle_scores(tracks, score, timing, provenance, config),
    }


def analyze_navigation_dataset(dataset: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    provenance = dict(dataset.get("provenance", {}))
    grouped = _base._group_by_vehicle(dataset.get("samples", []))
    tracks = []
    for vehicle_id, samples in grouped.items():
        track = _v18._build_track(vehicle_id, samples, config)
        if track is None:
            continue
        if track.geometry is not None:
            track.geometry = {**track.geometry, "direction": int(track.direction)}
        tracks.append(track)

    if not tracks:
        groups = {"si": _base._empty_group("si"), "so": _base._empty_group("so")}
        return {
            "coreApiVersion": _base.CORE_API_VERSION,
            "available": False,
            "provenance": provenance,
            "routes": [],
            "groups": groups,
            "groupSets": {"si": [], "so": []},
            "ungroupedVehicles": [],
            "current": {},
            "alerts": _base._alerts(groups, [], provenance, config),
            "groupingNotes": [],
        }

    transform = _base._display_transform(tracks)
    circles = [track for track in tracks if track.kind == "circle"]
    so_tracks = [track for track in tracks if track.kind != "circle" and track.geometry is not None]
    si_components = _si_components(circles)
    grouping_settings = config.get("groupingSettings") or {}
    so_components, pair_evidence = _so_components(so_tracks, grouping_settings)

    si_groups = [_si_group(component, index, provenance, config) for index, component in enumerate(si_components)]
    so_groups = [_so_group(component, index, provenance, config) for index, component in enumerate(so_components)]
    groups = {
        "si": si_groups[0] if si_groups else _base._empty_group("si"),
        "so": so_groups[0] if so_groups else _base._empty_group("so"),
    }

    active_ids = {
        track.vehicle_id
        for component in [*si_components, *so_components]
        for track in component
    }
    ungrouped = [track.vehicle_id for track in tracks if track.vehicle_id not in active_ids]
    grouping_notes = [f"{key}: {value['explanation']}" for key, value in pair_evidence.items()]
    if len(si_groups) > 1:
        grouping_notes.append(f"זוהו {len(si_groups)} קבוצות SI עצמאיות.")
    if len(so_groups) > 1:
        grouping_notes.append(f"זוהו {len(so_groups)} קבוצות SO עצמאיות.")

    routes: list[dict[str, Any]] = []
    current: dict[str, dict[str, Any]] = {}
    for track in tracks:
        radius = max(5.0, (track.fit.major_span + track.fit.minor_span) / 4.0 if track.kind == "circle" else track.fit.minor_span / 2.0)
        routes.append({
            "key": f"nav-{track.vehicle_id}",
            "vehicleId": track.vehicle_id,
            "kind": track.kind,
            "points": _base._downsample_path(track.samples, transform),
            "geometry": track.geometry,
            "centerMetric": dict(track.fit.center),
            "rotationDeg": track.fit.rotation_deg,
            "radius": radius,
            "legLength": max(1.0, track.fit.major_span - track.fit.minor_span),
            "periodSec": track.period_sec,
        })
        display = transform(track.current)
        current[str(track.vehicle_id)] = {
            "x": display["x"], "y": display["y"],
            "headingDeg": _base._current_heading(track.current),
            "latitude": float(track.current["latitude"]),
            "longitude": float(track.current["longitude"]),
            "timestamp": str(track.current["timestamp"]),
        }

    return {
        "coreApiVersion": _base.CORE_API_VERSION,
        "available": True,
        "provenance": provenance,
        "routes": routes,
        "groups": groups,
        "groupSets": {"si": si_groups, "so": so_groups},
        "ungroupedVehicles": ungrouped,
        "current": current,
        "alerts": _base._alerts(groups, ungrouped, provenance, config),
        "groupingNotes": grouping_notes,
    }


def build_analysis_history(
    dataset: Mapping[str, Any],
    config: Mapping[str, Any],
    max_frames: int = 61,
    lookback_minutes: int = 40,
) -> list[dict[str, Any]]:
    """Indexed historical replay using v2.3 grouping with a real frame cap."""
    samples = [sample for sample in dataset.get("samples", []) if isinstance(sample, Mapping)]
    if not samples:
        return []
    indexed = sorted(
        ((_v22._parse_time(str(sample["timestamp"])), sample) for sample in samples),
        key=lambda item: item[0],
    )
    indexed_times = [item[0] for item in indexed]
    unique_wire_times = sorted({str(sample["timestamp"]) for sample in samples}, key=_v22._parse_time)
    selected = _v22._selected_history_times(unique_wire_times, max_frames)
    if not selected:
        return []
    provenance = dataset.get("provenance", {})
    source = str(provenance.get("source", "simulation"))
    server_id = str(provenance.get("serverId", "1"))
    warnings = provenance.get("warnings", []) if isinstance(provenance, Mapping) else []
    lookback = timedelta(minutes=max(1, int(lookback_minutes)))
    output: list[dict[str, Any]] = []
    for timestamp in selected:
        end = _v22._parse_time(timestamp)
        start = end - lookback
        left = bisect_left(indexed_times, start)
        right = bisect_right(indexed_times, end)
        sliced = [item[1] for item in indexed[left:right]]
        slice_dataset = {
            "samples": sliced,
            "provenance": _v22.provenance_from_samples(source, server_id, start, end, sliced, warnings),
        }
        output.append({"timestamp": timestamp, "analysis": analyze_navigation_dataset(slice_dataset, config)})
    return output


CORE_API_VERSION = _v22.CORE_API_VERSION
derive_events = _v22.derive_events
compare_membership = _v22.compare_membership
provenance_from_samples = _v22.provenance_from_samples

# Compatibility hooks used by older modules and the worker command.
_base.so_pair_compatibility = so_pair_compatibility

__all__ = [
    "CORE_API_VERSION",
    "MAX_SO_TURN_CONNECTION_LEGS",
    "analyze_navigation_dataset",
    "build_analysis_history",
    "derive_events",
    "compare_membership",
    "provenance_from_samples",
    "so_pair_compatibility",
]
