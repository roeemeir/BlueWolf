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


_base._build_track = _build_track
_base._segments = _segments

CORE_API_VERSION = _base.CORE_API_VERSION
DEFAULT_SO_GROUPING = _base.DEFAULT_SO_GROUPING
analyze_navigation_dataset = _base.analyze_navigation_dataset
build_analysis_history = _base.build_analysis_history
derive_events = _base.derive_events
compare_membership = _base.compare_membership
provenance_from_samples = _base.provenance_from_samples
so_pair_compatibility = _base.so_pair_compatibility
