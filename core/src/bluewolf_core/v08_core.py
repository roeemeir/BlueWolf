"""Blue Wolf v0.8 hardened algorithmic core.

This module is the authoritative v0.8 implementation for route topology,
group compatibility, SO template legality, route revisions, and stable group /
event lifecycle. It is intentionally independent from UI, InfluxDB and maps.

Design invariants:
* grouping never consumes synchronization score;
* SI grouping requires compatible centre, period and rotation;
* SO grouping requires endpoint adjacency, axis alignment and period, with the
  approved single/double 2x-period equivalence;
* a double hippodrome is one continuous non-self-crossing dog-bone route with
  a real centre waist, not two independent capsules;
* confirmed route history is bounded;
* a material geometry/period change must remain stable before revision;
* alerts are not events — event boundaries come from confirmed stable group
  identity/membership changes.
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

    def __post_init__(self) -> None:
        if not math.isfinite(self.x) or not math.isfinite(self.y):
            raise ValueError("point coordinates must be finite")


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
    self_intersections: int
    endpoints: tuple[Point2D, Point2D]
    quality: float

    def __post_init__(self) -> None:
        if self.long_axis <= 0 or self.short_axis <= 0 or self.period_s <= 0 or self.length <= 0:
            raise ValueError("route dimensions, period and length must be positive")
        if not 0.0 <= self.quality <= 1.0:
            raise ValueError("quality must be in [0, 1]")


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


@dataclass(frozen=True, slots=True)
class GroupLifecycleEvent:
    kind: str
    at_s: float
    group_revision: int
    members: frozenset[str]
    preserved_identity: bool


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


def _pca(points: Sequence[Point2D]) -> tuple[Point2D, float]:
    cx = sum(p.x for p in points) / len(points)
    cy = sum(p.y for p in points) / len(points)
    xx = sum((p.x - cx) ** 2 for p in points) / len(points)
    yy = sum((p.y - cy) ** 2 for p in points) / len(points)
    xy = sum((p.x - cx) * (p.y - cy) for p in points) / len(points)
    angle = 0.5 * math.atan2(2.0 * xy, xx - yy)
    return Point2D(cx, cy), math.degrees(angle) % 180.0


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
    # Bound complexity by sampling at most ~96 segments. Adjacent segments are
    # excluded so a normal closed curve is not treated as self crossing.
    step = max(1, len(points) // 96)
    sampled = tuple(points[::step])
    n = len(sampled)
    count = 0
    for i in range(n):
        a, b = sampled[i], sampled[(i + 1) % n]
        for j in range(i + 3, n):
            if (j + 1) % n in (i, (i + 1) % n) or (j == n - 1 and i == 0):
                continue
            c, d = sampled[j], sampled[(j + 1) % n]
            if _segment_intersection(a, b, c, d):
                count += 1
    return count


def _waist_ratio(local_points: Sequence[Point2D]) -> float:
    """Width at the centre divided by representative lobe width.

    A single stadium has a near-uniform width and therefore ratio close to 1.
    A continuous double hippodrome has a narrow articulated centre waist and
    therefore a materially smaller ratio.
    """
    max_x = max((abs(p.x) for p in local_points), default=0.0)
    if max_x <= _EPS:
        return 1.0
    centre = [abs(p.y) for p in local_points if abs(p.x) <= 0.16 * max_x]
    shoulders = [
        abs(p.y)
        for p in local_points
        if 0.36 * max_x <= abs(p.x) <= 0.72 * max_x
    ]
    if not centre or not shoulders:
        return 1.0
    return max(centre) / max(max(shoulders), _EPS)


def _world_axis_point(center: Point2D, along: float, orientation_deg: float) -> Point2D:
    angle = math.radians(orientation_deg)
    return Point2D(center.x + along * math.cos(angle), center.y + along * math.sin(angle))


def classify_route(points: Iterable[Point2D], period_s: float, *, si_axis_ratio_max: float = 1.5, double_waist_max: float = 0.70) -> RouteDescriptor:
    values = tuple(points)
    if len(values) < 20:
        raise ValueError("at least 20 route points are required")
    if period_s <= 0 or not math.isfinite(period_s):
        raise ValueError("period_s must be positive and finite")

    center, orientation = _pca(values)
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

    # Topology order matters: a self-crossing curve is Figure-8 even if its
    # covariance happens to look compact. A double SO is a single continuous,
    # non-self-crossing route with a real waist; curvature-cluster count is a
    # diagnostic, not a hard gate, because smoothing/sampling can merge peaks.
    if intersections > 0:
        family, shape = RouteKind.SO, RouteShape.FIGURE_EIGHT
    elif axis_ratio <= si_axis_ratio_max:
        family, shape = RouteKind.SI, RouteShape.COMPACT
    elif waist < double_waist_max:
        family, shape = RouteKind.SO, RouteShape.DOUBLE_HIPPODROME
    else:
        family, shape = RouteKind.SO, RouteShape.HIPPODROME

    signed = _signed_area(values)
    normalized_area = abs(signed) / max(_polyline_length(values) ** 2, 1.0)
    if normalized_area < 1e-4:
        rotation = Rotation.UNKNOWN
    else:
        rotation = Rotation.CCW if signed > 0 else Rotation.CW

    min_x = min(p.x for p in local)
    max_x = max(p.x for p in local)
    endpoints = (
        _world_axis_point(center, min_x, orientation),
        _world_axis_point(center, max_x, orientation),
    )
    separation = abs(axis_ratio - si_axis_ratio_max)
    quality = max(
        0.0,
        min(
            1.0,
            0.62
            + min(0.18, separation * 0.08)
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
        self_intersections=intersections,
        endpoints=endpoints,
        quality=quality,
    )


def angle_delta_deg(a: float, b: float) -> float:
    delta = abs((a - b) % 180.0)
    return min(delta, 180.0 - delta)


def relative_period_error(a_s: float, b_s: float) -> float:
    return abs(a_s - b_s) / max(a_s, b_s, _EPS)


def si_group_compatible(a: RouteDescriptor, b: RouteDescriptor, *, center_ratio: float = 0.30, period_ratio: float = 0.20) -> bool:
    if a.family is not RouteKind.SI or b.family is not RouteKind.SI:
        return False
    if a.rotation is Rotation.UNKNOWN or b.rotation is Rotation.UNKNOWN or a.rotation is not b.rotation:
        return False
    center_tolerance = center_ratio * max((a.short_axis + b.short_axis) / 2.0, 1.0)
    return _distance(a.center, b.center) <= center_tolerance and relative_period_error(a.period_s, b.period_s) <= period_ratio


def _single_double_2x(a: RouteDescriptor, b: RouteDescriptor, tolerance: float) -> bool:
    shapes = {a.shape, b.shape}
    if RouteShape.HIPPODROME not in shapes or RouteShape.DOUBLE_HIPPODROME not in shapes:
        return False
    ratio = max(a.period_s, b.period_s) / max(min(a.period_s, b.period_s), _EPS)
    return abs(ratio - 2.0) <= tolerance * 2.0


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
    period_ok = relative_period_error(a.period_s, b.period_s) <= period_ratio or _single_double_2x(a, b, period_ratio)
    if not period_ok:
        return False
    if angle_delta_deg(a.orientation_deg, b.orientation_deg) > max_axis_delta_deg:
        return False
    endpoint_distance = min(_distance(x, y) for x in a.endpoints for y in b.endpoints)
    endpoint_tolerance = endpoint_multiplier * max(a.short_axis, b.short_axis, 1.0)
    return endpoint_distance <= endpoint_tolerance


def grouping_compatible(a: RouteDescriptor, b: RouteDescriptor, *, score_a: float | None = None, score_b: float | None = None) -> bool:
    """Return grouping compatibility; score arguments are ignored by design."""
    del score_a, score_b
    if a.family is RouteKind.SI and b.family is RouteKind.SI:
        return si_group_compatible(a, b)
    if a.family is RouteKind.SO and b.family is RouteKind.SO:
        return so_group_compatible(a, b)
    return False


def validate_so_layout(layout: SoLayout) -> None:
    capacities = {SoEntityKind.SINGLE: 2, SoEntityKind.DOUBLE: 4, SoEntityKind.FIGURE_EIGHT: 2}
    if not layout.entities:
        raise ValueError("SO layout requires at least one route entity")
    total = 0
    for entity in layout.entities:
        if entity.vehicle_count < 1 or entity.vehicle_count > capacities[entity.kind]:
            raise ValueError(f"illegal capacity for {entity.kind.value}")
        if entity.vehicle_types and len(entity.vehicle_types) != entity.vehicle_count:
            raise ValueError("vehicle_types length must match vehicle_count")
        total += entity.vehicle_count
    if total < 2:
        raise ValueError("SO requires at least two vehicles")
    if len(layout.relations) != len(layout.entities) - 1:
        raise ValueError("relations must cover every adjacent entity pair")
    for index, relation in enumerate(layout.relations):
        if relation is SoRelation.MIXED:
            left, right = layout.entities[index], layout.entities[index + 1]
            if left.kind is not SoEntityKind.DOUBLE and right.kind is not SoEntityKind.DOUBLE:
                raise ValueError("mixed is legal only adjacent to a double hippodrome")


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


def material_change(a: RouteDescriptor, b: RouteDescriptor, *, geometry_ratio: float = 0.20, period_ratio: float = 0.20) -> bool:
    if a.family is not b.family or a.shape is not b.shape:
        return True
    if relative_period_error(a.period_s, b.period_s) > period_ratio:
        return True
    scale = max((a.short_axis + b.short_axis) / 2.0, 1.0)
    center_change = _distance(a.center, b.center) / scale
    long_change = abs(a.long_axis - b.long_axis) / max(a.long_axis, b.long_axis, _EPS)
    short_change = abs(a.short_axis - b.short_axis) / max(a.short_axis, b.short_axis, _EPS)
    orientation_change = angle_delta_deg(a.orientation_deg, b.orientation_deg) / 180.0
    return max(center_change, long_change, short_change, orientation_change) > geometry_ratio


@dataclass(slots=True)
class RouteLifecycle:
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

        if self.confirmed is None:
            if self.candidate is None or material_change(
                self.candidate,
                descriptor,
                geometry_ratio=self.geometry_change_ratio,
                period_ratio=self.period_change_ratio,
            ):
                self.candidate = descriptor
                self.candidate_since = at_s
                self.candidate_emitted = False
                return ()
            assert self.candidate_since is not None
            stable_for = at_s - self.candidate_since
            events: list[LifecycleEvent] = []
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
            geometry_ratio=self.geometry_change_ratio,
            period_ratio=self.period_change_ratio,
        ):
            self.pending_revision = None
            self.pending_since = None
            return ()

        if self.pending_revision is None or material_change(
            self.pending_revision,
            descriptor,
            geometry_ratio=self.geometry_change_ratio,
            period_ratio=self.period_change_ratio,
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


@dataclass(slots=True)
class StableGroupLifecycle:
    """Confirm group membership and create event boundaries deterministically."""

    membership_confirmation_seconds: float = 120.0
    membership_hold_seconds: float = 300.0
    identity_preservation_fraction: float = 0.60
    last_seen: dict[str, float] = field(default_factory=dict)
    confirmed_members: frozenset[str] = frozenset()
    candidate_members: frozenset[str] = frozenset()
    candidate_since: float | None = None
    revision: int = 0

    def _effective_members(self, at_s: float, observed: frozenset[str]) -> frozenset[str]:
        for member in observed:
            self.last_seen[member] = at_s
        held = {
            member
            for member in self.confirmed_members
            if at_s - self.last_seen.get(member, -math.inf) < self.membership_hold_seconds
        }
        return frozenset(set(observed) | held)

    def update(self, at_s: float, observed_members: Iterable[str]) -> tuple[GroupLifecycleEvent, ...]:
        observed = frozenset(str(member) for member in observed_members)
        effective = self._effective_members(at_s, observed)
        if len(effective) < 2:
            # Do not immediately destroy a confirmed identity while held members
            # are still within the hold interval. `_effective_members` already
            # accounts for that; reaching here means the hold has genuinely run out.
            if self.confirmed_members:
                old = self.confirmed_members
                self.confirmed_members = frozenset()
                self.candidate_members = frozenset()
                self.candidate_since = None
                self.revision += 1
                return (
                    GroupLifecycleEvent("event_closed", at_s, self.revision, old, False),
                    GroupLifecycleEvent("group_closed", at_s, self.revision, old, False),
                )
            return ()

        if effective == self.confirmed_members:
            self.candidate_members = frozenset()
            self.candidate_since = None
            return ()

        if effective != self.candidate_members:
            self.candidate_members = effective
            self.candidate_since = at_s
            return (GroupLifecycleEvent("group_candidate", at_s, self.revision, effective, False),)

        assert self.candidate_since is not None
        if at_s - self.candidate_since < self.membership_confirmation_seconds:
            return ()

        previous = self.confirmed_members
        preserve = bool(previous) and len(previous & effective) / max(len(previous), 1) >= self.identity_preservation_fraction
        self.confirmed_members = effective
        self.candidate_members = frozenset()
        self.candidate_since = None
        self.revision += 1
        if not previous:
            return (
                GroupLifecycleEvent("group_confirmed", at_s, self.revision, effective, True),
                GroupLifecycleEvent("event_opened", at_s, self.revision, effective, True),
            )
        return (
            GroupLifecycleEvent("event_closed", at_s, self.revision, previous, preserve),
            GroupLifecycleEvent("group_changed", at_s, self.revision, effective, preserve),
            GroupLifecycleEvent("event_opened", at_s, self.revision, effective, preserve),
        )
