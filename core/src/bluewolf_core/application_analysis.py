"""Python implementation of the Blue Wolf application/Core analysis envelope.

This module is intentionally pure: no UI, HTTP, DB, Influx or filesystem access.
It accepts the normalized NavigationDataset shape used by the application and
returns the stable CoreAnalysis / history / event envelope.  The web adapter can
therefore change transport or Python implementation without changing UI or DB.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Callable, Iterable, Mapping, Sequence

CORE_API_VERSION = "1.0.0"
DEFAULT_SO_GROUPING = {
    "maxParallelLegs": 1.5,
    "maxLateralLegs": 0.35,
    "maxAngleDeg": 20.0,
}
EMPTY_SCORE = {
    "total": 0,
    "sync": 0,
    "route": 0,
    "position": 0,
    "period": 0,
    "motion": 0,
    "distance": 0,
    "tangent": 0,
    "curvature": 0,
}


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _median(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2.0


def _wrap360(value: float) -> float:
    return value % 360.0


def _wrap180(value: float) -> float:
    return ((value + 180.0) % 360.0) - 180.0


def _axis_diff(first: float, second: float) -> float:
    delta = abs(_wrap180(first - second))
    return min(delta, abs(180.0 - delta))


def _distance(first: Mapping[str, float], second: Mapping[str, float]) -> float:
    return math.hypot(first["x"] - second["x"], first["y"] - second["y"])


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _score_round(value: float) -> int:
    return int(math.floor(_clamp(value, 0.0, 100.0) + 0.5))


def _transfer_score(error: float, full: float, zero: float) -> float:
    safe = max(0.0, error)
    if safe <= full:
        return 100.0
    if safe >= zero:
        return 0.0
    return 100.0 * (zero - safe) / max(1e-9, zero - full)


def _weighted(values: Sequence[float], weights: Sequence[float]) -> float:
    safe = [max(0.0, value) for value in weights]
    total = sum(safe)
    if total <= 0.0:
        return 0.0
    return sum(value * safe[index] for index, value in enumerate(values)) / total


def _thresholds(config: Mapping[str, Any]) -> Mapping[str, float]:
    return config.get("thresholds", {})


def _weights(config: Mapping[str, Any]) -> Mapping[str, Any]:
    return config.get("weights", {})


def _route_score_breakdown(
    distance_error_pct: float,
    tangent_error_deg: float,
    curvature_error_pct: float,
    config: Mapping[str, Any],
) -> dict[str, float]:
    thresholds = _thresholds(config)
    weights = _weights(config)
    distance_score = _transfer_score(
        distance_error_pct,
        float(thresholds.get("routeDistanceFullPct", 5.0)),
        float(thresholds.get("routeDistanceZeroPct", 30.0)),
    )
    tangent_score = _transfer_score(
        tangent_error_deg,
        float(thresholds.get("tangentFullDeg", 10.0)),
        float(thresholds.get("tangentZeroDeg", 60.0)),
    )
    curvature_score = _transfer_score(
        curvature_error_pct,
        float(thresholds.get("curvatureFullPct", 10.0)),
        float(thresholds.get("curvatureZeroPct", 100.0)),
    )
    route_weights = weights.get("route", {})
    route = _weighted(
        (distance_score, tangent_score, curvature_score),
        (
            float(route_weights.get("distance", 15.0)),
            float(route_weights.get("tangent", 70.0)),
            float(route_weights.get("curvature", 15.0)),
        ),
    )
    return {
        "distance": distance_score,
        "tangent": tangent_score,
        "curvature": curvature_score,
        "route": route,
    }


def _score_breakdown(
    position_score: float,
    route_score: float,
    route_parts: Mapping[str, float],
    period_error_pct: float,
    motion_error_pct: float,
    config: Mapping[str, Any],
) -> dict[str, int]:
    thresholds = _thresholds(config)
    weights = _weights(config)
    period = _transfer_score(
        period_error_pct,
        float(thresholds.get("periodFullPct", 5.0)),
        float(thresholds.get("periodZeroPct", 20.0)),
    )
    motion = _transfer_score(
        motion_error_pct,
        float(thresholds.get("motionFullPct", 10.0)),
        float(thresholds.get("motionZeroPct", 30.0)),
    )
    sync_weights = weights.get("sync", {})
    sync = _weighted(
        (position_score, period, motion),
        (
            float(sync_weights.get("position", 60.0)),
            float(sync_weights.get("period", 20.0)),
            float(sync_weights.get("motion", 20.0)),
        ),
    )
    total_weights = weights.get("total", {})
    total = _weighted(
        (sync, route_score),
        (
            float(total_weights.get("sync", 75.0)),
            float(total_weights.get("route", 25.0)),
        ),
    )
    return {
        "total": _score_round(total),
        "sync": _score_round(sync),
        "route": _score_round(route_score),
        "position": _score_round(position_score),
        "period": _score_round(period),
        "motion": _score_round(motion),
        "distance": _score_round(float(route_parts.get("distance", 0.0))),
        "tangent": _score_round(float(route_parts.get("tangent", 0.0))),
        "curvature": _score_round(float(route_parts.get("curvature", 0.0))),
    }


def _si_scores(
    observed_angles: Sequence[float],
    desired_angles: Sequence[float],
    route_score: float,
    route_parts: Mapping[str, float],
    period_error_pct: float,
    motion_error_pct: float,
    config: Mapping[str, Any],
) -> dict[str, int]:
    thresholds = _thresholds(config)
    count = min(len(observed_angles), len(desired_angles))
    if count:
        position = sum(
            _transfer_score(
                min(abs(observed_angles[index] - desired_angles[index]) % 360.0, 360.0 - abs(observed_angles[index] - desired_angles[index]) % 360.0),
                float(thresholds.get("siPositionFullDeg", 10.0)),
                float(thresholds.get("siPositionZeroDeg", 30.0)),
            )
            for index in range(count)
        ) / count
    else:
        position = 0.0
    return _score_breakdown(position, route_score, route_parts, period_error_pct, motion_error_pct, config)


def _relation_phase_error(observed: str, desired: str) -> float:
    if observed == desired:
        return 0.0
    if observed == "mixed" or desired == "mixed":
        return 0.25
    return 0.5


def _so_scores(
    observed_relations: Sequence[str],
    desired_relations: Sequence[str],
    route_score: float,
    route_parts: Mapping[str, float],
    period_error_pct: float,
    motion_error_pct: float,
    config: Mapping[str, Any],
) -> dict[str, int]:
    thresholds = _thresholds(config)
    count = min(len(observed_relations), len(desired_relations))
    if count:
        position = sum(
            _transfer_score(
                _relation_phase_error(observed_relations[index], desired_relations[index]) * 100.0,
                float(thresholds.get("soPositionFullPct", 5.0)),
                float(thresholds.get("soPositionZeroPct", 25.0)),
            )
            for index in range(count)
        ) / count
    else:
        position = 0.0
    return _score_breakdown(position, route_score, route_parts, period_error_pct, motion_error_pct, config)


@dataclass(slots=True)
class _Pca:
    center: dict[str, float]
    rotation_deg: float
    ux: float
    uy: float
    vx: float
    vy: float
    projected: list[dict[str, float]]
    min_u: float
    max_u: float
    min_v: float
    max_v: float
    major_span: float
    minor_span: float


@dataclass(slots=True)
class _Track:
    vehicle_id: int
    samples: list[Mapping[str, Any]]
    current: Mapping[str, Any]
    fit: _Pca
    kind: str
    phase: float
    direction: int
    period_sec: float | None
    route_score: float
    route_deviation: float
    route_deviation_pct: float
    tangent_error_deg: float
    route_parts: dict[str, float]
    geometry: dict[str, Any] | None


def _group_by_vehicle(samples: Iterable[Mapping[str, Any]]) -> dict[int, list[Mapping[str, Any]]]:
    grouped: dict[int, list[Mapping[str, Any]]] = {}
    for sample in samples:
        if bool(sample.get("active")):
            vehicle_id = int(sample["vehicleId"])
            grouped.setdefault(vehicle_id, []).append(sample)
    for values in grouped.values():
        values.sort(key=lambda sample: _parse_time(str(sample["timestamp"])))
    return grouped


def _pca(samples: Sequence[Mapping[str, Any]]) -> _Pca:
    points = [(float(item["x"]), float(item["y"])) for item in samples]
    cx = _mean([point[0] for point in points])
    cy = _mean([point[1] for point in points])
    xx = _mean([(point[0] - cx) ** 2 for point in points])
    yy = _mean([(point[1] - cy) ** 2 for point in points])
    xy = _mean([(point[0] - cx) * (point[1] - cy) for point in points])
    theta = 0.5 * math.atan2(2.0 * xy, xx - yy)
    ux, uy = math.cos(theta), math.sin(theta)
    vx, vy = -uy, ux
    projected = [
        {"u": (x - cx) * ux + (y - cy) * uy, "v": (x - cx) * vx + (y - cy) * vy}
        for x, y in points
    ]
    min_u = min(item["u"] for item in projected)
    max_u = max(item["u"] for item in projected)
    min_v = min(item["v"] for item in projected)
    max_v = max(item["v"] for item in projected)
    return _Pca(
        center={"x": cx, "y": cy},
        rotation_deg=math.degrees(theta),
        ux=ux,
        uy=uy,
        vx=vx,
        vy=vy,
        projected=projected,
        min_u=min_u,
        max_u=max_u,
        min_v=min_v,
        max_v=max_v,
        major_span=max_u - min_u,
        minor_span=max_v - min_v,
    )


def _current_heading(sample: Mapping[str, Any]) -> float:
    return _wrap360(math.degrees(math.atan2(float(sample.get("velocityEast", 0.0)), float(sample.get("velocityNorth", 0.0)))))


def _straight_band_count(samples: Sequence[Mapping[str, Any]], fit: _Pca) -> int:
    bands: list[float] = []
    step = max(1, len(samples) // 180)
    for index in range(0, len(samples), step):
        sample = samples[index]
        east = float(sample.get("velocityEast", 0.0))
        north = float(sample.get("velocityNorth", 0.0))
        if math.hypot(east, north) < 0.5:
            continue
        heading_axis = math.degrees(math.atan2(north, east))
        if _axis_diff(heading_axis, fit.rotation_deg) > 28.0:
            continue
        bands.append(fit.projected[index]["v"])
    if len(bands) < 8:
        return 2
    bands.sort()
    tolerance = max(6.0, fit.minor_span * 0.18)
    clusters = 1
    for index in range(1, len(bands)):
        if bands[index] - bands[index - 1] > tolerance:
            clusters += 1
    return clusters


def _estimate_kind(samples: Sequence[Mapping[str, Any]], fit: _Pca) -> str:
    aspect = fit.major_span / max(1.0, fit.minor_span)
    if aspect < 1.32:
        return "circle"
    return "double" if _straight_band_count(samples, fit) >= 3 else "single"


def _mean_speed(samples: Sequence[Mapping[str, Any]]) -> float:
    values = [
        math.hypot(float(sample.get("velocityEast", 0.0)), float(sample.get("velocityNorth", 0.0)))
        for sample in samples
    ]
    return _median([value for value in values if math.isfinite(value) and value > 0.1])


def _route_length(kind: str, fit: _Pca) -> float:
    if kind == "circle":
        return 2.0 * math.pi * max(1.0, (fit.major_span + fit.minor_span) / 4.0)
    radius = max(1.0, fit.minor_span / 2.0)
    leg = max(1.0, fit.major_span - 2.0 * radius)
    single = 2.0 * leg + 2.0 * math.pi * radius
    return 2.0 * single if kind == "double" else single


def _route_period(kind: str, fit: _Pca, samples: Sequence[Mapping[str, Any]]) -> float | None:
    speed = _mean_speed(samples)
    return _route_length(kind, fit) / speed if speed > 0.15 else None


def _phase_and_direction(kind: str, fit: _Pca, sample: Mapping[str, Any]) -> tuple[float, int]:
    dx = float(sample["x"]) - fit.center["x"]
    dy = float(sample["y"]) - fit.center["y"]
    east = float(sample.get("velocityEast", 0.0))
    north = float(sample.get("velocityNorth", 0.0))
    if kind == "circle":
        angle = math.atan2(dy, dx)
        tangent_east = -math.sin(angle)
        tangent_north = math.cos(angle)
        direction = 1 if east * tangent_east + north * tangent_north >= 0.0 else -1
        raw = _wrap360(math.degrees(angle)) / 360.0
        return (raw if direction == 1 else (1.0 - raw) % 1.0), direction
    u = dx * fit.ux + dy * fit.uy
    v = dx * fit.vx + dy * fit.vy
    u_norm = _clamp((u - fit.min_u) / max(1e-6, fit.max_u - fit.min_u), 0.0, 1.0)
    along = east * fit.ux + north * fit.uy
    side = 1 if v >= 0 else -1
    direction = (1 if along >= 0 else -1) if side > 0 else (1 if along <= 0 else -1)
    phase = u_norm * 0.5 if side > 0 else 0.5 + (1.0 - u_norm) * 0.5
    if direction == -1:
        phase = (1.0 - phase) % 1.0
    if kind == "double":
        phase = (phase * 2.0) % 1.0
    return phase, direction


def _nearest_distance_and_heading(samples: Sequence[Mapping[str, Any]], current: Mapping[str, Any]) -> tuple[float, float]:
    training = samples[: max(3, int(len(samples) * 0.8))]
    best = math.inf
    heading = _current_heading(current)
    for index in range(max(0, len(training) - 1)):
        first, second = training[index], training[index + 1]
        current_distance = math.hypot(float(current["x"]) - float(first["x"]), float(current["y"]) - float(first["y"]))
        if current_distance < best:
            best = current_distance
            heading = _wrap360(math.degrees(math.atan2(float(second["x"]) - float(first["x"]), float(second["y"]) - float(first["y"]))))
    return (best if math.isfinite(best) else 0.0), heading


def _build_track(vehicle_id: int, samples: list[Mapping[str, Any]], config: Mapping[str, Any]) -> _Track | None:
    if len(samples) < 4:
        return None
    current = samples[-1]
    fit = _pca(samples)
    kind = _estimate_kind(samples, fit)
    phase, direction = _phase_and_direction(kind, fit, current)
    route_deviation, nearest_heading = _nearest_distance_and_heading(samples, current)
    tangent_error = abs(_wrap180(_current_heading(current) - nearest_heading))
    radius = max(5.0, (fit.major_span + fit.minor_span) / 4.0 if kind == "circle" else fit.minor_span / 2.0)
    route_deviation_pct = route_deviation / radius * 100.0
    curvature_error_pct = abs(fit.major_span - fit.minor_span) / max(1.0, (fit.major_span + fit.minor_span) / 2.0) * 100.0 if kind == "circle" else 0.0
    route_parts = _route_score_breakdown(route_deviation_pct, tangent_error, curvature_error_pct, config)
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
    return _Track(
        vehicle_id=vehicle_id,
        samples=samples,
        current=current,
        fit=fit,
        kind=kind,
        phase=phase,
        direction=direction,
        period_sec=_route_period(kind, fit, samples),
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


def _unit(degrees_value: float) -> dict[str, float]:
    angle = math.radians(degrees_value)
    return {"x": math.cos(angle), "y": math.sin(angle)}


def _average_axis_deg(first: float, second: float) -> float:
    directed = abs(_wrap180(second - first))
    adjusted = second + 180.0 if directed > 90.0 else second
    a, b = _unit(first), _unit(adjusted)
    return math.degrees(math.atan2(a["y"] + b["y"], a["x"] + b["x"]))


def _segments(geometry: Mapping[str, Any]) -> list[dict[str, Any]]:
    center = geometry["center"]
    if geometry["kind"] == "single":
        leg = max(1.0, float(geometry["legLength"]))
        axis = float(geometry["rotationDeg"])
        unit = _unit(axis)
        return [{
            "angleDeg": axis,
            "leg": leg,
            "turns": [
                {"x": center["x"] - unit["x"] * leg / 2.0, "y": center["y"] - unit["y"] * leg / 2.0},
                {"x": center["x"] + unit["x"] * leg / 2.0, "y": center["y"] + unit["y"] * leg / 2.0},
            ],
        }]
    first_leg = max(1.0, float(geometry["legLength"]))
    second_leg = max(1.0, float(geometry.get("secondLegLength", geometry["legLength"])))
    first_axis = float(geometry["rotationDeg"])
    second_axis = first_axis + float(geometry.get("bendDeg", 28.0))
    first_unit, second_unit = _unit(first_axis), _unit(second_axis)
    return [
        {
            "angleDeg": first_axis,
            "leg": first_leg,
            "turns": [dict(center), {"x": center["x"] - first_unit["x"] * first_leg, "y": center["y"] - first_unit["y"] * first_leg}],
        },
        {
            "angleDeg": second_axis,
            "leg": second_leg,
            "turns": [dict(center), {"x": center["x"] + second_unit["x"] * second_leg, "y": center["y"] + second_unit["y"] * second_leg}],
        },
    ]


def so_pair_compatibility(
    first: Mapping[str, Any],
    second: Mapping[str, Any],
    settings: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    settings = settings or DEFAULT_SO_GROUPING
    best: dict[str, Any] | None = None
    best_cost = math.inf
    max_angle = float(settings.get("maxAngleDeg", 20.0))
    max_parallel = float(settings.get("maxParallelLegs", 1.5))
    max_lateral = float(settings.get("maxLateralLegs", 0.35))
    for first_segment in _segments(first):
        for second_segment in _segments(second):
            angle_diff = _axis_diff(float(first_segment["angleDeg"]), float(second_segment["angleDeg"]))
            axis = _average_axis_deg(float(first_segment["angleDeg"]), float(second_segment["angleDeg"]))
            unit = _unit(axis)
            normal = {"x": -unit["y"], "y": unit["x"]}
            mean_leg = max(1.0, (float(first_segment["leg"]) + float(second_segment["leg"])) / 2.0)
            for first_turn in first_segment["turns"]:
                for second_turn in second_segment["turns"]:
                    delta = {"x": second_turn["x"] - first_turn["x"], "y": second_turn["y"] - first_turn["y"]}
                    parallel_distance = abs(delta["x"] * unit["x"] + delta["y"] * unit["y"])
                    lateral_distance = abs(delta["x"] * normal["x"] + delta["y"] * normal["y"])
                    parallel_legs = parallel_distance / mean_leg
                    lateral_legs = lateral_distance / mean_leg
                    valid = angle_diff <= max_angle and parallel_legs <= max_parallel and lateral_legs <= max_lateral
                    cost = angle_diff / max(1.0, max_angle) + parallel_legs / max(0.01, max_parallel) + lateral_legs / max(0.01, max_lateral)
                    explanation = (
                        f"חוקיות תקינה: הפרש חזית {angle_diff:.1f}°, מרחק מקביל {parallel_legs:.2f} Leg, מרחק רוחבי {lateral_legs:.2f} Leg."
                        if valid
                        else f"לא מקובץ: הפרש חזית {angle_diff:.1f}° (סף {max_angle:g}°), מקביל {parallel_legs:.2f} Leg (סף {max_parallel:g}), רוחבי {lateral_legs:.2f} Leg (סף {max_lateral:g})."
                    )
                    candidate = {
                        "valid": valid,
                        "angleDiffDeg": angle_diff,
                        "parallelDistance": parallel_distance,
                        "lateralDistance": lateral_distance,
                        "meanLeg": mean_leg,
                        "parallelLegs": parallel_legs,
                        "lateralLegs": lateral_legs,
                        "axisDeg": axis,
                        "explanation": explanation,
                    }
                    if best is None or (valid and not best["valid"]) or (valid == best["valid"] and cost < best_cost):
                        best, best_cost = candidate, cost
    return best or {
        "valid": False,
        "angleDiffDeg": 180.0,
        "parallelDistance": 1e9,
        "lateralDistance": 1e9,
        "meanLeg": 1.0,
        "parallelLegs": 1e9,
        "lateralLegs": 1e9,
        "axisDeg": 0.0,
        "explanation": "לא ניתן לחשב חוקיות גאומטרית.",
    }


def _largest_compatible_component(tracks: Sequence[_Track], settings: Mapping[str, Any]) -> tuple[list[_Track], list[_Track], dict[str, dict[str, Any]]]:
    if len(tracks) <= 1:
        return list(tracks), [], {}
    adjacency = [set() for _ in tracks]
    evidence: dict[str, dict[str, Any]] = {}
    for first_index in range(len(tracks)):
        for second_index in range(first_index + 1, len(tracks)):
            item = so_pair_compatibility(tracks[first_index].geometry or {}, tracks[second_index].geometry or {}, settings)
            evidence[f"{first_index}:{second_index}"] = item
            if item["valid"]:
                adjacency[first_index].add(second_index)
                adjacency[second_index].add(first_index)
    visited: set[int] = set()
    components: list[list[int]] = []
    for start in range(len(tracks)):
        if start in visited:
            continue
        stack = [start]
        component: list[int] = []
        visited.add(start)
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


def _classify_phase(difference: float) -> str:
    value = difference % 1.0
    same = min(value, 1.0 - value)
    opposite = abs(value - 0.5)
    if same <= 0.125:
        return "same"
    if opposite <= 0.125:
        return "opposite"
    return "mixed"


def _template_relations(config: Mapping[str, Any]) -> list[str]:
    template = config.get("soTemplate") or {}
    so_spec = template.get("soSpec") or {}
    relations = so_spec.get("relations") or []
    if relations:
        return [str(value) for value in relations]
    return ["same" if int(value) == 0 else "opposite" if int(value) == 2 else "mixed" for value in template.get("values", [])]


def _display_transform(tracks: Sequence[_Track]) -> Callable[[Mapping[str, Any]], dict[str, float]]:
    points = [(float(sample["x"]), float(sample["y"])) for track in tracks for sample in track.samples]
    if not points:
        return lambda _point: {"x": 500.0, "y": 285.0}
    min_x, max_x = min(value[0] for value in points), max(value[0] for value in points)
    min_y, max_y = min(value[1] for value in points), max(value[1] for value in points)
    span_x, span_y = max(80.0, max_x - min_x), max(60.0, max_y - min_y)
    scale = min(820.0 / span_x, 450.0 / span_y)
    cx, cy = (min_x + max_x) / 2.0, (min_y + max_y) / 2.0
    return lambda point: {"x": 500.0 + (float(point["x"]) - cx) * scale, "y": 285.0 - (float(point["y"]) - cy) * scale}


def _downsample_path(samples: Sequence[Mapping[str, Any]], transform: Callable[[Mapping[str, Any]], dict[str, float]]) -> list[dict[str, float]]:
    step = max(1, len(samples) // 100)
    return [transform(sample) for index, sample in enumerate(samples) if index % step == 0]


def _period_stats(tracks: Sequence[_Track]) -> dict[str, float]:
    periods = [float(track.period_sec) for track in tracks if track.period_sec is not None and math.isfinite(track.period_sec)]
    average_period = _mean(periods)
    speeds = [_mean_speed(track.samples) for track in tracks]
    average_speed = _mean(speeds)
    return {
        "periodErrorPct": _mean([abs(value - average_period) / average_period * 100.0 for value in periods]) if average_period > 0 else 0.0,
        "motionErrorPct": _mean([abs(value - average_speed) / average_speed * 100.0 for value in speeds]) if average_speed > 0 else 0.0,
        "meanPeriod": average_period,
    }


def _si_observed_angles(tracks: Sequence[_Track]) -> list[float]:
    if len(tracks) < 2:
        return []
    center = {"x": _mean([track.fit.center["x"] for track in tracks]), "y": _mean([track.fit.center["y"] for track in tracks])}
    ordered = sorted(tracks, key=lambda track: track.vehicle_id)
    output: list[float] = []
    for index in range(len(ordered) - 1):
        first, second = ordered[index], ordered[index + 1]
        first_angle = math.degrees(math.atan2(float(first.current["y"]) - center["y"], float(first.current["x"]) - center["x"]))
        second_angle = math.degrees(math.atan2(float(second.current["y"]) - center["y"], float(second.current["x"]) - center["x"]))
        output.append(abs(_wrap180(second_angle - first_angle)))
    return output


def _aggregate_route_parts(tracks: Sequence[_Track]) -> dict[str, float]:
    return {
        "distance": _mean([track.route_parts["distance"] for track in tracks]),
        "tangent": _mean([track.route_parts["tangent"] for track in tracks]),
        "curvature": _mean([track.route_parts["curvature"] for track in tracks]),
    }


def _wind_estimate(track: _Track, provenance: Mapping[str, Any]) -> dict[str, float]:
    speed = _mean_speed(track.samples)
    if track.kind == "circle":
        dx = float(track.current["x"]) - track.fit.center["x"]
        dy = float(track.current["y"]) - track.fit.center["y"]
        length = max(1e-6, math.hypot(dx, dy))
        radial_x, radial_y = dx / length, dy / length
        expected_east = -radial_y * speed * track.direction
        expected_north = radial_x * speed * track.direction
    else:
        along = float(track.current.get("velocityEast", 0.0)) * track.fit.ux + float(track.current.get("velocityNorth", 0.0)) * track.fit.uy
        along_sign = 1.0 if along >= 0.0 else -1.0
        expected_east = track.fit.ux * speed * along_sign
        expected_north = track.fit.uy * speed * along_sign
    residual_east = float(track.current.get("velocityEast", 0.0)) - expected_east
    residual_north = float(track.current.get("velocityNorth", 0.0)) - expected_north
    mps = math.hypot(residual_east, residual_north)
    completeness = provenance.get("completenessPct")
    data_factor = min(100.0, len(track.samples) / 12.0 * 100.0) if completeness is None else float(completeness)
    confidence = _clamp(track.route_score * 0.72 + data_factor * 0.28, 0.0, 99.0)
    return {
        "speedKnots": mps * 1.9438444924406,
        "bearingDeg": 0.0 if mps < 0.05 else _wrap360(math.degrees(math.atan2(residual_east, residual_north))),
        "confidencePct": confidence,
        "residualNorth": residual_north,
        "residualEast": residual_east,
    }


def _group_vehicle_scores(
    tracks: Sequence[_Track],
    group_score: Mapping[str, int],
    timing: Mapping[str, float],
    provenance: Mapping[str, Any],
    config: Mapping[str, Any],
) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    average_speed = _mean([_mean_speed(track.samples) for track in tracks])
    thresholds = _thresholds(config)
    weights = _weights(config)
    for track in tracks:
        period_error = abs(float(track.period_sec) - timing["meanPeriod"]) / timing["meanPeriod"] * 100.0 if track.period_sec and timing["meanPeriod"] else 0.0
        speed = _mean_speed(track.samples)
        motion_error = abs(speed - average_speed) / average_speed * 100.0 if average_speed > 0.0 else 0.0
        period = _transfer_score(period_error, float(thresholds.get("periodFullPct", 5.0)), float(thresholds.get("periodZeroPct", 20.0)))
        motion = _transfer_score(motion_error, float(thresholds.get("motionFullPct", 10.0)), float(thresholds.get("motionZeroPct", 30.0)))
        sync_weights = weights.get("sync", {})
        sync = _weighted(
            (float(group_score.get("position", 0.0)), period, motion),
            (float(sync_weights.get("position", 60.0)), float(sync_weights.get("period", 20.0)), float(sync_weights.get("motion", 20.0))),
        )
        total_weights = weights.get("total", {})
        total = _weighted((sync, track.route_score), (float(total_weights.get("sync", 75.0)), float(total_weights.get("route", 25.0))))
        output[str(track.vehicle_id)] = {
            "id": track.vehicle_id,
            "kind": track.kind,
            "routeScore": _score_round(track.route_score),
            "sync": _score_round(sync),
            "total": _score_round(total),
            "routeDeviation": track.route_deviation,
            "routeDeviationPct": track.route_deviation_pct,
            "tangentErrorDeg": track.tangent_error_deg,
            "periodSec": track.period_sec,
            "periodErrorPct": period_error,
            "motionErrorPct": motion_error,
            "phase": track.phase,
            "direction": track.direction,
            "wind": _wind_estimate(track, provenance),
        }
    return output


def _empty_group(key: str) -> dict[str, Any]:
    return {
        "key": key,
        "id": "SI-NODATA" if key == "si" else "SO-NODATA",
        "name": "SI" if key == "si" else "SO",
        "family": "SI" if key == "si" else "SO",
        "members": [],
        "score": dict(EMPTY_SCORE),
        "routeScore": 0,
        "observedAngles": [],
        "observedRelations": [],
        "periodErrorPct": 0,
        "motionErrorPct": 0,
        "vehicles": {},
    }


def _alerts(groups: Mapping[str, Mapping[str, Any]], ungrouped: Sequence[int], provenance: Mapping[str, Any], config: Mapping[str, Any]) -> list[dict[str, Any]]:
    if not int(provenance.get("sampleCount", 0)):
        return [{
            "id": "no-data",
            "severity": "critical",
            "title": "אין נתוני ניווט",
            "detail": "לא התקבלו דגימות בטווח המבוקש ולכן לא חושבו ציונים, קבוצות או שערוך רוח.",
            "vehicleIds": [],
            "evidence": list(provenance.get("warnings", [])),
        }]
    alerts: list[dict[str, Any]] = []
    completeness = provenance.get("completenessPct")
    if completeness is not None and float(completeness) < 80.0:
        median_seconds = provenance.get("samplingMedianSeconds")
        alerts.append({
            "id": "data-gaps",
            "severity": "warning",
            "title": "שלמות נתונים נמוכה",
            "detail": f"שלמות הדגימות המחושבת היא {float(completeness):.1f}%. יש לפרש ציונים ואירועים בזהירות.",
            "vehicleIds": [],
            "evidence": [f"{provenance.get('sampleCount', 0)} דגימות", f"מרווח חציוני {float(median_seconds):.1f} שנ׳" if median_seconds is not None else "מרווח חציוני — שנ׳"],
        })
    if ungrouped:
        alerts.append({
            "id": "ungrouped",
            "severity": "warning",
            "title": "רכבים מחוץ לקבוצת SO",
            "detail": f"הרכבים {', '.join(str(item) for item in ungrouped)} אינם מקיימים את חוקיות הקיבוץ ולכן אינם משתתפים בציון הקבוצה.",
            "vehicleIds": list(ungrouped),
            "evidence": [],
        })
    thresholds = _thresholds(config)
    for key in ("si", "so"):
        group = groups[key]
        if not group["members"]:
            continue
        period_error = float(group["periodErrorPct"])
        full_period = float(thresholds.get("periodFullPct", 5.0))
        zero_period = float(thresholds.get("periodZeroPct", 20.0))
        if period_error > full_period:
            alerts.append({
                "id": f"{key}-period",
                "severity": "critical" if period_error >= zero_period else "warning",
                "title": f"שינוי זמן מחזור בקבוצת {key.upper()}",
                "detail": f"פער זמן המחזור שנגזר מהניווט הוא {period_error:.1f}%. סף מלא {full_period:g}% וסף אפס {zero_period:g}%.",
                "vehicleIds": list(group["members"]),
                "evidence": [f"Sync {group['score']['sync']}", f"רכיב מחזור {group['score']['period']}"],
            })
        vehicles = list(group["vehicles"].values())
        worst = max(vehicles, key=lambda item: float(item["routeDeviationPct"]), default=None)
        full_distance = float(thresholds.get("routeDistanceFullPct", 5.0))
        zero_distance = float(thresholds.get("routeDistanceZeroPct", 30.0))
        if worst is not None and float(worst["routeDeviationPct"]) > full_distance:
            alerts.append({
                "id": f"{key}-route-{worst['id']}",
                "severity": "critical" if float(worst["routeDeviationPct"]) >= zero_distance else "warning",
                "title": f"סטיית נתיב ברכב {worst['id']}",
                "detail": f"הסטייה הנוכחית היא {float(worst['routeDeviation']):.1f} מ׳ ({float(worst['routeDeviationPct']):.1f}% מרדיוס הייחוס), מול סף מלא {full_distance:g}% וסף אפס {zero_distance:g}%.",
                "vehicleIds": [int(worst["id"])],
                "evidence": [f"שגיאת משיק {float(worst['tangentErrorDeg']):.1f}°", f"ציון נתיב {worst['routeScore']}"],
            })
    if not alerts:
        alerts.append({
            "id": "stable",
            "severity": "info",
            "title": "אין חריגה מאושרת כרגע",
            "detail": "הציונים, זמני המחזור והסטיות המחושבים מנתוני הניווט נמצאים בתחום התקין של הספים המוגדרים.",
            "vehicleIds": [],
            "evidence": [],
        })
    return alerts


def analyze_navigation_dataset(dataset: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    provenance = dict(dataset.get("provenance", {}))
    grouped = _group_by_vehicle(dataset.get("samples", []))
    tracks = [track for vehicle_id, samples in grouped.items() if (track := _build_track(vehicle_id, samples, config)) is not None]
    if not tracks:
        groups = {"si": _empty_group("si"), "so": _empty_group("so")}
        return {
            "coreApiVersion": CORE_API_VERSION,
            "available": False,
            "provenance": provenance,
            "routes": [],
            "groups": groups,
            "ungroupedVehicles": [],
            "current": {},
            "alerts": _alerts(groups, [], provenance, config),
            "groupingNotes": [],
        }

    transform = _display_transform(tracks)
    circles = [track for track in tracks if track.kind == "circle"]
    so_tracks = [track for track in tracks if track.kind != "circle" and track.geometry is not None]
    center_compatible = [
        track
        for track in circles
        if all(
            other is track or _distance(track.fit.center, other.fit.center) <= max(track.fit.minor_span, other.fit.minor_span) * 0.7
            for other in circles
        )
    ]
    si_tracks = center_compatible if len(center_compatible) >= 2 else []
    grouping_settings = config.get("groupingSettings") or DEFAULT_SO_GROUPING
    grouped_so, _discarded_so, pair_evidence = _largest_compatible_component(so_tracks, grouping_settings)
    active_so = grouped_so if len(grouped_so) >= 2 else []
    active_ids = {track.vehicle_id for track in active_so}
    ungrouped = [track.vehicle_id for track in so_tracks if track.vehicle_id not in active_ids]
    grouping_notes = [f"{key}: {value['explanation']}" for key, value in pair_evidence.items()]

    si_timing, so_timing = _period_stats(si_tracks), _period_stats(active_so)
    si_angles = _si_observed_angles(si_tracks)
    ordered_so = sorted(active_so, key=lambda track: (track.fit.center["x"], track.vehicle_id))
    so_relations = [_classify_phase(ordered_so[index + 1].phase - ordered_so[index].phase) for index in range(max(0, len(ordered_so) - 1))]
    si_route_score = _mean([track.route_score for track in si_tracks])
    so_route_score = _mean([track.route_score for track in active_so])
    si_route_parts, so_route_parts = _aggregate_route_parts(si_tracks), _aggregate_route_parts(active_so)
    desired_si = list((config.get("siTemplate") or {}).get("values", []))
    si_score = _si_scores(si_angles, desired_si, si_route_score, si_route_parts, si_timing["periodErrorPct"], si_timing["motionErrorPct"], config) if len(si_tracks) >= 2 else dict(EMPTY_SCORE)
    so_score = _so_scores(so_relations, _template_relations(config), so_route_score, so_route_parts, so_timing["periodErrorPct"], so_timing["motionErrorPct"], config) if len(active_so) >= 2 else dict(EMPTY_SCORE)
    groups = {
        "si": {
            "key": "si", "id": "SI-NAV", "name": "קבוצת SI", "family": "SI",
            "members": [track.vehicle_id for track in si_tracks], "score": si_score,
            "routeScore": si_route_score, "observedAngles": si_angles, "observedRelations": [],
            "periodErrorPct": si_timing["periodErrorPct"], "motionErrorPct": si_timing["motionErrorPct"],
            "vehicles": _group_vehicle_scores(si_tracks, si_score, si_timing, provenance, config),
        },
        "so": {
            "key": "so", "id": "SO-NAV", "name": "קבוצת SO", "family": "SO",
            "members": [track.vehicle_id for track in active_so], "score": so_score,
            "routeScore": so_route_score, "observedAngles": [], "observedRelations": so_relations,
            "periodErrorPct": so_timing["periodErrorPct"], "motionErrorPct": so_timing["motionErrorPct"],
            "vehicles": _group_vehicle_scores(active_so, so_score, so_timing, provenance, config),
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
            "points": _downsample_path(track.samples, transform),
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
            "headingDeg": _current_heading(track.current),
            "latitude": float(track.current["latitude"]),
            "longitude": float(track.current["longitude"]),
            "timestamp": str(track.current["timestamp"]),
        }
    return {
        "coreApiVersion": CORE_API_VERSION,
        "available": True,
        "provenance": provenance,
        "routes": routes,
        "groups": groups,
        "ungroupedVehicles": ungrouped,
        "current": current,
        "alerts": _alerts(groups, ungrouped, provenance, config),
        "groupingNotes": grouping_notes,
    }


def compare_membership(first: Mapping[str, Any], second: Mapping[str, Any]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key in ("si", "so"):
        before = set(first["groups"][key]["members"])
        after = set(second["groups"][key]["members"])
        output[key] = {
            "joined": sorted(after - before),
            "left": sorted(before - after),
        }
    return output


def provenance_from_samples(source: str, server_id: str, start: datetime, end: datetime, samples: Sequence[Mapping[str, Any]], warnings: Sequence[str] = ()) -> dict[str, Any]:
    vehicles = {int(sample["vehicleId"]) for sample in samples}
    times = sorted({_parse_time(str(sample["timestamp"])) for sample in samples})
    gaps = [(times[index] - times[index - 1]).total_seconds() for index in range(1, len(times)) if times[index] > times[index - 1]]
    sampling = _median(gaps) if gaps else None
    latest = times[-1] if times else None
    expected = (max(1, round((end - start).total_seconds() / sampling) + 1) * max(1, len(vehicles))) if sampling and sampling > 0 else None
    return {
        "source": source,
        "serverId": server_id,
        "from": _iso(start),
        "to": _iso(end),
        "latestSampleAt": _iso(latest) if latest else None,
        "sampleCount": len(samples),
        "vehicleCount": len(vehicles),
        "samplingMedianSeconds": sampling,
        "completenessPct": min(100.0, len(samples) / expected * 100.0) if expected else None,
        "freshnessSeconds": max(0.0, (end - latest).total_seconds()) if latest else None,
        "warnings": list(warnings),
    }


def build_analysis_history(dataset: Mapping[str, Any], config: Mapping[str, Any], max_frames: int = 61, lookback_minutes: int = 12) -> list[dict[str, Any]]:
    samples = list(dataset.get("samples", []))
    times = sorted({str(sample["timestamp"]) for sample in samples}, key=_parse_time)
    if not times:
        return []
    step = max(1, len(times) // max_frames)
    selected = [value for index, value in enumerate(times) if index % step == 0]
    if selected[-1] != times[-1]:
        selected.append(times[-1])
    provenance = dataset.get("provenance", {})
    output: list[dict[str, Any]] = []
    for timestamp in selected:
        end = _parse_time(timestamp)
        start = end - timedelta(minutes=lookback_minutes)
        sliced = [sample for sample in samples if start <= _parse_time(str(sample["timestamp"])) <= end]
        slice_dataset = {
            "samples": sliced,
            "provenance": provenance_from_samples(str(provenance.get("source", "simulation")), str(provenance.get("serverId", "1")), start, end, sliced, provenance.get("warnings", [])),
        }
        output.append({"timestamp": timestamp, "analysis": analyze_navigation_dataset(slice_dataset, config)})
    return output


def _route_signature(analysis: Mapping[str, Any], key: str) -> str:
    members = set(analysis["groups"][key]["members"])
    return "|".join(sorted(f"{route['vehicleId']}:{route['kind']}" for route in analysis["routes"] if route["vehicleId"] in members))


def _state_key(frame: Mapping[str, Any], key: str, thresholds: Mapping[str, Any]) -> str:
    group = frame["analysis"]["groups"][key]
    period = float(group["periodErrorPct"])
    full = float(thresholds.get("periodFullPct", 5.0))
    zero = float(thresholds.get("periodZeroPct", 20.0))
    band = "period-critical" if period >= zero else "period-warning" if period > full else "period-ok"
    members = ",".join(str(value) for value in sorted(group["members"]))
    return f"{members}#{_route_signature(frame['analysis'], key)}#{band}"


def _membership_text(change: Mapping[str, Sequence[int]]) -> str:
    parts: list[str] = []
    if change["joined"]:
        parts.append(f"הצטרפו {', '.join(str(value) for value in change['joined'])}")
    if change["left"]:
        parts.append(f"יצאו {', '.join(str(value) for value in change['left'])}")
    return "; ".join(parts)


def _boundary_reason(previous: Mapping[str, Any] | None, current: Mapping[str, Any], key: str, thresholds: Mapping[str, Any]) -> tuple[str, list[str]]:
    group = current["analysis"]["groups"][key]
    if previous is None:
        return (
            f"תחילת טווח: זוהתה קבוצת {key.upper()} עם {len(group['members'])} רכבים מתוך נתוני הניווט.",
            [f"רכבים: {', '.join(str(value) for value in group['members']) or 'אין'}", f"Sync {group['score']['sync']}", f"Route {group['score']['route']}"],
        )
    membership = compare_membership(previous["analysis"], current["analysis"])[key]
    membership_reason = _membership_text(membership)
    if membership_reason:
        return (
            f"שינוי חברות שאושר בחלון הניתוח: {membership_reason}.",
            [f"לפני: {', '.join(str(value) for value in previous['analysis']['groups'][key]['members']) or 'אין'}", f"אחרי: {', '.join(str(value) for value in group['members']) or 'אין'}"],
        )
    old_route, new_route = _route_signature(previous["analysis"], key), _route_signature(current["analysis"], key)
    if old_route != new_route:
        return "זוהה שינוי במשפחת/גאומטריית הנתיב מתוך עקבות הניווט ולכן נפתח אירוע חדש.", [f"לפני: {old_route or 'אין'}", f"אחרי: {new_route or 'אין'}"]
    before_period = float(previous["analysis"]["groups"][key]["periodErrorPct"])
    now_period = float(group["periodErrorPct"])
    full = float(thresholds.get("periodFullPct", 5.0))
    zero = float(thresholds.get("periodZeroPct", 20.0))
    if (before_period <= full < now_period) or (before_period < zero <= now_period):
        return f"פער זמן המחזור חצה סף: {before_period:.1f}% → {now_period:.1f}%.", [f"סף מלא {full:g}%", f"סף אפס {zero:g}%"]
    return "מצב הקבוצה השתנה לפי ראיות הניווט והוגדר גבול אירוע חדש.", [f"Sync {group['score']['sync']}", f"Route {group['score']['route']}", f"Period error {now_period:.1f}%"]


def derive_events(history: Sequence[Mapping[str, Any]], thresholds: Mapping[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for key in ("si", "so"):
        current_frames: list[Mapping[str, Any]] = []
        current_state = ""
        start_reason = ""
        start_evidence: list[str] = []

        def flush(end_reason: str, end_evidence: list[str]) -> None:
            nonlocal current_frames
            if not current_frames:
                return
            representative = current_frames[len(current_frames) // 2]["analysis"]
            group = representative["groups"][key]
            events.append({
                "id": "",
                "index": 0,
                "start": current_frames[0]["timestamp"],
                "end": current_frames[-1]["timestamp"],
                "family": "SI" if key == "si" else "SO",
                "groupKey": key,
                "members": list(group["members"]),
                "startReason": start_reason,
                "endReason": end_reason,
                "startEvidence": list(start_evidence),
                "endEvidence": end_evidence,
                "frames": list(current_frames),
                "representative": representative,
            })
            current_frames = []

        for index, frame in enumerate(history):
            group = frame["analysis"]["groups"][key]
            if not group["members"]:
                if current_frames:
                    flush("הקבוצה חדלה להתקיים/להיות ניתנת לזיהוי בנתוני הניווט.", ["אין חברי קבוצה מזוהים"])
                current_state = ""
                continue
            state = _state_key(frame, key, thresholds)
            if not current_frames:
                start_reason, start_evidence = _boundary_reason(history[index - 1] if index else None, frame, key, thresholds)
                current_state = state
                current_frames = [frame]
                continue
            if state != current_state:
                boundary_text, boundary_evidence = _boundary_reason(history[index - 1], frame, key, thresholds)
                flush(f"האירוע הסתיים לפני שינוי מאושר: {boundary_text}", boundary_evidence)
                start_reason, start_evidence = boundary_text, boundary_evidence
                current_state = state
                current_frames = [frame]
            else:
                current_frames.append(frame)
        if current_frames:
            flush("סוף טווח התחקור שנבחר; לא זוהה שינוי מאושר נוסף לפני הגבול.", [f"סוף טווח: {current_frames[-1]['timestamp']}"])
    events.sort(key=lambda event: _parse_time(str(event["start"])))
    for index, event in enumerate(events):
        event["index"] = index
        event["id"] = f"E{index + 1}"
    return events
