"""Blue Wolf v0.8 algorithm hardening layer.

This module deliberately keeps the operational rules explicit and testable:
- route classification is geometry driven and score independent;
- SI grouping uses center + period + rotation;
- SO grouping uses endpoint adjacency + axis alignment + period, including
  the approved single/double 2x-period equivalence;
- SO template legality is validated before scoring;
- route history is bounded and confirmed routes can be revised only after a
  stable 20% geometry/period change for 120 seconds.

It is additive to the v0.2 public core so the stable API remains available
while v0.8 behavior is exercised and integrated.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Iterable, Sequence

_EPS = 1e-9


class RouteKind(StrEnum):
    SI = "si"
    SO = "so"
    FREE = "free"


class RouteShape(StrEnum):
    COMPACT = "compact"
    HIPPODROME = "hippodrome"
    DOUBLE_HIPPODROME = "double_hippodrome"
    FIGURE_EIGHT = "figure_eight"


class Rotation(StrEnum):
    CW = "cw"
    CCW = "ccw"
    UNKNOWN = "unknown"


class SoEntityKind(StrEnum):
    SINGLE = "single"
    DOUBLE = "double"
    FIGURE_EIGHT = "figure8"


class SoRelation(StrEnum):
    SAME = "same"
    OPPOSITE = "opposite"
    MIXED = "mixed"


@dataclass(frozen=True, slots=True)
class Point2D:
    x: float
    y: float


@dataclass(frozen=True, slots=True)
class RouteDescriptor:
    family: RouteKind
    shape: RouteShape
    rotation: Rotation
    center: Point2D
    long_axis: float
    short_axis: float
    orientation_deg: float
    period_s: float
    length: float
    axis_ratio: float
    waist_ratio: float
    turn_clusters: int
    self_intersections: int
    endpoints: tuple[Point2D, Point2D]
    quality: float


@dataclass(frozen=True, slots=True)
class SoEntity:
    kind: SoEntityKind
    vehicle_count: int
    vehicle_types: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class SoLayout:
    entities: tuple[SoEntity, ...]
    relations: tuple[SoRelation, ...]


@dataclass(frozen=True, slots=True)
class LifecycleEvent:
    kind: str
    at_s: float
    revision: int
    descriptor: RouteDescriptor


@dataclass(slots=True)
class RouteLifecycleV08:
    """Bounded, deterministic route lifecycle.

    The lifecycle accepts already classified descriptors. In the product the
    descriptor is produced from the rolling navigation window; separating the
    state machine makes its timing rules independently testable.
    """

    history_seconds: float = 600.0
    candidate_seconds: float = 60.0
    confirm_seconds: float = 300.0
    geometry_change_ratio: float = 0.20
    period_change_ratio: float = 0.20
    revision_confirm_seconds: float = 120.0
    history: list[tuple[float, RouteDescriptor]] = field(default_factory=list)
    candidate: RouteDescriptor | None = None
    candidate_since: float | None = None
    candidate_emitted: bool = False
    confirmed: RouteDescriptor | None = None
    pending_revision: RouteDescriptor | None = None
    pending_since: float | None = None
    revision: int = 0

    def push(self, at_s: float, descriptor: RouteDescriptor) -> tuple[LifecycleEvent, ...]:
        if not math.isfinite(at_s):
            raise ValueError("at_s must be finite")
        self.history.append((at_s, descriptor))
        cutoff = at_s - self.history_seconds
        while self.history and self.history[0][0] < cutoff:
            self.history.pop(0)

        events: list[LifecycleEvent] = []
        if self.confirmed is None:
            if self.candidate is None or material_change(
                self.candidate,
                descriptor,
                self.geometry_change_ratio,
                self.period_change_ratio,
            ):
                self.candidate = descriptor
                self.candidate_since = at_s
                self.candidate_emitted = False
                return ()

            assert self.candidate_since is not None
            stable_for = at_s - self.candidate_since
            if stable_for >= self.candidate_seconds and not self.candidate_emitted:
                self.candidate_emitted = True
                events.append(LifecycleEvent("route_candidate", at_s, self.revision, descriptor))
            if stable_for >= self.confirm_seconds:
                self.confirmed = descriptor
                self.candidate = descriptor
                self.pending_revision = None
                self.pending_since = None
                events.append(LifecycleEvent("route_confirmed", at_s, self.revision, descriptor))
            return tuple(events)

        if not material_change(
            self.confirmed,
            descriptor,
            self.geometry_change_ratio,
            self.period_change_ratio,
        ):
            self.pending_revision = None
            self.pending_since = None
            return ()

        if self.pending_revision is None or material_change(
            self.pending_revision,
            descriptor,
            self.geometry_change_ratio,
            self.period_change_ratio,
        ):
            self.pending_revision = descriptor
            self.pending_since = at_s
            return (LifecycleEvent("route_revision_candidate", at_s, self.revision, descriptor),)

        assert self.pending_since is not None
        if at_s - self.pending_since >= self.revision_confirm_seconds:
            self.confirmed = descriptor
            self.pending_revision = None
            self.pending_since = None
            self.revision += 1
            return (LifecycleEvent("route_revised", at_s, self.revision, descriptor),)
        return ()


def _distance(a: Point2D, b: Point2D) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def _polyline_length(points: Sequence[Point2D]) -> float:
    if len(points) < 2:
        return 0.0
    return sum(_distance(a, b) for a, b in zip(points, points[1:])) + _distance(points[-1], points[0])


def _signed_area(points: Sequence[Point2D]) -> float:
    return 0.5 * sum(
        a.x * b.y - b.x * a.y
        for a, b in zip(points, points[1:] + points[:1])
    )


def _pca(points: Sequence[Point2D]) -> tuple[Point2D, float, float, float]:
    cx = sum(p.x for p in points) / len(points)
    cy = sum(p.y for p in points) / len(points)
    xx = sum((p.x - cx) ** 2 for p in points) / len(points)
    yy = sum((p.y - cy) ** 2 for p in points) / len(points)
    xy = sum((p.x - cx) * (p.y - cy) for p in points) / len(points)
    trace = xx + yy
    disc = math.sqrt(max(0.0, trace * trace / 4.0 - (xx * yy - xy * xy)))
    l1 = max(trace / 2.0 + disc, _EPS)
    l2 = max(trace / 2.0 - disc, _EPS)
    angle = 0.5 * math.atan2(2.0 * xy, xx - yy)
    return Point2D(cx, cy), math.sqrt(l1), math.sqrt(l2), math.degrees(angle) % 180.0


def _local(points: Sequence[Point2D], center: Point2D, orientation_deg: float) -> tuple[Point2D, ...]:
    angle = -math.radians(orientation_deg)
    c = math.cos(angle)
    s = math.sin(angle)
    return tuple(
        Point2D(
            (p.x - center.x) * c - (p.y - center.y) * s,
            (p.x - center.x) * s + (p.y - center.y) * c,
        )
        for p in points
    )


def _segment_intersection(a: Point2D, b: Point2D, c: Point2D, d: Point2D) -> bool:
    def orient(p: Point2D, q: Point2D, r: Point2D) -> float:
        return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)

    o1, o2, o3, o4 = orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)
    return o1 * o2 < 0.0 and o3 * o4 < 0.0


def _self_intersections(points: Sequence[Point2D]) -> int:
    # Sampled non-neighbouring chords make this robust enough for topology
    # discrimination while keeping runtime bounded for dense trajectories.
    step = max(1, len(points) // 80)
    sampled = tuple(points[::step])
    count = 0
    n = len(sampled)
    for i in range(n):
        a, b = sampled[i], sampled[(i + 1) % n]
        for j in range(i + 3, n):
            if (j + 1) % n in (i, (i + 1) % n) or j == n - 1 and i == 0:
                continue
            c, d = sampled[j], sampled[(j + 1) % n]
            if _segment_intersection(a, b, c, d):
                count += 1
    return count


def _waist_ratio(local_points: Sequence[Point2D]) -> float:
    max_x = max((abs(p.x) for p in local_points), default=0.0)
    if max_x <= _EPS:
        return 1.0
    center_band = [abs(p.y) for p in local_points if abs(p.x) <= 0.16 * max_x]
    shoulder_band = [
        abs(p.y)
        for p in local_points
        if 0.38 * max_x <= abs(p.x) <= 0.72 * max_x
    ]
    if not center_band or not shoulder_band:
        return 1.0
    center_width = 2.0 * max(center_band)
    shoulder_width = 2.0 * max(shoulder_band)
    return center_width / max(shoulder_width, _EPS)


def _turn_clusters(points: Sequence[Point2D]) -> int:
    n = len(points)
    if n < 12:
        return 0
    stride = max(1, n // 120)
    flags: list[bool] = []
    for i in range(0, n, stride):
        a = points[(i - 2 * stride) % n]
        b = points[i]
        c = points[(i + 2 * stride) % n]
        ux, uy = b.x - a.x, b.y - a.y
        vx, vy = c.x - b.x, c.y - b.y
        du, dv = math.hypot(ux, uy), math.hypot(vx, vy)
        if du <= _EPS or dv <= _EPS:
            flags.append(False)
            continue
        cosine = max(-1.0, min(1.0, (ux * vx + uy * vy) / (du * dv)))
        flags.append(math.acos(cosine) >= math.radians(18.0))
    clusters = 0
    active = False
    for flag in flags + flags[:1]:
        if flag and not active:
            clusters += 1
            active = True
        elif not flag:
            active = False
    return max(0, clusters - (1 if flags and flags[0] and flags[-1] else 0))


def classify_route(points: Iterable[Point2D], period_s: float) -> RouteDescriptor:
    values = tuple(points)
    if len(values) < 20:
        raise ValueError("at least 20 route points are required")
    if period_s <= 0 or not math.isfinite(period_s):
        raise ValueError("period_s must be positive and finite")

    center, pca_long, pca_short, orientation = _pca(values)
    local = _local(values, center, orientation)
    long_axis = max(abs(p.x) for p in local)
    short_axis = max(abs(p.y) for p in local)
    if short_axis > long_axis:
        long_axis, short_axis = short_axis, long_axis
        orientation = (orientation + 90.0) % 180.0
        local = _local(values, center, orientation)
    axis_ratio = long_axis / max(short_axis, _EPS)
    intersections = _self_intersections(values)
    waist = _waist_ratio(local)
    turns = _turn_clusters(values)

    if intersections > 0:
        family, shape = RouteKind.SO, RouteShape.FIGURE_EIGHT
    elif axis_ratio <= 1.5:
        family, shape = RouteKind.SI, RouteShape.COMPACT
    elif waist < 0.70 and turns >= 3:
        family, shape = RouteKind.SO, RouteShape.DOUBLE_HIPPODROME
    else:
        family, shape = RouteKind.SO, RouteShape.HIPPODROME

    area = _signed_area(values)
    scale = max(_polyline_length(values) ** 2, 1.0)
    if abs(area) / scale < 1e-4:
        rotation = Rotation.UNKNOWN
    else:
        rotation = Rotation.CCW if area > 0 else Rotation.CW

    along_min = min(local, key=lambda p: p.x)
    along_max = max(local, key=lambda p: p.x)
    angle = math.radians(orientation)
    c, s = math.cos(angle), math.sin(angle)

    def world(p: Point2D) -> Point2D:
        return Point2D(center.x + p.x * c - p.y * s, center.y + p.x * s + p.y * c)

    endpoints = (world(Point2D(along_min.x, 0.0)), world(Point2D(along_max.x, 0.0)))
    quality = max(
        0.0,
        min(
            1.0,
            0.62
            + min(0.18, abs(axis_ratio - 1.5) * 0.08)
            + (0.10 if shape is RouteShape.DOUBLE_HIPPODROME else 0.0)
            + (0.10 if shape is RouteShape.FIGURE_EIGHT else 0.0),
        ),
    )
    return RouteDescriptor(
        family=family,
        shape=shape,
        rotation=rotation,
        center=center,
        long_axis=long_axis,
        short_axis=short_axis,
        orientation_deg=orientation,
        period_s=period_s,
        length=_polyline_length(values),
        axis_ratio=axis_ratio,
        waist_ratio=waist,
        turn_clusters=turns,
        self_intersections=intersections,
        endpoints=endpoints,
        quality=quality,
    )


def angle_delta_deg(a: float, b: float) -> float:
    delta = abs((a - b) % 180.0)
    return min(delta, 180.0 - delta)


def relative_period_error(a_s: float, b_s: float) -> float:
    return abs(a_s - b_s) / max(a_s, b_s, _EPS)


def _double_single_period_compatible(a: RouteDescriptor, b: RouteDescriptor, tolerance: float) -> bool:
    kinds = {a.shape, b.shape}
    if RouteShape.DOUBLE_HIPPODROME not in kinds or RouteShape.HIPPODROME not in kinds:
        return False
    longer = max(a.period_s, b.period_s)
    shorter = min(a.period_s, b.period_s)
    return abs(longer / max(shorter, _EPS) - 2.0) <= tolerance * 2.0


def si_group_compatible(a: RouteDescriptor, b: RouteDescriptor, *, center_ratio: float = 0.30, period_ratio: float = 0.20) -> bool:
    if a.family is not RouteKind.SI or b.family is not RouteKind.SI:
        return False
    if a.rotation is Rotation.UNKNOWN or b.rotation is Rotation.UNKNOWN or a.rotation is not b.rotation:
        return False
    center_tolerance = center_ratio * max((a.short_axis + b.short_axis) / 2.0, 1.0)
    return _distance(a.center, b.center) <= center_tolerance and relative_period_error(a.period_s, b.period_s) <= period_ratio


def so_group_compatible(
    a: RouteDescriptor,
    b: RouteDescriptor,
    *,
    period_ratio: float = 0.20,
    max_axis_delta_deg: float = 35.0,
    endpoint_multiplier: float = 1.25,
) -> bool:
    if a.family is not RouteKind.SO or b.family is not RouteKind.SO:
        return False
    period_ok = relative_period_error(a.period_s, b.period_s) <= period_ratio or _double_single_period_compatible(a, b, period_ratio)
    if not period_ok:
        return False
    if angle_delta_deg(a.orientation_deg, b.orientation_deg) > max_axis_delta_deg:
        return False
    endpoint_distance = min(_distance(x, y) for x in a.endpoints for y in b.endpoints)
    endpoint_tolerance = endpoint_multiplier * max(a.short_axis, b.short_axis, 1.0)
    return endpoint_distance <= endpoint_tolerance


def grouping_compatible(a: RouteDescriptor, b: RouteDescriptor, *, score_a: float | None = None, score_b: float | None = None) -> bool:
    """Grouping never consumes synchronization score; score args are ignored intentionally."""
    del score_a, score_b
    if a.family is RouteKind.SI and b.family is RouteKind.SI:
        return si_group_compatible(a, b)
    if a.family is RouteKind.SO and b.family is RouteKind.SO:
        return so_group_compatible(a, b)
    return False


def validate_so_layout(layout: SoLayout) -> None:
    capacities = {
        SoEntityKind.SINGLE: 2,
        SoEntityKind.DOUBLE: 4,
        SoEntityKind.FIGURE_EIGHT: 2,
    }
    if not layout.entities:
        raise ValueError("SO layout requires at least one route entity")
    total = 0
    for entity in layout.entities:
        if entity.vehicle_count < 1 or entity.vehicle_count > capacities[entity.kind]:
            raise ValueError(f"illegal capacity for {entity.kind}")
        if entity.vehicle_types and len(entity.vehicle_types) != entity.vehicle_count:
            raise ValueError("vehicle_types length must match vehicle_count")
        total += entity.vehicle_count
    if total < 2:
        raise ValueError("SO requires at least two vehicles")
    if len(layout.relations) != len(layout.entities) - 1:
        raise ValueError("SO relations must describe every adjacent entity pair")
    for index, relation in enumerate(layout.relations):
        if relation is SoRelation.MIXED:
            left = layout.entities[index]
            right = layout.entities[index + 1]
            if left.kind is not SoEntityKind.DOUBLE and right.kind is not SoEntityKind.DOUBLE:
                raise ValueError("mixed is legal only next to a double hippodrome")


def canonical_so_layout_key(layout: SoLayout) -> str:
    validate_so_layout(layout)

    def encode(entities: Sequence[SoEntity], relations: Sequence[SoRelation]) -> str:
        entity_part = ">".join(
            f"{entity.kind.value}:{entity.vehicle_count}:{','.join(entity.vehicle_types)}"
            for entity in entities
        )
        return f"{entity_part}#{'>'.join(r.value for r in relations)}"

    forward = encode(layout.entities, layout.relations)
    reverse = encode(tuple(reversed(layout.entities)), tuple(reversed(layout.relations)))
    return min(forward, reverse)


def material_change(a: RouteDescriptor, b: RouteDescriptor, geometry_ratio: float = 0.20, period_ratio: float = 0.20) -> bool:
    if a.family is not b.family or a.shape is not b.shape:
        return True
    if relative_period_error(a.period_s, b.period_s) > period_ratio:
        return True
    center_scale = max((a.short_axis + b.short_axis) / 2.0, 1.0)
    center_change = _distance(a.center, b.center) / center_scale
    long_change = abs(a.long_axis - b.long_axis) / max(a.long_axis, b.long_axis, _EPS)
    short_change = abs(a.short_axis - b.short_axis) / max(a.short_axis, b.short_axis, _EPS)
    orientation_change = angle_delta_deg(a.orientation_deg, b.orientation_deg) / 180.0
    return max(center_change, long_change, short_change, orientation_change) > geometry_ratio
