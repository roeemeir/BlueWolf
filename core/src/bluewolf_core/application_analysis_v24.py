"""Blue Wolf application analysis v2.4 multi-group historical events.

Grouping, topology, scoring and historical slicing are inherited unchanged from
v2.3. This layer makes the event derivation multi-group aware: every independent
SI/SO group receives its own event lane instead of only the largest group being
visible in investigation history.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from . import application_analysis_v23 as _v23

_base = _v23._base


def _group_for_id(analysis: Mapping[str, Any], family_key: str, group_id: str) -> Mapping[str, Any] | None:
    group_sets = analysis.get("groupSets", {})
    candidates = group_sets.get(family_key, []) if isinstance(group_sets, Mapping) else []
    for group in candidates:
        if isinstance(group, Mapping) and str(group.get("id")) == group_id:
            return group
    legacy = analysis.get("groups", {}).get(family_key) if isinstance(analysis.get("groups"), Mapping) else None
    if isinstance(legacy, Mapping) and str(legacy.get("id")) == group_id:
        return legacy
    return None


def derive_events(history: Sequence[Mapping[str, Any]], thresholds: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Derive events independently for every SI/SO group lane.

    The mature v1.x event-boundary logic is reused without duplication. For each
    group ID we construct a compatibility view where that group occupies the
    legacy family slot and the other family is empty. This preserves all existing
    membership/route/period boundary semantics while making secondary groups
    first-class historical events.
    """
    if not history:
        return []

    group_ids: dict[str, list[str]] = {"si": [], "so": []}
    for frame in history:
        analysis = frame.get("analysis", {})
        group_sets = analysis.get("groupSets", {}) if isinstance(analysis, Mapping) else {}
        for key in ("si", "so"):
            candidates = group_sets.get(key, []) if isinstance(group_sets, Mapping) else []
            if not candidates:
                legacy = analysis.get("groups", {}).get(key) if isinstance(analysis.get("groups"), Mapping) else None
                candidates = [legacy] if isinstance(legacy, Mapping) and legacy.get("members") else []
            for group in candidates:
                if not isinstance(group, Mapping) or not group.get("members"):
                    continue
                group_id = str(group.get("id", ""))
                if group_id and group_id not in group_ids[key]:
                    group_ids[key].append(group_id)

    events: list[dict[str, Any]] = []
    for key in ("si", "so"):
        expected_family = "SI" if key == "si" else "SO"
        for group_id in group_ids[key]:
            lane: list[dict[str, Any]] = []
            for frame in history:
                original_analysis = frame.get("analysis", {})
                analysis = dict(original_analysis) if isinstance(original_analysis, Mapping) else {}
                groups = {"si": _base._empty_group("si"), "so": _base._empty_group("so")}
                selected = _group_for_id(analysis, key, group_id)
                if selected is not None:
                    groups[key] = dict(selected)
                analysis["groups"] = groups
                lane.append({"timestamp": frame["timestamp"], "analysis": analysis})

            lane_events = _base.derive_events(lane, thresholds)
            for event in lane_events:
                if event.get("family") != expected_family:
                    continue
                item = dict(event)
                item["groupId"] = group_id
                events.append(item)

    events.sort(key=lambda event: (_base._parse_time(str(event["start"])), str(event.get("groupId", ""))))
    for index, event in enumerate(events):
        event["index"] = index
        event["id"] = f"E{index + 1}"
    return events


CORE_API_VERSION = _v23.CORE_API_VERSION
analyze_navigation_dataset = _v23.analyze_navigation_dataset
build_analysis_history = _v23.build_analysis_history
compare_membership = _v23.compare_membership
provenance_from_samples = _v23.provenance_from_samples
so_pair_compatibility = _v23.so_pair_compatibility

__all__ = [
    "CORE_API_VERSION",
    "analyze_navigation_dataset",
    "build_analysis_history",
    "derive_events",
    "compare_membership",
    "provenance_from_samples",
    "so_pair_compatibility",
]
