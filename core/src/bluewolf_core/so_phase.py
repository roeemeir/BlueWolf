"""Geometry-stable semantic phase frames for SO synchronization.

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

For Figure-8 this frame only normalizes a raw phase that is already known. Live
position projection at the self-crossing still requires heading-aware branch
selection; position-only projection must not be treated as authoritative there.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .geometry import closed_polyline_length, point_at_phase
from .models import CanonicalPoint, ClosedRoute, RouteFamily, RouteSubtype


_EPS = 1e-12


class UnsupportedSOPhaseGeometry(ValueError):
    """Raised when the approved geometry does not define an SO phase frame."""


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
        # Major extent owns the decision. Near a flat sampled apex, prefer the
        # point closest to the major axis, then deterministic world coordinates.
        # Index is intentionally not part of the key so reversing traversal does
        # not change a non-ambiguous physical anchor.
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
