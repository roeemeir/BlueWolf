"""Generic deterministic closed-polyline NAV simulator for Core QA.

The generator knows only an ordered closed metric polyline. It does not know or
label SI/SO, circle, hippodrome, Double, Figure-8 or polygon families. Motion is
parameterized by normalized arc length, and optional deterministic wind/noise is
applied after the nominal point/tangent are evaluated.
"""

from __future__ import annotations

import math
import random
from datetime import UTC, datetime, timedelta
from typing import Sequence

from .models import FieldQuality, VehicleSample
from .simulator import EARTH_RADIUS_M, SimulatedVehicle, SimulatedWind, wind_vector_mps


def _segments(points: Sequence[tuple[float, float]]):
    if len(points) < 3:
        raise ValueError("closed polyline requires at least three points")
    output: list[tuple[tuple[float, float], tuple[float, float], float]] = []
    for index, start in enumerate(points):
        end = points[(index + 1) % len(points)]
        length = math.hypot(end[0] - start[0], end[1] - start[1])
        if length <= 1e-9:
            raise ValueError("consecutive polyline points must be distinct")
        output.append((start, end, length))
    return output


def _point_and_tangent(points: Sequence[tuple[float, float]], phase: float):
    segments = _segments(points)
    total = sum(item[2] for item in segments)
    target = (phase % 1.0) * total
    traversed = 0.0
    for index, (start, end, length) in enumerate(segments):
        if target < traversed + length or index == len(segments) - 1:
            fraction = min(1.0, max(0.0, (target - traversed) / length))
            east = start[0] + (end[0] - start[0]) * fraction
            north = start[1] + (end[1] - start[1]) * fraction
            return east, north, (end[0] - start[0]) / length, (end[1] - start[1]) / length, total
        traversed += length
    raise AssertionError("unreachable")


def generate_closed_polyline_samples(
    *,
    points_east_north_m: Sequence[tuple[float, float]],
    start_time_utc: datetime,
    duration_seconds: int,
    period_seconds: float,
    vehicles: tuple[SimulatedVehicle, ...],
    server_id: int = 1,
    center_latitude_deg: float = 31.8,
    center_longitude_deg: float = 34.8,
    sample_interval_seconds: int = 1,
    position_noise_std_m: float = 0.0,
    wind: SimulatedWind | None = None,
    seed: int = 1,
) -> tuple[VehicleSample, ...]:
    if start_time_utc.tzinfo is None:
        raise ValueError("start_time_utc must be timezone-aware")
    if duration_seconds < 0 or sample_interval_seconds <= 0 or period_seconds <= 0:
        raise ValueError("duration/interval/period must be positive")
    _segments(points_east_north_m)
    if wind is not None:
        wind.validate()

    rng = random.Random(seed)
    center_lat_rad = math.radians(center_latitude_deg)
    quality = {
        "latitude_deg": FieldQuality.ORIGINAL,
        "longitude_deg": FieldQuality.ORIGINAL,
        "velocity_north_mps": FieldQuality.ORIGINAL,
        "velocity_east_mps": FieldQuality.ORIGINAL,
        "active": FieldQuality.ORIGINAL,
        "vehicle_identifier": FieldQuality.ORIGINAL,
    }
    output: list[VehicleSample] = []

    for second in range(0, duration_seconds + 1, sample_interval_seconds):
        timestamp = start_time_utc.astimezone(UTC) + timedelta(seconds=second)
        disturbance_north, disturbance_east = wind_vector_mps(wind, second)
        for vehicle in vehicles:
            phase = second / period_seconds + vehicle.phase_offset_deg / 360.0
            east, north, tangent_east, tangent_north, length = _point_and_tangent(points_east_north_m, phase)
            nominal_speed = length / period_seconds
            gain = vehicle.wind_response_gain
            if wind is not None:
                east += disturbance_east * wind.position_response_seconds * gain
                north += disturbance_north * wind.position_response_seconds * gain
            if position_noise_std_m:
                east += rng.gauss(0.0, position_noise_std_m)
                north += rng.gauss(0.0, position_noise_std_m)
            velocity_east = tangent_east * nominal_speed
            velocity_north = tangent_north * nominal_speed
            if wind is not None:
                velocity_east += disturbance_east * wind.velocity_coupling * gain
                velocity_north += disturbance_north * wind.velocity_coupling * gain
            latitude = center_latitude_deg + math.degrees(north / EARTH_RADIUS_M)
            longitude = center_longitude_deg + math.degrees(east / (EARTH_RADIUS_M * math.cos(center_lat_rad)))
            output.append(VehicleSample(
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
            ))
    output.sort(key=lambda item: (item.sample_time_utc, item.server_id, item.vehicle_identifier))
    return tuple(output)


__all__ = ["generate_closed_polyline_samples"]
