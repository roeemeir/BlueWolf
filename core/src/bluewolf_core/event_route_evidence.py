"""Immutable detected-route geometry evidence for investigation/reporting.

REP-02 must draw the route that the Core actually identified for the event.  It
must not recreate a hippodrome/circle from a name or infer a centerline from the
navigation trace.  This module snapshots the approved ``ClosedRoute`` object
that is already attached to each live SO member and converts its canonical
local centerline to WGS84 once, at the same event timestamp as scoring and
navigation evidence.

The snapshot is metadata only.  It never participates in scoring, grouping or
route detection.
"""
from __future__ import annotations

from dataclasses import dataclass
import math

from .models import ClosedRoute

_EARTH_RADIUS_M = 6_378_137.0


def _finite(name: str, value: float) -> float:
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError(f"{name} must be finite")
    return numeric


def _local_to_wgs84(*, center_latitude_deg: float, center_longitude_deg: float, east_m: float, north_m: float) -> tuple[float, float]:
    """Invert the tangent-plane approximation used by the Core geometry layer."""

    lat0_rad = math.radians(center_latitude_deg)
    cos_lat = math.cos(lat0_rad)
    if abs(cos_lat) <= 1e-9:
        raise ValueError("route center latitude is too close to a pole for local WGS84 projection")
    latitude = center_latitude_deg + math.degrees(north_m / _EARTH_RADIUS_M)
    longitude = center_longitude_deg + math.degrees(east_m / (_EARTH_RADIUS_M * cos_lat))
    if not -90.0 <= latitude <= 90.0 or not -180.0 <= longitude <= 180.0:
        raise ValueError("route centerline projection is outside WGS84 range")
    return latitude, longitude


@dataclass(frozen=True, slots=True)
class SOEventRoutePoint:
    latitude_deg: float
    longitude_deg: float

    def __post_init__(self) -> None:
        latitude = _finite("route latitude_deg", self.latitude_deg)
        longitude = _finite("route longitude_deg", self.longitude_deg)
        if not -90.0 <= latitude <= 90.0:
            raise ValueError("route latitude_deg is outside WGS84 range")
        if not -180.0 <= longitude <= 180.0:
            raise ValueError("route longitude_deg is outside WGS84 range")


@dataclass(frozen=True, slots=True)
class SOEventRouteEvidence:
    route_instance_id: str
    route_id: str
    family: str
    subtype: str
    topology: str
    center_latitude_deg: float
    center_longitude_deg: float
    length_m: float
    long_axis_a_m: float
    short_axis_b_m: float
    orientation_deg: float
    estimated_period_s: float
    direction: str
    detection_quality: float
    centerline_wgs84: tuple[SOEventRoutePoint, ...]

    def __post_init__(self) -> None:
        if not self.route_instance_id:
            raise ValueError("route_instance_id is required")
        if not self.route_id:
            raise ValueError("route_id is required")
        for name in ("family", "subtype", "topology", "direction"):
            if not str(getattr(self, name)):
                raise ValueError(f"route {name} is required")
        latitude = _finite("route center_latitude_deg", self.center_latitude_deg)
        longitude = _finite("route center_longitude_deg", self.center_longitude_deg)
        if not -90.0 <= latitude <= 90.0:
            raise ValueError("route center_latitude_deg is outside WGS84 range")
        if not -180.0 <= longitude <= 180.0:
            raise ValueError("route center_longitude_deg is outside WGS84 range")
        for name in ("length_m", "long_axis_a_m", "short_axis_b_m", "estimated_period_s"):
            if _finite(name, getattr(self, name)) <= 0.0:
                raise ValueError(f"route {name} must be positive")
        _finite("route orientation_deg", self.orientation_deg)
        quality = _finite("route detection_quality", self.detection_quality)
        if not 0.0 <= quality <= 1.0:
            raise ValueError("route detection_quality must be in [0,1]")
        if len(self.centerline_wgs84) < 3:
            raise ValueError("route centerline requires at least three WGS84 points")


def snapshot_closed_route(route_instance_id: str, route: ClosedRoute) -> SOEventRouteEvidence:
    if not route_instance_id:
        raise ValueError("route_instance_id is required")
    centerline = tuple(
        SOEventRoutePoint(
            *_local_to_wgs84(
                center_latitude_deg=route.center_latitude_deg,
                center_longitude_deg=route.center_longitude_deg,
                east_m=point.x_m,
                north_m=point.y_m,
            )
        )
        for point in route.canonical_points
    )
    return SOEventRouteEvidence(
        route_instance_id=route_instance_id,
        route_id=route.route_id,
        family=route.family.value,
        subtype=route.subtype.value,
        topology=route.topology.value,
        center_latitude_deg=route.center_latitude_deg,
        center_longitude_deg=route.center_longitude_deg,
        length_m=route.length_m,
        long_axis_a_m=route.long_axis_a_m,
        short_axis_b_m=route.short_axis_b_m,
        orientation_deg=route.orientation_deg,
        estimated_period_s=route.estimated_period_s,
        direction=route.direction.value,
        detection_quality=route.detection_quality,
        centerline_wgs84=centerline,
    )


__all__ = ["SOEventRouteEvidence", "SOEventRoutePoint", "snapshot_closed_route"]
