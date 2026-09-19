"""Structural grouping for confirmed Blue Wolf routes.

Grouping is deliberately independent from synchronization scoring. Membership
uses only server, confirmed route geometry, route period and the V1 reliability
floor. A poor synchronization score must never split or merge a group.

The module is stateful only for stable group identity. Temporal confirmation is
owned by CoreSession, where already-collected route evidence can be considered
without introducing a second artificial acquisition wait.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Iterable, Mapping, Sequence

from .config import GroupingConfig
from .geometry import wgs84_to_local_m
from .models import ClosedRoute, Direction, RouteFamily, RouteSubtype, RouteTopology


_EPSILON = 1e-9
MIN_GROUPING_RELIABILITY = 0.60

StreamKey = tuple[int, int]


@dataclass(frozen=True, slots=True)
class GroupObservation:
    """One confirmed-route observation eligible for structural grouping."""

    server_id: int
    vehicle_identifier: int
    route: ClosedRoute
    reliability: float = 1.0
    active: bool | None = True

    def __post_init__(self) -> None:
        if self.server_id < 0 or self.vehicle_identifier < 0:
            raise ValueError("group observation identifiers must be non-negative")
        if not 0.0 <= self.reliability <= 1.0:
            raise ValueError("reliability must be in [0,1]")

    @property
    def stream_key(self) -> StreamKey:
        return self.server_id, self.vehicle_identifier


@dataclass(frozen=True, slots=True)
class GroupCompatibility:
    compatible: bool
    reasons: tuple[str, ...] = ()
    metrics: Mapping[str, float | str | bool] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "metrics", MappingProxyType(dict(self.metrics)))


@dataclass(frozen=True, slots=True)
class StructuralGroup:
    """A score-free connected structural group before identity assignment."""

    server_id: int
    family: RouteFamily
    member_keys: tuple[StreamKey, ...]
    route_ids: tuple[str, ...]
    base_period_s: float

    def __post_init__(self) -> None:
        if len(self.member_keys) < 2:
            raise ValueError("a structural group requires at least two members")
        if len(self.route_ids) != len(self.member_keys):
            raise ValueError("route_ids must align with member_keys")
        if self.base_period_s <= 0:
            raise ValueError("base_period_s must be positive")


@dataclass(frozen=True, slots=True)
class RouteGroup:
    group_id: str
    server_id: int
    family: RouteFamily
    member_keys: tuple[StreamKey, ...]
    route_ids: tuple[str, ...]
    base_period_s: float

    def __post_init__(self) -> None:
        if not self.group_id:
            raise ValueError("group_id cannot be empty")
        if len(self.member_keys) < 2:
            raise ValueError("a route group requires at least two members")


@dataclass(frozen=True, slots=True)
class GroupingSnapshot:
    groups: tuple[RouteGroup, ...]
    assignments: Mapping[StreamKey, str]

    def __post_init__(self) -> None:
        object.__setattr__(self, "assignments", MappingProxyType(dict(self.assignments)))


def base_period_seconds(route: ClosedRoute) -> float:
    """Normalize hierarchical SO routes to their single-route period basis."""

    is_double = route.topology is RouteTopology.DOUBLE or route.subtype in {
        RouteSubtype.DOUBLE_HIPPODROME,
        RouteSubtype.DOUBLE_FIGURE_EIGHT,
    }
    return route.estimated_period_s / 2.0 if is_double else route.estimated_period_s


def _relative_difference(first: float, second: float) -> float:
    return abs(first - second) / max(abs(first), abs(second), _EPSILON)


def _center_distance_m(first: ClosedRoute, second: ClosedRoute) -> float:
    offset = wgs84_to_local_m(
        second.center_latitude_deg,
        second.center_longitude_deg,
        first.center_latitude_deg,
        first.center_longitude_deg,
    )
    return math.hypot(offset.x_m, offset.y_m)


def _absolute_route_points(
    route: ClosedRoute,
    *,
    reference_latitude_deg: float,
    reference_longitude_deg: float,
) -> tuple[tuple[float, float], ...]:
    center = wgs84_to_local_m(
        route.center_latitude_deg,
        route.center_longitude_deg,
        reference_latitude_deg,
        reference_longitude_deg,
    )
    return tuple(
        (center.x_m + point.x_m, center.y_m + point.y_m)
        for point in route.canonical_points
    )


def _so_front_points(
    route: ClosedRoute,
    *,
    reference_latitude_deg: float,
    reference_longitude_deg: float,
) -> tuple[tuple[float, float], ...]:
    """Return canonical points belonging to either longitudinal front/turn end.

    This is scale-free: the front band is derived from the route's own
    longitudinal extent and therefore works for simple, double and figure-eight
    SO geometry without a fixed meter threshold.
    """

    absolute = _absolute_route_points(
        route,
        reference_latitude_deg=reference_latitude_deg,
        reference_longitude_deg=reference_longitude_deg,
    )
    center = wgs84_to_local_m(
        route.center_latitude_deg,
        route.center_longitude_deg,
        reference_latitude_deg,
        reference_longitude_deg,
    )
    orientation = math.radians(route.orientation_deg)
    axis_east = math.cos(orientation)
    axis_north = math.sin(orientation)
    projected = tuple(
        (east - center.x_m) * axis_east + (north - center.y_m) * axis_north
        for east, north in absolute
    )
    extent = max((abs(value) for value in projected), default=0.0)
    if extent <= _EPSILON:
        return absolute
    band = 0.70 * extent
    selected = tuple(
        point for point, along in zip(absolute, projected, strict=True) if abs(along) >= band
    )
    if selected:
        return selected
    extreme = max(range(len(projected)), key=lambda index: abs(projected[index]))
    return (absolute[extreme],)


def _minimum_point_distance(
    first: Sequence[tuple[float, float]],
    second: Sequence[tuple[float, float]],
) -> float:
    return min(
        math.hypot(a_east - b_east, a_north - b_north)
        for a_east, a_north in first
        for b_east, b_north in second
    )


def _so_leg_scale_m(route: ClosedRoute) -> float:
    """Geometry-derived SO neighbor scale representing one long leg."""

    straight_span = 2.0 * max(route.long_axis_a_m - route.short_axis_b_m, 0.0)
    turn_diameter = 2.0 * route.short_axis_b_m
    return max(straight_span, turn_diameter, _EPSILON)


def routes_compatible(
    first: GroupObservation,
    second: GroupObservation,
    config: GroupingConfig | None = None,
) -> GroupCompatibility:
    """Return the hard structural membership decision for two confirmed routes."""

    grouping = config or GroupingConfig()
    if first.server_id != second.server_id:
        return GroupCompatibility(False, ("server",))
    if first.active is False or second.active is False:
        return GroupCompatibility(False, ("inactive",))
    if min(first.reliability, second.reliability) < MIN_GROUPING_RELIABILITY:
        return GroupCompatibility(False, ("reliability",))
    if first.route.family is RouteFamily.FREE or second.route.family is RouteFamily.FREE:
        return GroupCompatibility(False, ("free_route",))
    if first.route.family is not second.route.family:
        return GroupCompatibility(False, ("family",))

    first_period = base_period_seconds(first.route)
    second_period = base_period_seconds(second.route)
    period_ratio = _relative_difference(first_period, second_period)

    if first.route.family is RouteFamily.SI:
        center_distance = _center_distance_m(first.route, second.route)
        center_scale = max(
            first.route.short_axis_b_m,
            second.route.short_axis_b_m,
            _EPSILON,
        )
        center_ratio = center_distance / center_scale
        direction_ok = (
            first.route.direction is not Direction.UNKNOWN
            and second.route.direction is not Direction.UNKNOWN
            and first.route.direction is second.route.direction
        )
        metrics: dict[str, float | str | bool] = {
            "period_difference_ratio": period_ratio,
            "center_distance_m": center_distance,
            "center_distance_ratio": center_ratio,
            "direction_match": direction_ok,
        }
        reasons: list[str] = []
        if period_ratio > grouping.si_period_difference_ratio + _EPSILON:
            reasons.append("period")
        if center_ratio > grouping.si_center_distance_ratio + _EPSILON:
            reasons.append("center")
        if not direction_ok:
            reasons.append("direction")
        return GroupCompatibility(not reasons, tuple(reasons), metrics)

    # SO uses front/turn adjacency. Same and opposite traversal directions are
    # both legal here; template fitting later determines the synchronization
    # relation and must not influence structural membership.
    reference_latitude = first.route.center_latitude_deg
    reference_longitude = first.route.center_longitude_deg
    first_fronts = _so_front_points(
        first.route,
        reference_latitude_deg=reference_latitude,
        reference_longitude_deg=reference_longitude,
    )
    second_fronts = _so_front_points(
        second.route,
        reference_latitude_deg=reference_latitude,
        reference_longitude_deg=reference_longitude,
    )
    neighbor_distance = _minimum_point_distance(first_fronts, second_fronts)
    neighbor_limit = grouping.so_neighbor_longer_leg_multiplier * max(
        _so_leg_scale_m(first.route),
        _so_leg_scale_m(second.route),
    )
    metrics = {
        "period_difference_ratio": period_ratio,
        "neighbor_distance_m": neighbor_distance,
        "neighbor_limit_m": neighbor_limit,
        "first_base_period_s": first_period,
        "second_base_period_s": second_period,
    }
    reasons = []
    if period_ratio > grouping.so_period_difference_ratio + _EPSILON:
        reasons.append("period")
    if neighbor_distance > neighbor_limit + _EPSILON:
        reasons.append("neighbor")
    return GroupCompatibility(not reasons, tuple(reasons), metrics)


def _eligible_observations(
    observations: Iterable[GroupObservation],
) -> tuple[GroupObservation, ...]:
    unique: dict[StreamKey, GroupObservation] = {}
    for observation in observations:
        if observation.active is False:
            continue
        if observation.reliability < MIN_GROUPING_RELIABILITY:
            continue
        if observation.route.family is RouteFamily.FREE:
            continue
        unique[observation.stream_key] = observation
    return tuple(unique[key] for key in sorted(unique))


def _si_complete_link_groups(
    observations: Sequence[GroupObservation],
    config: GroupingConfig,
) -> list[list[GroupObservation]]:
    """Avoid threshold chaining by requiring every SI member pair to match."""

    clusters: list[list[GroupObservation]] = []
    for observation in observations:
        placed = False
        for cluster in clusters:
            if all(routes_compatible(observation, member, config).compatible for member in cluster):
                cluster.append(observation)
                placed = True
                break
        if not placed:
            clusters.append([observation])
    return clusters


def _so_connected_groups(
    observations: Sequence[GroupObservation],
    config: GroupingConfig,
) -> list[list[GroupObservation]]:
    """SO is intentionally transitive: neighboring Route Instances form chains."""

    by_key = {item.stream_key: item for item in observations}
    adjacency: dict[StreamKey, set[StreamKey]] = {key: set() for key in by_key}
    keys = sorted(by_key)
    for index, first_key in enumerate(keys):
        for second_key in keys[index + 1 :]:
            if routes_compatible(by_key[first_key], by_key[second_key], config).compatible:
                adjacency[first_key].add(second_key)
                adjacency[second_key].add(first_key)

    output: list[list[GroupObservation]] = []
    remaining = set(keys)
    while remaining:
        start = min(remaining)
        stack = [start]
        component: list[StreamKey] = []
        remaining.remove(start)
        while stack:
            key = stack.pop()
            component.append(key)
            for neighbor in sorted(adjacency[key], reverse=True):
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    stack.append(neighbor)
        output.append([by_key[key] for key in sorted(component)])
    return output


def discover_structural_groups(
    observations: Iterable[GroupObservation],
    config: GroupingConfig | None = None,
) -> tuple[StructuralGroup, ...]:
    """Discover all score-independent groups from current confirmed routes."""

    grouping = config or GroupingConfig()
    eligible = _eligible_observations(observations)
    partitions: dict[tuple[int, RouteFamily], list[GroupObservation]] = {}
    for observation in eligible:
        partitions.setdefault((observation.server_id, observation.route.family), []).append(
            observation
        )

    discovered: list[StructuralGroup] = []
    for (server_id, family), members in sorted(
        partitions.items(), key=lambda item: (item[0][0], item[0][1].value)
    ):
        members.sort(key=lambda item: item.stream_key)
        clusters = (
            _si_complete_link_groups(members, grouping)
            if family is RouteFamily.SI
            else _so_connected_groups(members, grouping)
        )
        for cluster in clusters:
            if len(cluster) < grouping.minimum_valid_vehicles:
                continue
            ordered = sorted(cluster, key=lambda item: item.stream_key)
            discovered.append(
                StructuralGroup(
                    server_id=server_id,
                    family=family,
                    member_keys=tuple(item.stream_key for item in ordered),
                    route_ids=tuple(item.route.route_id for item in ordered),
                    base_period_s=float(
                        statistics.median(base_period_seconds(item.route) for item in ordered)
                    ),
                )
            )

    return tuple(
        sorted(
            discovered,
            key=lambda group: (group.server_id, group.family.value, group.member_keys),
        )
    )


class StableGroupingEngine:
    """Assign stable group ids across structural membership updates.

    An old id survives only when at least ``identity_preservation_fraction`` of
    the old members remain together. A candidate that materially joins two old
    groups is a merge and receives a fresh id, as required by the V1 contract.
    """

    def __init__(self, config: GroupingConfig | None = None) -> None:
        self.config = config or GroupingConfig()
        self._counter = 0
        self._groups: tuple[RouteGroup, ...] = ()

    @property
    def groups(self) -> tuple[RouteGroup, ...]:
        return self._groups

    def _new_id(self, server_id: int) -> str:
        self._counter += 1
        return f"g:{server_id}:{self._counter:06d}"

    def reconcile(self, structural: Iterable[StructuralGroup]) -> GroupingSnapshot:
        candidates = tuple(
            sorted(
                structural,
                key=lambda group: (group.server_id, group.family.value, group.member_keys),
            )
        )
        old_groups = self._groups
        overlap_candidates: list[list[RouteGroup]] = []
        threshold = self.config.identity_preservation_fraction
        for candidate in candidates:
            members = set(candidate.member_keys)
            qualifying: list[RouteGroup] = []
            for old in old_groups:
                if old.server_id != candidate.server_id or old.family is not candidate.family:
                    continue
                overlap = len(members.intersection(old.member_keys))
                if overlap / max(len(old.member_keys), 1) + _EPSILON >= threshold:
                    qualifying.append(old)
            overlap_candidates.append(qualifying)

        assigned_old_ids: set[str] = set()
        next_groups: list[RouteGroup] = []
        for candidate, qualifying in zip(candidates, overlap_candidates, strict=True):
            # More than one qualifying predecessor is a merge: identity resets.
            preserve: RouteGroup | None = None
            if len(qualifying) == 1 and qualifying[0].group_id not in assigned_old_ids:
                predecessor = qualifying[0]
                # If the same predecessor could qualify two disjoint new groups,
                # only the component with the largest overlap may retain the id.
                competing: list[tuple[int, tuple[StreamKey, ...], int]] = []
                for index, other in enumerate(candidates):
                    if predecessor not in overlap_candidates[index]:
                        continue
                    overlap = len(set(other.member_keys).intersection(predecessor.member_keys))
                    competing.append((overlap, other.member_keys, index))
                best_index = max(
                    competing,
                    key=lambda item: (item[0], tuple(-value for key in item[1] for value in key)),
                )[2]
                current_index = candidates.index(candidate)
                if best_index == current_index:
                    preserve = predecessor

            group_id = preserve.group_id if preserve is not None else self._new_id(candidate.server_id)
            if preserve is not None:
                assigned_old_ids.add(preserve.group_id)
            next_groups.append(
                RouteGroup(
                    group_id=group_id,
                    server_id=candidate.server_id,
                    family=candidate.family,
                    member_keys=candidate.member_keys,
                    route_ids=candidate.route_ids,
                    base_period_s=candidate.base_period_s,
                )
            )

        self._groups = tuple(next_groups)
        assignments = {
            key: group.group_id for group in self._groups for key in group.member_keys
        }
        return GroupingSnapshot(self._groups, assignments)

    def update(self, observations: Iterable[GroupObservation]) -> GroupingSnapshot:
        return self.reconcile(discover_structural_groups(observations, self.config))

    def export_state(self) -> dict[str, Any]:
        return {
            "counter": self._counter,
            "groups": [
                {
                    "group_id": group.group_id,
                    "server_id": group.server_id,
                    "family": group.family.value,
                    "member_keys": [list(key) for key in group.member_keys],
                    "route_ids": list(group.route_ids),
                    "base_period_s": group.base_period_s,
                }
                for group in self._groups
            ],
        }

    @classmethod
    def from_state(
        cls,
        raw: Mapping[str, Any],
        config: GroupingConfig | None = None,
    ) -> "StableGroupingEngine":
        engine = cls(config)
        engine._counter = int(raw.get("counter", 0))
        groups: list[RouteGroup] = []
        for value in raw.get("groups", []):
            groups.append(
                RouteGroup(
                    group_id=str(value["group_id"]),
                    server_id=int(value["server_id"]),
                    family=RouteFamily(str(value["family"])),
                    member_keys=tuple(
                        (int(key[0]), int(key[1])) for key in value.get("member_keys", [])
                    ),
                    route_ids=tuple(str(item) for item in value.get("route_ids", [])),
                    base_period_s=float(value["base_period_s"]),
                )
            )
        engine._groups = tuple(groups)
        return engine
