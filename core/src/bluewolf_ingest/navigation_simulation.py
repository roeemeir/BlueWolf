"""TEST-ONLY navigation input for the actual Blue Wolf ingest and Python Core.

This adapter substitutes *only* raw Influx navigation metric points. It does
not synthesize detected routes, group membership, scoring, events, alerts,
archives or Web snapshots. The operational InfluxDB2WindowReader applies the
normal bounded temporal join to its output.

This is not a customer-data replay and must never be selected in production.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import math
from typing import Callable

from .models import MetricName, RawMetricPoint

_EARTH_RADIUS_M = 6_371_000.0
_METRICS = (
    (MetricName.VEHICLE_IDENTIFIER, "vehicle_identifier"),
    (MetricName.ACTIVE, "active"),
    (MetricName.LATITUDE, "latitude_deg"),
    (MetricName.LONGITUDE, "longitude_deg"),
    (MetricName.ALTITUDE, "altitude_m"),
    (MetricName.VELOCITY_NORTH, "velocity_north_mps"),
    (MetricName.VELOCITY_EAST, "velocity_east_mps"),
)


def _finite(name: str, value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


@dataclass(frozen=True, slots=True)
class SyntheticNavigationVehicle:
    """Explicit QA route coordinates, NOT a detected route or Core binding."""

    server_id: int
    vehicle_number: int
    center_latitude_deg: float
    center_longitude_deg: float
    radius_m: float
    period_s: float
    route_shape: str = "circle"
    straight_length_m: float = 0.0
    phase_fraction: float = 0.0
    heading_deg: float = 0.0
    direction: str = "counterclockwise"
    altitude_m: float = 0.0
    vehicle_identifier: int | None = None

    def __post_init__(self) -> None:
        for name in ("server_id", "vehicle_number"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"{name} must be a non-negative integer")
        if self.vehicle_identifier is not None and (
            isinstance(self.vehicle_identifier, bool)
            or not isinstance(self.vehicle_identifier, int)
            or self.vehicle_identifier < 0
        ):
            raise ValueError("vehicle_identifier must be a non-negative integer")
        lat = _finite("center_latitude_deg", self.center_latitude_deg)
        lon = _finite("center_longitude_deg", self.center_longitude_deg)
        radius = _finite("radius_m", self.radius_m)
        length = _finite("straight_length_m", self.straight_length_m)
        period = _finite("period_s", self.period_s)
        phase = _finite("phase_fraction", self.phase_fraction)
        _finite("heading_deg", self.heading_deg)
        _finite("altitude_m", self.altitude_m)
        if not -70.0 <= lat <= 70.0 or not -170.0 <= lon <= 170.0:
            raise ValueError("simulation center must be within safe WGS84 bounds")
        if not 1.0 <= radius <= 5_000.0 or not 0.0 <= length <= 20_000.0:
            raise ValueError("simulation route dimensions are out of bounds")
        if not 10.0 <= period <= 86_400.0 or not 0.0 <= phase < 1.0:
            raise ValueError("simulation period or phase is out of bounds")
        if self.route_shape not in {"circle", "hippodrome"}:
            raise ValueError("simulation route_shape must be circle or hippodrome")
        if self.route_shape == "circle" and length != 0.0:
            raise ValueError("circle must not define a straight segment")
        if self.route_shape == "hippodrome" and length <= 0.0:
            raise ValueError("hippodrome needs a positive straight segment")
        if self.direction not in {"clockwise", "counterclockwise"}:
            raise ValueError("simulation direction is unsupported")

    def navigation_at(self, elapsed_seconds: float) -> dict[str, float | bool | int]:
        """Generate only one test navigation observation and physical velocity."""
        direction = -1.0 if self.direction == "clockwise" else 1.0
        radius = self.radius_m
        if self.route_shape == "circle":
            angle = 2.0 * math.pi * (
                self.phase_fraction + direction * elapsed_seconds / self.period_s
            )
            east = radius * math.cos(angle)
            north = radius * math.sin(angle)
            speed = 2.0 * math.pi * radius / self.period_s
            velocity_east = -direction * speed * math.sin(angle)
            velocity_north = direction * speed * math.cos(angle)
        else:
            length = self.straight_length_m
            perimeter = 2.0 * length + 2.0 * math.pi * radius
            arc_position = (
                self.phase_fraction + direction * elapsed_seconds / self.period_s
            ) % 1.0 * perimeter
            if arc_position < length:
                east, north, tangent_east, tangent_north = (
                    -length / 2.0 + arc_position, -radius, 1.0, 0.0
                )
            elif arc_position < length + math.pi * radius:
                angle = -math.pi / 2.0 + (arc_position - length) / radius
                east = length / 2.0 + radius * math.cos(angle)
                north = radius * math.sin(angle)
                tangent_east, tangent_north = -math.sin(angle), math.cos(angle)
            elif arc_position < 2.0 * length + math.pi * radius:
                east = length / 2.0 - (arc_position - length - math.pi * radius)
                north = radius
                tangent_east, tangent_north = -1.0, 0.0
            else:
                angle = math.pi / 2.0 + (
                    arc_position - 2.0 * length - math.pi * radius
                ) / radius
                east = -length / 2.0 + radius * math.cos(angle)
                north = radius * math.sin(angle)
                tangent_east, tangent_north = -math.sin(angle), math.cos(angle)
            speed = perimeter / self.period_s * direction
            velocity_east = tangent_east * speed
            velocity_north = tangent_north * speed

        heading = math.radians(self.heading_deg)
        cosine, sine = math.cos(heading), math.sin(heading)
        rotated_east = east * cosine - north * sine
        rotated_north = east * sine + north * cosine
        rotated_velocity_east = velocity_east * cosine - velocity_north * sine
        rotated_velocity_north = velocity_east * sine + velocity_north * cosine
        latitude = self.center_latitude_deg + math.degrees(rotated_north / _EARTH_RADIUS_M)
        longitude = self.center_longitude_deg + math.degrees(
            rotated_east / (_EARTH_RADIUS_M * math.cos(math.radians(self.center_latitude_deg)))
        )
        return {
            "vehicle_identifier": self.vehicle_number if self.vehicle_identifier is None else self.vehicle_identifier,
            "active": True,
            "latitude_deg": latitude,
            "longitude_deg": longitude,
            "altitude_m": self.altitude_m,
            "velocity_north_mps": rotated_velocity_north,
            "velocity_east_mps": rotated_velocity_east,
        }


@dataclass(slots=True)
class SimulatedNavigationMetricAdapter:
    """Influx adapter-shaped TEST source emitting raw metrics, never computed scores."""

    vehicles: tuple[SyntheticNavigationVehicle, ...]
    started_at_utc: datetime
    sample_seconds: int = 1
    clock: Callable[[], datetime] = lambda: datetime.now(UTC)

    def __post_init__(self) -> None:
        if self.started_at_utc.tzinfo is None:
            raise ValueError("simulation start must have a timezone")
        self.started_at_utc = self.started_at_utc.astimezone(UTC)
        if isinstance(self.sample_seconds, bool) or not isinstance(self.sample_seconds, int) or not 1 <= self.sample_seconds <= 5:
            raise ValueError("simulation sample_seconds must be an integer in [1,5]")
        if not self.vehicles:
            raise ValueError("simulation requires explicit navigation vehicles")
        identities = [(vehicle.server_id, vehicle.vehicle_number) for vehicle in self.vehicles]
        if len(identities) != len(set(identities)):
            raise ValueError("duplicate simulated vehicle on one server")
        resolved_ids = [
            (vehicle.server_id, vehicle.vehicle_number if vehicle.vehicle_identifier is None else vehicle.vehicle_identifier)
            for vehicle in self.vehicles
        ]
        if len(resolved_ids) != len(set(resolved_ids)):
            raise ValueError("duplicate simulated vehicle identifier on one server")

    def query_points(
        self,
        *,
        server_id: int,
        server_tag_value: str | None,
        start_time_utc: datetime,
        stop_time_utc: datetime,
    ) -> tuple[RawMetricPoint, ...]:
        del server_tag_value  # Server isolation uses the explicit integer server_id.
        if start_time_utc.tzinfo is None or stop_time_utc.tzinfo is None:
            raise ValueError("simulation query bounds must have timezone")
        start = start_time_utc.astimezone(UTC)
        stop = stop_time_utc.astimezone(UTC)
        now = self.clock()
        if now.tzinfo is None:
            raise ValueError("simulation clock must have timezone")
        now = now.astimezone(UTC)
        if stop <= start or now < self.started_at_utc:
            return ()

        step_us = self.sample_seconds * 1_000_000
        first_delta_us = (start - self.started_at_utc) // timedelta(microseconds=1)
        stop_delta_us = (stop - self.started_at_utc) // timedelta(microseconds=1)
        now_delta_us = (now - self.started_at_utc) // timedelta(microseconds=1)
        first_index = max(0, -(-first_delta_us // step_us))
        last_index = min((stop_delta_us - 1) // step_us, now_delta_us // step_us)
        if first_index > last_index:
            return ()
        selected = tuple(vehicle for vehicle in self.vehicles if vehicle.server_id == server_id)
        if not selected:
            return ()
        if (last_index - first_index + 1) * len(selected) > 250_000:
            raise ValueError("simulation query exceeds bounded test navigation window")
        result: list[RawMetricPoint] = []
        for index in range(first_index, last_index + 1):
            timestamp = self.started_at_utc + timedelta(seconds=index * self.sample_seconds)
            elapsed_s = index * self.sample_seconds
            for vehicle in selected:
                navigation = vehicle.navigation_at(elapsed_s)
                for metric, field_name in _METRICS:
                    result.append(
                        RawMetricPoint(
                            source_time_utc=timestamp,
                            server_id=server_id,
                            vehicle_number=vehicle.vehicle_number,
                            metric=metric,
                            value=navigation[field_name],
                        )
                    )
        return tuple(result)


__all__ = ["SyntheticNavigationVehicle", "SimulatedNavigationMetricAdapter"]
