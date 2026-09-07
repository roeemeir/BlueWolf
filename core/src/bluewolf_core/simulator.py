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
    quality = _original_quality()

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


def generate_double_hippodrome_samples(
    *,
    start_time_utc: datetime,
    duration_seconds: int,
    vehicles: tuple[SimulatedVehicle, ...],
    server_id: int = 1,
    center_latitude_deg: float = 31.8,
    center_longitude_deg: float = 34.8,
    single_long_axis_m: float = 150.0,
    short_axis_m: float = 40.0,
    single_period_seconds: float = 240.0,
    orientation_deg: float = 0.0,
    sample_interval_seconds: int = 1,
    position_noise_std_m: float = 0.0,
    seed: int = 1,
) -> tuple[VehicleSample, ...]:
    """Generate a continuous two-lobe SO double hippodrome.

    The two equal hippodromes are collinear and share the middle end. One full
    double cycle traverses the left lobe and then the right lobe continuously;
    therefore ``double_period = 2 * single_period_seconds``. The two lobes have
    opposite winding, which is the continuous physical traversal of adjacent
    loops sharing an end. ``phase_offset_deg`` is interpreted over the complete
    double cycle.
    """

    if start_time_utc.tzinfo is None:
        raise ValueError("start_time_utc must be timezone-aware")
    if duration_seconds < 0 or sample_interval_seconds <= 0:
        raise ValueError("duration and interval must be positive")
    if short_axis_m <= 0 or single_long_axis_m <= short_axis_m:
        raise ValueError("single_long_axis_m must exceed positive short_axis_m")
    if single_period_seconds <= 0:
        raise ValueError("single_period_seconds must be positive")

    half_straight = single_long_axis_m - short_axis_m
    single_length = 4.0 * half_straight + 2.0 * math.pi * short_axis_m
    double_length = 2.0 * single_length
    double_period = 2.0 * single_period_seconds
    speed = double_length / double_period
    orientation = math.radians(orientation_deg)
    center_lat_rad = math.radians(center_latitude_deg)
    rng = random.Random(seed)
    output: list[VehicleSample] = []
    quality = _original_quality()

    for second in range(0, duration_seconds + 1, sample_interval_seconds):
        timestamp = start_time_utc.astimezone(UTC) + timedelta(seconds=second)
        for vehicle in vehicles:
            phase_distance = (
                (vehicle.phase_offset_deg % 360.0) / 360.0 * double_length
            )
            distance = speed * second + phase_distance
            point = _double_hippodrome_point_at_distance(
                distance,
                half_straight_m=half_straight,
                radius_m=short_axis_m,
            )
            # A short forward difference gives the physical tangent while
            # remaining stable at the analytically continuous segment joins.
            dt_velocity = 0.05
            next_point = _double_hippodrome_point_at_distance(
                distance + speed * dt_velocity,
                half_straight_m=half_straight,
                radius_m=short_axis_m,
            )
            point = _rotate(point, orientation)
            next_point = _rotate(next_point, orientation)

            east_m = point[0]
            north_m = point[1]
            if position_noise_std_m:
                east_m += rng.gauss(0.0, position_noise_std_m)
                north_m += rng.gauss(0.0, position_noise_std_m)

            latitude = center_latitude_deg + math.degrees(north_m / EARTH_RADIUS_M)
            longitude = center_longitude_deg + math.degrees(
                east_m / (EARTH_RADIUS_M * math.cos(center_lat_rad))
            )
            output.append(
                VehicleSample(
                    sample_time_utc=timestamp,
                    server_id=server_id,
                    vehicle_number=vehicle.vehicle_number,
                    vehicle_identifier=vehicle.vehicle_identifier,
                    active=True,
                    latitude_deg=latitude,
                    longitude_deg=longitude,
                    velocity_north_mps=(next_point[1] - point[1]) / dt_velocity,
                    velocity_east_mps=(next_point[0] - point[0]) / dt_velocity,
                    reliability=1.0,
                    field_quality=quality,
                )
            )

    output.sort(
        key=lambda item: (item.sample_time_utc, item.server_id, item.vehicle_identifier)
    )
    return tuple(output)


def _double_hippodrome_point_at_distance(
    distance_m: float,
    *,
    half_straight_m: float,
    radius_m: float,
) -> tuple[float, float]:
    """Point on two adjacent continuous stadium loops sharing the middle end."""

    straight = 2.0 * half_straight_m
    turn = math.pi * radius_m
    total = 4.0 * straight + 4.0 * turn
    distance = distance_m % total
    left_center = -straight
    right_center = straight

    # Left lobe: middle-top -> left-top -> left-bottom -> middle-bottom
    # -> middle-top through the right half of the shared turn.
    if distance < straight:
        return -distance, radius_m
    distance -= straight
    if distance < turn:
        angle = math.pi / 2.0 + distance / radius_m
        return (
            left_center + radius_m * math.cos(angle),
            radius_m * math.sin(angle),
        )
    distance -= turn
    if distance < straight:
        return left_center + distance, -radius_m
    distance -= straight
    if distance < turn:
        angle = -math.pi / 2.0 + distance / radius_m
        return radius_m * math.cos(angle), radius_m * math.sin(angle)
    distance -= turn

    # Right lobe: middle-top -> right-top -> right-bottom -> middle-bottom
    # -> middle-top through the left half of the shared turn.
    if distance < straight:
        return distance, radius_m
    distance -= straight
    if distance < turn:
        angle = math.pi / 2.0 - distance / radius_m
        return (
            right_center + radius_m * math.cos(angle),
            radius_m * math.sin(angle),
        )
    distance -= turn
    if distance < straight:
        return right_center - distance, -radius_m
    distance -= straight
    angle = -math.pi / 2.0 - distance / radius_m
    return radius_m * math.cos(angle), radius_m * math.sin(angle)


def _rotate(point: tuple[float, float], angle_rad: float) -> tuple[float, float]:
    cosine = math.cos(angle_rad)
    sine = math.sin(angle_rad)
    return (
        point[0] * cosine - point[1] * sine,
        point[0] * sine + point[1] * cosine,
    )


def _original_quality() -> dict[str, FieldQuality]:
    return {
        "latitude_deg": FieldQuality.ORIGINAL,
        "longitude_deg": FieldQuality.ORIGINAL,
        "velocity_north_mps": FieldQuality.ORIGINAL,
        "velocity_east_mps": FieldQuality.ORIGINAL,
        "active": FieldQuality.ORIGINAL,
        "vehicle_identifier": FieldQuality.ORIGINAL,
    }
