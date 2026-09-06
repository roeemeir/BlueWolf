"""Blue Wolf application analysis v1.8 route-topology refinement.

This module keeps the stable application/Core envelope from
:mod:`application_analysis` while replacing only the route-track primitive used
by that envelope. Figure-8 is deliberately modelled as an SO hippodrome whose
two straight legs cross: it is one route entity, has one normal SO period, uses
arc-length phase on the crossed trace, and uses the same external turn/end-point
grouping law as a single hippodrome.

The module is pure. It performs no network, DB, filesystem or UI work.
"""

from __future__ import annotations

import math
from datetime import timedelta
from typing import Any, Mapping, Sequence

from . import application_analysis as _base
from .v08_core import Point2D, RouteShape, classify_route

_ORIGINAL_SEGMENTS = _base._segments


def _xy(sample: Mapping[str, Any]) -> tuple[float, float]:
    return float(sample["x"]), float(sample["y"])


def _sample_time(sample: Mapping[str, Any]):
    return _base._parse_time(str(sample["timestamp"]))


def _representative_cycle(samples: Sequence[Mapping[str, Any]], fit: _base._Pca) -> list[Mapping[str, Any]]:
    """Return roughly one latest traversal for topology/phase learning."""
    if len(samples) <= 24:
        return list(samples)
    speed = _base._mean_speed(samples)
    radius = max(1.0, fit.minor_span / 2.0)
    leg = max(1.0, fit.major_span - 2.0 * radius)
    nominal_length = 2.0 * leg + 2.0 * math.pi * radius
    rough_period = nominal_length / speed if speed > 0.15 else 120.0
    end = _sample_time(samples[-1])
    start = end - timedelta(seconds=max(30.0, rough_period * 1.08))
    selected = [sample for sample in samples if _sample_time(sample) >= start]
    if len(selected) < 20:
        return list(samples[-max(20, min(len(samples), 96)):])
    return selected


def _closed_length(samples: Sequence[Mapping[str, Any]]) -> float:
    if len(samples) < 2:
        return 0.0
    points = [_xy(sample) for sample in samples]
    length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:]))
    length += math.hypot(points[0][0] - points[-1][0], points[0][1] - points[-1][1])
    return length


def _topology_kind(samples: Sequence[Mapping[str, Any]], fit: _base._Pca) -> str:
    # Product semantics: Figure-8 is a crossed-leg hippodrome, therefore an
    # elongated SO shape. A compact/near-round route remains SI and must not be
    # reclassified by tiny numerical self-intersections in a repeated trace.
    aspect = fit.major_span / max(1.0, fit.minor_span)
    if aspect < 1.32:
        return "circle"

    cycle = _representative_cycle(samples, fit)
    if len(cycle) >= 20:
        speed = _base._mean_speed(cycle)
        length = _closed_length(cycle)
        rough_period = length / speed if speed > 0.15 and length > 1.0 else 120.0
        try:
            descriptor = classify_route((Point2D(*_xy(sample)) for sample in cycle), max(1.0, rough_period))
            if descriptor.shape is RouteShape.FIGURE_EIGHT:
                return "figure8"
            if descriptor.shape is RouteShape.DOUBLE_HIPPODROME:
                return "double"
            if descriptor.shape is RouteShape.HIPPODROME:
                return "single"
            if descriptor.shape is RouteShape.COMPACT:
                return "circle"
        except (ValueError, ZeroDivisionError):
            pass
    return _base._estimate_kind(samples, fit)


def _heading_error(first: float, second: float) -> float:
    return abs(_base._wrap180(first - second))


