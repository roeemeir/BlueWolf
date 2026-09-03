"""Raw metric values returned independently by an Influx adapter."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum


class MetricName(StrEnum):
    VEHICLE_IDENTIFIER = "vehicle_identifier"
    ACTIVE = "active"
    LATITUDE = "latitude_deg"
    LONGITUDE = "longitude_deg"
    ALTITUDE = "altitude_m"
    VELOCITY_NORTH = "velocity_north_mps"
    VELOCITY_EAST = "velocity_east_mps"


MetricValue = float | int | str | bool


@dataclass(frozen=True, slots=True)
class RawMetricPoint:
    """One original Influx value before the permissive temporal join."""

    source_time_utc: datetime
    server_id: int
    vehicle_number: int
    metric: MetricName
    value: MetricValue

    def __post_init__(self) -> None:
        if self.source_time_utc.tzinfo is None:
            raise ValueError("source_time_utc must be timezone-aware")
        object.__setattr__(self, "source_time_utc", self.source_time_utc.astimezone(UTC))
        if self.server_id < 0 or self.vehicle_number < 0:
            raise ValueError("server_id and vehicle_number must be non-negative")
