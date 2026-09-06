"""Small deterministic generators used by the Blue Wolf core laboratory."""

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
    wind_response_gain: float = 1.0


@dataclass(frozen=True, slots=True)
class SimulatedWind:
    """Deterministic horizontal disturbance used by simulator QA scenarios.

    Bearings follow the product convention: 0° is geographic north and values
    increase clockwise. ``position_response_seconds`` is a bounded controller
    response term rather than an unbounded free-drift integration, so long
    simulations remain close to the nominal route while still showing a
    measurable navigation/synchronization disturbance.
    """

    steady_north_mps: float = 0.0
    steady_east_mps: float = 0.0
    gust_amplitude_mps: float = 0.0
    gust_period_seconds: float = 30.0
    gust_bearing_deg: float = 0.0
    position_response_seconds: float = 1.5
    velocity_coupling: float = 0.35

    def validate(self) -> None:
        if self.gust_amplitude_mps and self.gust_period_seconds <= 0:
            raise ValueError("gust_period_seconds must be positive when gusts are enabled")
        if self.position_response_seconds < 0:
            raise ValueError("position_response_seconds must be non-negative")
        if self.velocity_coupling < 0:
            raise ValueError("velocity_coupling must be non-negative")


def wind_vector_mps(wind: SimulatedWind | None, elapsed_seconds: float) -> tuple[float, float]:
    """Return deterministic (north, east) disturbance velocity in m/s."""
    if wind is None:
        return (0.0, 0.0)
    wind.validate()
    north = wind.steady_north_mps
    east = wind.steady_east_mps
    if wind.gust_amplitude_mps:
        phase = 2.0 * math.pi * elapsed_seconds / wind.gust_period_seconds
        gust = wind.gust_amplitude_mps * math.sin(phase)
        bearing = math.radians(wind.gust_bearing_deg)
        north += gust * math.cos(bearing)
        east += gust * math.sin(bearing)
    return (north, east)


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
    wind: SimulatedWind | None = None,
    seed: int = 1,
) -> tuple[VehicleSample, ...]:
    """Generate WGS84 samples for a synchronized concentric SI scenario.

    When ``wind`` is provided, the generated navigation position and measured
    velocity include a deterministic disturbance. Different
    ``wind_response_gain`` values let vehicles react differently to the same
    external field, which produces a measurable synchronization effect while
    keeping the nominal route definition unchanged.
    """
    if start_time_utc.tzinfo is None:
        raise ValueError("start_time_utc must be timezone-aware")
    if duration_seconds < 0 or sample_interval_seconds <= 0:
        raise ValueError("duration and interval must be positive")
    if radius_m <= 0 or period_seconds <= 0:
        raise ValueError("radius and period must be positive")
    if any(vehicle.wind_response_gain < 0 for vehicle in vehicles):
        raise ValueError("wind_response_gain must be non-negative")
    if wind is not None:
        wind.validate()

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
        disturbance_north, disturbance_east = wind_vector_mps(wind, second)
        for vehicle in vehicles:
            angle = math.radians(vehicle.phase_offset_deg) + omega * second
            gain = vehicle.wind_response_gain
            east_m = radius_m * math.cos(angle)
            north_m = radius_m * math.sin(angle)
            if wind is not None:
                east_m += disturbance_east * wind.position_response_seconds * gain
                north_m += disturbance_north * wind.position_response_seconds * gain
            if position_noise_std_m:
                east_m += rng.gauss(0.0, position_noise_std_m)
                north_m += rng.gauss(0.0, position_noise_std_m)
            latitude = center_latitude_deg + math.degrees(north_m / EARTH_RADIUS_M)
            longitude = center_longitude_deg + math.degrees(
                east_m / (EARTH_RADIUS_M * math.cos(center_lat_rad))
            )
            velocity_east = -radius_m * math.sin(angle) * omega
            velocity_north = radius_m * math.cos(angle) * omega
            if wind is not None:
                velocity_east += disturbance_east * wind.velocity_coupling * gain
                velocity_north += disturbance_north * wind.velocity_coupling * gain
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