def _canonical_figure8_points(samples: Sequence[Mapping[str, Any]], fit: _base._Pca) -> tuple[list[dict[str, float]], int]:
    """Create a geometry-anchored Figure-8 cycle.

    Phase zero is the positive major-axis turn. Canonical positive traversal
    leaves that turn through the positive minor-axis half, making phase
    comparable between vehicles regardless of where the input window started.
    """
    cycle = _representative_cycle(samples, fit)
    points = [{"x": float(sample["x"]), "y": float(sample["y"])} for sample in cycle]
    if len(points) < 4:
        return points, 1
    projections = [
        (point["x"] - fit.center["x"]) * fit.ux + (point["y"] - fit.center["y"]) * fit.uy
        for point in points
    ]
    anchor = max(range(len(points)), key=lambda index: projections[index])
    ordered = points[anchor:] + points[:anchor]
    probe = ordered[min(len(ordered) - 1, max(1, len(ordered) // 8))]
    probe_v = (probe["x"] - fit.center["x"]) * fit.vx + (probe["y"] - fit.center["y"]) * fit.vy
    direction = 1
    if probe_v < 0.0:
        ordered = [ordered[0], *reversed(ordered[1:])]
        direction = -1
    return ordered, direction


def _project_closed_path(points: Sequence[Mapping[str, float]], current: Mapping[str, Any]) -> tuple[float, float, float]:
    """Return (phase, distance_m, tangent_error_deg) on a learned closed path."""
    if len(points) < 2:
        return 0.0, 0.0, 0.0
    px, py = float(current["x"]), float(current["y"])
    measured_heading = _base._current_heading(current)
    lengths: list[float] = []
    for index in range(len(points)):
        a, b = points[index], points[(index + 1) % len(points)]
        lengths.append(math.hypot(b["x"] - a["x"], b["y"] - a["y"]))
    total = sum(lengths)
    if total <= 1e-9:
        return 0.0, 0.0, 0.0
    cumulative = 0.0
    best: tuple[float, float, float, float] | None = None
    for index, segment_length in enumerate(lengths):
        if segment_length <= 1e-9:
            continue
        a, b = points[index], points[(index + 1) % len(points)]
        dx, dy = b["x"] - a["x"], b["y"] - a["y"]
        t = max(0.0, min(1.0, ((px - a["x"]) * dx + (py - a["y"]) * dy) / (segment_length * segment_length)))
        qx, qy = a["x"] + t * dx, a["y"] + t * dy
        distance = math.hypot(px - qx, py - qy)
        heading = _base._wrap360(math.degrees(math.atan2(dx, dy)))
        tangent_error = _heading_error(measured_heading, heading)
        # At the centre crossing two segments can have essentially equal
        # geometric distance. A small heading term selects the physical leg
        # actually being traversed instead of jumping to the other branch.
        cost = distance + 0.02 * tangent_error
        phase = (cumulative + t * segment_length) / total
        candidate = (cost, phase, distance, tangent_error)
        if best is None or candidate[0] < best[0]:
            best = candidate
        cumulative += segment_length
    if best is None:
        return 0.0, 0.0, 0.0
    return best[1] % 1.0, best[2], best[3]


def _build_track(vehicle_id: int, samples: list[Mapping[str, Any]], config: Mapping[str, Any]) -> _base._Track | None:
    if len(samples) < 4:
        return None
    current = samples[-1]
    fit = _base._pca(samples)
    kind = _topology_kind(samples, fit)

    if kind == "figure8":
        canonical_points, canonical_direction = _canonical_figure8_points(samples, fit)
        phase, route_deviation, tangent_error = _project_closed_path(canonical_points, current)
        direction = canonical_direction
        speed = _base._mean_speed(samples)
        cycle_length = sum(
            math.hypot(
                canonical_points[(index + 1) % len(canonical_points)]["x"] - canonical_points[index]["x"],
                canonical_points[(index + 1) % len(canonical_points)]["y"] - canonical_points[index]["y"],
            )
            for index in range(len(canonical_points))
        ) if len(canonical_points) > 1 else 0.0
        period_sec = cycle_length / speed if speed > 0.15 and cycle_length > 1.0 else None
    else:
        phase, direction = _base._phase_and_direction(kind, fit, current)
        route_deviation, nearest_heading = _base._nearest_distance_and_heading(samples, current)
        tangent_error = abs(_base._wrap180(_base._current_heading(current) - nearest_heading))
        period_sec = _base._route_period(kind, fit, samples)

    radius = max(5.0, (fit.major_span + fit.minor_span) / 4.0 if kind == "circle" else fit.minor_span / 2.0)
    route_deviation_pct = route_deviation / radius * 100.0
    curvature_error_pct = (
        abs(fit.major_span - fit.minor_span) / max(1.0, (fit.major_span + fit.minor_span) / 2.0) * 100.0
        if kind == "circle" else 0.0
    )
    route_parts = _base._route_score_breakdown(route_deviation_pct, tangent_error, curvature_error_pct, config)
    leg_length = max(1.0, fit.major_span - 2.0 * radius)
    geometry = None
    if kind != "circle":
        geometry = {
            "kind": kind,
            "center": dict(fit.center),
            "radius": radius,
            "legLength": leg_length,
            "rotationDeg": fit.rotation_deg,
        }
        if kind == "double":
            geometry.update({"secondLegLength": leg_length, "bendDeg": 28.0})
        elif kind == "figure8":
            geometry["crossedLegs"] = True

    return _base._Track(
        vehicle_id=vehicle_id,
        samples=samples,
        current=current,
        fit=fit,
        kind=kind,
        phase=phase,
        direction=direction,
        period_sec=period_sec,
        route_score=route_parts["route"],
        route_deviation=route_deviation,
        route_deviation_pct=route_deviation_pct,
        tangent_error_deg=tangent_error,
        route_parts={
            "distance": route_parts["distance"],
            "tangent": route_parts["tangent"],
            "curvature": route_parts["curvature"],
        },
        geometry=geometry,
    )


def _segments(geometry: Mapping[str, Any]) -> list[dict[str, Any]]:
    if geometry.get("kind") == "figure8":
        single = dict(geometry)
        single["kind"] = "single"
        return _ORIGINAL_SEGMENTS(single)
    return _ORIGINAL_SEGMENTS(geometry)


def _largest_si_component(circles: Sequence[_base._Track]) -> tuple[list[_base._Track], list[_base._Track]]:
    """Select the strongest same-centre/same-direction SI component.

    A remote route that is temporarily classified as compact/circular must not
    invalidate every valid concentric SI route. Compatibility is therefore
    pairwise and the largest connected component wins, mirroring the SO grouping
    strategy. Rotation direction is part of the SI law.
    """
    if len(circles) <= 1:
        return list(circles), []
    adjacency = [set() for _ in circles]
    for first_index in range(len(circles)):
        first = circles[first_index]
        for second_index in range(first_index + 1, len(circles)):
            second = circles[second_index]
            center_limit = max(first.fit.minor_span, second.fit.minor_span) * 0.7
            compatible = first.direction == second.direction and _base._distance(first.fit.center, second.fit.center) <= center_limit
            if compatible:
                adjacency[first_index].add(second_index)
                adjacency[second_index].add(first_index)
    visited: set[int] = set()
    components: list[list[int]] = []
    for start in range(len(circles)):
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
    selected = set(components[0] if components else [])
    return (
        [track for index, track in enumerate(circles) if index in selected],
        [track for index, track in enumerate(circles) if index not in selected],
    )


def analyze_navigation_dataset(dataset: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    provenance = dict(dataset.get("provenance", {}))
    grouped = _base._group_by_vehicle(dataset.get("samples", []))
    tracks = [track for vehicle_id, samples in grouped.items() if (track := _build_track(vehicle_id, samples, config)) is not None]
    if not tracks:
        groups = {"si": _base._empty_group("si"), "so": _base._empty_group("so")}
        return {
            "coreApiVersion": _base.CORE_API_VERSION,
            "available": False,
            "provenance": provenance,
            "routes": [],
            "groups": groups,
            "ungroupedVehicles": [],
            "current": {},
            "alerts": _base._alerts(groups, [], provenance, config),
            "groupingNotes": [],
        }

    transform = _base._display_transform(tracks)
    circles = [track for track in tracks if track.kind == "circle"]
    so_tracks = [track for track in tracks if track.kind != "circle" and track.geometry is not None]
    candidate_si, discarded_si = _largest_si_component(circles)
    si_tracks = candidate_si if len(candidate_si) >= 2 else []
    grouping_settings = config.get("groupingSettings") or _base.DEFAULT_SO_GROUPING
    grouped_so, _discarded_so, pair_evidence = _base._largest_compatible_component(so_tracks, grouping_settings)
    active_so = grouped_so if len(grouped_so) >= 2 else []
    active_ids = {track.vehicle_id for track in [*si_tracks, *active_so]}
    ungrouped = [track.vehicle_id for track in tracks if track.vehicle_id not in active_ids]
    grouping_notes = [f"{key}: {value['explanation']}" for key, value in pair_evidence.items()]
    if discarded_si:
        grouping_notes.append(f"SI outliers: {', '.join(str(track.vehicle_id) for track in discarded_si)}")

    si_timing, so_timing = _base._period_stats(si_tracks), _base._period_stats(active_so)
    si_angles = _base._si_observed_angles(si_tracks)
    ordered_so = sorted(active_so, key=lambda track: (track.fit.center["x"], track.vehicle_id))
    so_relations = [_base._classify_phase(ordered_so[index + 1].phase - ordered_so[index].phase) for index in range(max(0, len(ordered_so) - 1))]
    si_route_score = _base._mean([track.route_score for track in si_tracks])
    so_route_score = _base._mean([track.route_score for track in active_so])
    si_route_parts, so_route_parts = _base._aggregate_route_parts(si_tracks), _base._aggregate_route_parts(active_so)
    desired_si = list((config.get("siTemplate") or {}).get("values", []))
    si_score = _base._si_scores(si_angles, desired_si, si_route_score, si_route_parts, si_timing["periodErrorPct"], si_timing["motionErrorPct"], config) if len(si_tracks) >= 2 else dict(_base.EMPTY_SCORE)
    so_score = _base._so_scores(so_relations, _base._template_relations(config), so_route_score, so_route_parts, so_timing["periodErrorPct"], so_timing["motionErrorPct"], config) if len(active_so) >= 2 else dict(_base.EMPTY_SCORE)
    groups = {
        "si": {
            "key": "si", "id": "SI-NAV", "name": "קבוצת SI", "family": "SI",
            "members": [track.vehicle_id for track in si_tracks], "score": si_score,
            "routeScore": si_route_score, "observedAngles": si_angles, "observedRelations": [],
            "periodErrorPct": si_timing["periodErrorPct"], "motionErrorPct": si_timing["motionErrorPct"],
            "vehicles": _base._group_vehicle_scores(si_tracks, si_score, si_timing, provenance, config),
        },
        "so": {
            "key": "so", "id": "SO-NAV", "name": "קבוצת SO", "family": "SO",
            "members": [track.vehicle_id for track in active_so], "score": so_score,
            "routeScore": so_route_score, "observedAngles": [], "observedRelations": so_relations,
            "periodErrorPct": so_timing["periodErrorPct"], "motionErrorPct": so_timing["motionErrorPct"],
            "vehicles": _base._group_vehicle_scores(active_so, so_score, so_timing, provenance, config),
        },
    }
    routes = []
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
            "x": display["x"],
            "y": display["y"],
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
        "ungroupedVehicles": ungrouped,
        "current": current,
        "alerts": _base._alerts(groups, ungrouped, provenance, config),
        "groupingNotes": grouping_notes,
    }


# Patch the stable base module's primitives once so historical replay and the
# public v1.8 entrypoint use the exact same topology/grouping implementation.
_base._build_track = _build_track
_base._segments = _segments
_base.analyze_navigation_dataset = analyze_navigation_dataset

CORE_API_VERSION = _base.CORE_API_VERSION
DEFAULT_SO_GROUPING = _base.DEFAULT_SO_GROUPING
build_analysis_history = _base.build_analysis_history
derive_events = _base.derive_events
compare_membership = _base.compare_membership
provenance_from_samples = _base.provenance_from_samples
so_pair_compatibility = _base.so_pair_compatibility
