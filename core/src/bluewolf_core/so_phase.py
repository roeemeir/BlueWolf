"""Geometry-stable semantic phase and heading-aware SO projection.

Raw detector phase is local to one detected centerline: its zero point and its
increasing direction depend on the canonical polyline ordering. Synchronization
quarters must not depend on either choice. This module converts raw route phase
into a deterministic geometry frame shared by equivalent SO Route Instances.

Frame convention:
- Q0 / semantic phase 0 is the positive major-axis end of the route.
- Q2 / semantic phase 0.5 is the opposite half-cycle position.
- positive semantic progression leaves Q0 through the positive minor-axis side.

The major-axis *line* comes from ``ClosedRoute.orientation_deg``. Its sign can
be aligned to a caller-supplied reference axis so every Route Instance in one SO
chain uses the same end as Q0. Without a reference, a deterministic world-axis
sign convention is used. The minor axis is the 90-degree counter-clockwise
vector from the oriented major axis.

Figure-8 is self-crossing. Position-only nearest-segment projection is therefore
not authoritative at the crossing. When a non-adjacent branch lies inside the
same approved route-distance good band (5% of short axis by default), heading
is required and selects the branch whose canonical tangent matches velocity.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .geometry import (
    PolylineProjection,
    closed_polyline_length,
    point_at_phase,
    project_onto_closed_polyline,
    vector_angle_error_deg,
    wgs84_to_local_m,
)
from .models import CanonicalPoint, ClosedRoute, RouteFamily, RouteSubtype


_EPS = 1e-12
_DEFAULT_AMBIGUITY_DISTANCE_SHORT_AXIS_RATIO = 0.05


class UnsupportedSOPhaseGeometry(ValueError):
    """Raised when the approved geometry does not define an SO phase frame."""


class AmbiguousSOPhaseProjection(ValueError):
    """Figure-8 position is branch-ambiguous and heading evidence is unavailable."""


@dataclass(frozen=True, slots=True)
class SOPhaseFrame:
    route_id: str
    subtype: RouteSubtype
    anchor_phase: float
    phase_sign: int
    major_east: float
    major_north: float
    minor_east: float
    minor_north: float

    def __post_init__(self) -> None:
        if not self.route_id:
            raise ValueError("route_id is required")
        if not math.isfinite(self.anchor_phase):
            raise ValueError("anchor_phase must be finite")
        if self.phase_sign not in (-1, 1):
            raise ValueError("phase_sign must be -1 or 1")
        for name in ("major_east", "major_north", "minor_east", "minor_north"):
            if not math.isfinite(float(getattr(self, name))):
                raise ValueError(f"{name} must be finite")
        object.__setattr__(self, "anchor_phase", self.anchor_phase % 1.0)

    @property
    def major_axis(self) -> tuple[float, float]:
        return self.major_east, self.major_north

    def normalize(self, raw_phase: float) -> float:
        """Convert one raw arc-length phase into the geometry-stable SO frame."""

        if not math.isfinite(raw_phase):
            raise ValueError("raw_phase must be finite")
        delta = (raw_phase - self.anchor_phase) % 1.0
        if self.phase_sign < 0:
            delta = (-delta) % 1.0
        return delta


@dataclass(frozen=True, slots=True)
class SOSemanticProjection:
    projection: PolylineProjection
    semantic_phase: float
    heading_disambiguated: bool
    candidate_count: int
    heading_error_deg: float | None = None

    def __post_init__(self) -> None:
        if not math.isfinite(self.semantic_phase):
            raise ValueError("semantic_phase must be finite")
        if not 0.0 <= self.semantic_phase < 1.0:
            raise ValueError("semantic_phase must be in [0,1)")
        if self.candidate_count < 1:
            raise ValueError("candidate_count must be positive")
        if self.heading_error_deg is not None and not math.isfinite(self.heading_error_deg):
            raise ValueError("heading_error_deg must be finite when supplied")


def _unit_reference(value: tuple[float, float] | None) -> tuple[float, float] | None:
    if value is None:
        return None
    east, north = float(value[0]), float(value[1])
    if not math.isfinite(east) or not math.isfinite(north):
        raise ValueError("reference_major_axis must be finite")
    magnitude = math.hypot(east, north)
    if magnitude <= _EPS:
        raise ValueError("reference_major_axis must be non-zero")
    return east / magnitude, north / magnitude


def _oriented_major_axis(
    orientation_deg: float,
    reference_major_axis: tuple[float, float] | None,
) -> tuple[float, float]:
    if not math.isfinite(orientation_deg):
        raise ValueError("route orientation must be finite")
    angle = math.radians(orientation_deg % 180.0)
    east = math.cos(angle)
    north = math.sin(angle)

    reference = _unit_reference(reference_major_axis)
    if reference is not None:
        if east * reference[0] + north * reference[1] < 0.0:
            east, north = -east, -north
        return east, north

    # A standalone axis line still needs a deterministic sign. Making the
    # dominant world component positive is stable around vertical and horizontal
    # routes. Chains should pass the first frame's major_axis as a reference to
    # subsequent Route Instances, which also removes sign-boundary edge cases.
    if abs(east) >= abs(north):
        if east < 0.0:
            east, north = -east, -north
    elif north < 0.0:
        east, north = -east, -north
    return east, north


def _phase_at_vertex(points: tuple[CanonicalPoint, ...], index: int) -> float:
    if not 0 <= index < len(points):
        raise IndexError(index)
    total = closed_polyline_length(points)
    before = 0.0
    for current in range(index):
        first = points[current]
        second = points[current + 1]
        before += math.hypot(second.x_m - first.x_m, second.y_m - first.y_m)
    return (before / total) % 1.0


def _axis_value(point: CanonicalPoint, east: float, north: float) -> float:
    return point.x_m * east + point.y_m * north


def _anchor_vertex(
    points: tuple[CanonicalPoint, ...],
    major_east: float,
    major_north: float,
    minor_east: float,
    minor_north: float,
) -> int:
    """Choose the represented-polyline vertex at the positive major extreme."""

    best_index = 0
    best_key: tuple[float, float, float, float] | None = None
    for index, point in enumerate(points):
        major = _axis_value(point, major_east, major_north)
        minor = _axis_value(point, minor_east, minor_north)
        key = (major, -abs(minor), point.x_m, point.y_m)
        if best_key is None or key > best_key:
            best_key = key
            best_index = index
    return best_index


def _phase_direction_sign(
    points: tuple[CanonicalPoint, ...],
    anchor_phase: float,
    minor_east: float,
    minor_north: float,
) -> int:
    """Orient phase so positive progression uses the positive minor-axis side."""

    probes: list[tuple[float, float]] = []
    for offset in (0.125, 0.25, 0.375):
        point = point_at_phase(points, anchor_phase + offset)[0]
        side = _axis_value(point, minor_east, minor_north)
        probes.append((abs(side), side))
    _, strongest_side = max(probes, key=lambda item: item[0])
    if abs(strongest_side) <= _EPS:
        raise UnsupportedSOPhaseGeometry(
            "SO route has no resolvable minor-axis side for semantic phase orientation"
        )
    return 1 if strongest_side > 0.0 else -1


def build_so_phase_frame(
    route: ClosedRoute,
    *,
    reference_major_axis: tuple[float, float] | None = None,
) -> SOPhaseFrame:
    """Build a deterministic semantic phase frame from approved SO geometry.

    For a multi-Route-Instance SO chain, build the first frame without a
    reference and pass ``first.major_axis`` into the remaining calls. This keeps
    all local Q0 anchors on the same oriented major-axis convention.
    """

    if route.family is not RouteFamily.SO:
        raise UnsupportedSOPhaseGeometry("semantic SO phase requires an SO route")
    if route.subtype is RouteSubtype.DOUBLE_FIGURE_EIGHT:
        raise UnsupportedSOPhaseGeometry(
            "DOUBLE_FIGURE_EIGHT geometry is undefined by the approved specification"
        )
    if route.subtype not in (
        RouteSubtype.HIPPODROME,
        RouteSubtype.DOUBLE_HIPPODROME,
        RouteSubtype.FIGURE_EIGHT,
    ):
        raise UnsupportedSOPhaseGeometry(
            f"route subtype {route.subtype.value!r} has no approved SO phase frame"
        )

    points = route.canonical_points
    major_east, major_north = _oriented_major_axis(
        route.orientation_deg,
        reference_major_axis,
    )
    minor_east, minor_north = -major_north, major_east
    anchor_index = _anchor_vertex(
        points,
        major_east,
        major_north,
        minor_east,
        minor_north,
    )
    anchor_phase = _phase_at_vertex(points, anchor_index)
    phase_sign = _phase_direction_sign(
        points,
        anchor_phase,
        minor_east,
        minor_north,
    )
    return SOPhaseFrame(
        route_id=route.route_id,
        subtype=route.subtype,
        anchor_phase=anchor_phase,
        phase_sign=phase_sign,
        major_east=major_east,
        major_north=major_north,
        minor_east=minor_east,
        minor_north=minor_north,
    )


def normalize_so_phase(
    route: ClosedRoute,
    raw_phase: float,
    *,
    reference_major_axis: tuple[float, float] | None = None,
) -> float:
    """Convenience wrapper for one-off normalization; cache frames in live code."""

    return build_so_phase_frame(
        route,
        reference_major_axis=reference_major_axis,
    ).normalize(raw_phase)


def _all_segment_projections(
    points: tuple[CanonicalPoint, ...],
    query: CanonicalPoint,
) -> tuple[PolylineProjection, ...]:
    lengths: list[float] = []
    for index, start in enumerate(points):
        end = points[(index + 1) % len(points)]
        length = math.hypot(end.x_m - start.x_m, end.y_m - start.y_m)
        if length <= _EPS:
            raise ValueError("consecutive canonical points must be distinct")
        lengths.append(length)
    total = sum(lengths)

    output: list[PolylineProjection] = []
    before = 0.0
    for index, (start, length) in enumerate(zip(points, lengths, strict=True)):
        end = points[(index + 1) % len(points)]
        dx = end.x_m - start.x_m
        dy = end.y_m - start.y_m
        raw_fraction = (
            (query.x_m - start.x_m) * dx + (query.y_m - start.y_m) * dy
        ) / (length * length)
        fraction = min(1.0, max(0.0, raw_fraction))
        projected = CanonicalPoint(start.x_m + dx * fraction, start.y_m + dy * fraction)
        distance = math.hypot(query.x_m - projected.x_m, query.y_m - projected.y_m)
        phase = (before + length * fraction) / total
        output.append(
            PolylineProjection(
                phase=phase % 1.0,
                distance_m=distance,
                projected=projected,
                tangent_east=dx / length,
                tangent_north=dy / length,
                segment_index=index,
            )
        )
        before += length
    return tuple(output)


def _cyclic_segment_separation(first: int, second: int, count: int) -> int:
    difference = abs(first - second)
    return min(difference, count - difference)


def _validated_velocity(
    velocity_east_mps: float | None,
    velocity_north_mps: float | None,
) -> tuple[float, float] | None:
    if (velocity_east_mps is None) != (velocity_north_mps is None):
        raise ValueError("velocity east/north must both be supplied or both be absent")
    if velocity_east_mps is None:
        return None
    east = float(velocity_east_mps)
    north = float(velocity_north_mps)
    if not math.isfinite(east) or not math.isfinite(north):
        raise ValueError("velocity must be finite")
    if math.hypot(east, north) <= _EPS:
        return None
    return east, north


def _figure_eight_projection(
    route: ClosedRoute,
    query: CanonicalPoint,
    *,
    velocity_east_mps: float | None,
    velocity_north_mps: float | None,
    ambiguity_distance_short_axis_ratio: float,
) -> tuple[PolylineProjection, bool, int, float | None]:
    if not math.isfinite(ambiguity_distance_short_axis_ratio) or ambiguity_distance_short_axis_ratio < 0:
        raise ValueError("ambiguity_distance_short_axis_ratio must be finite and non-negative")

    candidates = sorted(
        _all_segment_projections(route.canonical_points, query),
        key=lambda item: (item.distance_m, item.segment_index, item.phase),
    )
    nearest = candidates[0]
    ambiguity_band_m = route.short_axis_b_m * ambiguity_distance_short_axis_ratio
    nearby = tuple(
        item
        for item in candidates
        if item.distance_m <= nearest.distance_m + ambiguity_band_m + _EPS
    )
    segment_count = len(route.canonical_points)
    competing = tuple(
        item
        for item in nearby
        if _cyclic_segment_separation(
            nearest.segment_index,
            item.segment_index,
            segment_count,
        ) > 1
    )
    if not competing:
        return nearest, False, 1, None

    velocity = _validated_velocity(velocity_east_mps, velocity_north_mps)
    if velocity is None:
        raise AmbiguousSOPhaseProjection(
            "Figure-8 crossing has multiple non-adjacent route branches; heading is required"
        )

    ranked: list[tuple[float, float, int, PolylineProjection]] = []
    for item in nearby:
        heading_error = vector_angle_error_deg(
            velocity[0],
            velocity[1],
            item.tangent_east,
            item.tangent_north,
        )
        ranked.append((heading_error, item.distance_m, item.segment_index, item))
    heading_error, _, _, selected = min(ranked, key=lambda row: row[:3])
    return selected, True, len(nearby), heading_error


def project_so_semantic_phase_local(
    route: ClosedRoute,
    query: CanonicalPoint,
    *,
    frame: SOPhaseFrame | None = None,
    velocity_east_mps: float | None = None,
    velocity_north_mps: float | None = None,
    ambiguity_distance_short_axis_ratio: float = _DEFAULT_AMBIGUITY_DISTANCE_SHORT_AXIS_RATIO,
) -> SOSemanticProjection:
    """Project one local SO position and return geometry-stable semantic phase."""

    active_frame = frame or build_so_phase_frame(route)
    if active_frame.route_id != route.route_id:
        raise ValueError("phase frame belongs to a different route")

    # Validate the velocity contract consistently for every SO subtype even when
    # the simple-route path does not need heading for branch selection.
    _validated_velocity(velocity_east_mps, velocity_north_mps)

    if route.subtype is RouteSubtype.FIGURE_EIGHT:
        projection, disambiguated, candidate_count, heading_error = _figure_eight_projection(
            route,
            query,
            velocity_east_mps=velocity_east_mps,
            velocity_north_mps=velocity_north_mps,
            ambiguity_distance_short_axis_ratio=ambiguity_distance_short_axis_ratio,
        )
    else:
        projection = project_onto_closed_polyline(route.canonical_points, query)
        disambiguated = False
        candidate_count = 1
        heading_error = None

    return SOSemanticProjection(
        projection=projection,
        semantic_phase=active_frame.normalize(projection.phase),
        heading_disambiguated=disambiguated,
        candidate_count=candidate_count,
        heading_error_deg=heading_error,
    )


def project_so_semantic_phase_wgs84(
    route: ClosedRoute,
    latitude_deg: float,
    longitude_deg: float,
    *,
    frame: SOPhaseFrame | None = None,
    velocity_east_mps: float | None = None,
    velocity_north_mps: float | None = None,
    ambiguity_distance_short_axis_ratio: float = _DEFAULT_AMBIGUITY_DISTANCE_SHORT_AXIS_RATIO,
) -> SOSemanticProjection:
    """WGS84 wrapper used by live/offline session integration."""

    query = wgs84_to_local_m(
        latitude_deg,
        longitude_deg,
        route.center_latitude_deg,
        route.center_longitude_deg,
    )
    return project_so_semantic_phase_local(
        route,
        query,
        frame=frame,
        velocity_east_mps=velocity_east_mps,
        velocity_north_mps=velocity_north_mps,
        ambiguity_distance_short_axis_ratio=ambiguity_distance_short_axis_ratio,
    )
