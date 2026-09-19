"""Live SI movement-direction evidence from velocity against route tangent.

V2 canonical points are ordered by observed phase/time. Therefore the projected
polyline tangent already points in the direction represented by
``ClosedRoute.direction``. A live velocity with a positive tangent dot product
continues in that direction; a negative dot product is the opposite traversal.
"""
from __future__ import annotations

import math

from .geometry import project_wgs84
from .models import ClosedRoute, Direction, RouteFamily, VehicleSample


_EPSILON = 1e-9


def live_si_direction(sample: VehicleSample, route: ClosedRoute) -> Direction:
    """Return current SI traversal direction, or UNKNOWN without usable evidence."""

    if route.family is not RouteFamily.SI or route.direction is Direction.UNKNOWN:
        return Direction.UNKNOWN
    if (
        sample.active is False
        or sample.latitude_deg is None
        or sample.longitude_deg is None
        or sample.velocity_east_mps is None
        or sample.velocity_north_mps is None
    ):
        return Direction.UNKNOWN

    east = float(sample.velocity_east_mps)
    north = float(sample.velocity_north_mps)
    if math.hypot(east, north) <= _EPSILON:
        return Direction.UNKNOWN

    projection = project_wgs84(
        route,
        float(sample.latitude_deg),
        float(sample.longitude_deg),
    )
    dot = east * projection.tangent_east + north * projection.tangent_north
    if abs(dot) <= _EPSILON:
        return Direction.UNKNOWN
    if dot > 0.0:
        return route.direction
    return (
        Direction.COUNTERCLOCKWISE
        if route.direction is Direction.CLOCKWISE
        else Direction.CLOCKWISE
    )
