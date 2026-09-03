"""Small deterministic generators used by the first core laboratory."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from .models import Direction, FieldQuality, VehicleSample


EARTH_RADIUS_M = 6_378_137.0


@dataclass(frozen=True, slots=True)
class SimulatedVehicle:
    vehicle_number: int
    vehicle_identifier: int
    phase_offset_deg: float


def generate_si_circle_samples(
    *,
    start_time_utc: datetime,
    duration_seconds: int,
    vehicles: tuple[SimulatedVehicle, ...],
    server_id: int = 1,
    center_latitude_deg: float = 31.8,
    center_longitude_deg: float = 34.8,
    radius_m: float = 100.0,
    period_seconds: float = 120.0,
    direction: Direction = Direction.CLOCKWISE,
    sample_interval_seconds: int = 1,
    position_noise_std_m: float = 0.0,
    seed: int = 1,
) -> tuple[VehicleSample, ...]:
    """Generate WGS84 samples for a synchronized concentric SI scenario."""
    if start_time_utc.tzinfo is None:
        raise ValueError("start_time_utc must be timezone-aware")
    if duration_seconds < 0 or sample_interval_seconds <= 0:
        raise ValueError("duration and interval must be positive")
    if radius_m <= 0 or period_seconds <= 0:
        raise ValueError("radius and period must be positive")
    rng = random.Random(seed)
    sign = -1.0 if direction is Direction.CLOCKWISE else 1.0
    center_lat_rad = math.radians(center_latitude_deg)
    omega = sign * 2.0 * math.pi / period_seconds
    output: list[VehicleSample] = []
    quality = {
        "latitude_deg": FieldQuality.ORIGINAL,
        "longitude_deg": FieldQuality.ORIGINAL,
        "velocity_north_mps": FieldQuality.ORIGINAL,
        "velocity_east_mps": FieldQuality.ORIGINAL,
        "active": FieldQuality.ORIGINAL,
        "vehicle_identifier": FieldQuality.ORIGINAL,
    }

    for second in range(0, duration_seconds + 1, sample_interval_seconds):
        timestamp = start_time_utc.astimezone(UTC) + timedelta(seconds=second)
        for vehicle in vehicles:
            angle = math.radians(vehicle.phase_offset_deg) + omega * second
            east_m = radius_m * math.cos(angle)
            north_m = radius_m * math.sin(angle)
            if position_noise_std_m:
                east_m += rng.gauss(0.0, position_noise_std_m)
                north_m += rng.gauss(0.0, position_noise_std_m)
            latitude = center_latitude_deg + math.degrees(north_m / EARTH_RADIUS_M)
            longitude = center_longitude_deg + math.degrees(
                east_m / (EARTH_RADIUS_M * math.cos(center_lat_rad))
            )
            velocity_east = -radius_m * math.sin(angle) * omega
            velocity_north = radius_m * math.cos(angle) * omega
            output.append(
                VehicleSample(
                    sample_time_utc=timestamp,
                    server_id=server_id,
                    vehicle_number=vehicle.vehicle_number,
                    vehicle_identifier=vehicle.vehicle_identifier,
                    active=True,
                    latitude_deg=latitude,
                    longitude_deg=longitude,
                    velocity_north_mps=velocity_north,
                    velocity_east_mps=velocity_east,
                    reliability=1.0,
                    field_quality=quality,
                )
            )
    output.sort(
        key=lambda item: (item.sample_time_utc, item.server_id, item.vehicle_identifier)
    )
    return tuple(output)

