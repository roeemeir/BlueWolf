"""Vectorized adapter from versioned VehicleSample streams to VectorTrack.

This module performs no route classification and encodes no route-shape priors.
Its only job is to preserve chronology, convert WGS84 positions to a local
metric frame and represent communication holes explicitly via observed_mask.

Long gaps are never position-interpolated here. Finite placeholder coordinates
exist only because VectorTrack stores dense NumPy arrays; observed_mask=False is
authoritative and every vector algorithm masks those slots.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import math
from typing import Iterable

import numpy as np

from .geometry import EARTH_RADIUS_M
from .models import VehicleSample
from .vector_trajectory import VectorTrack


@dataclass(frozen=True, slots=True)
class PreparedVectorTrack:
    track: VectorTrack
    origin_latitude_deg: float
    origin_longitude_deg: float
    grid_start_utc: datetime
    grid_seconds: float
    source_sample_count: int
    observed_grid_count: int

    def grid_time_utc(self, index: int) -> datetime:
        if not 0 <= index < len(self.track.time_s):
            raise IndexError(index)
        return self.grid_start_utc + timedelta(seconds=float(self.track.time_s[index]))


def _valid_position_samples(samples: Iterable[VehicleSample]) -> tuple[VehicleSample, ...]:
    ordered = tuple(
        sorted(
            (
                sample
                for sample in samples
                if sample.active is not False
                and sample.latitude_deg is not None
                and sample.longitude_deg is not None
                and sample.reliability > 0.0
            ),
            key=lambda sample: sample.sample_time_utc,
        )
    )
    if not ordered:
        return ()
    keys = {sample.stream_key for sample in ordered}
    if len(keys) != 1:
        raise ValueError("vector track adapter expects exactly one vehicle stream")
    return ordered


def _infer_grid_seconds(epoch_seconds: np.ndarray) -> float:
    differences = np.diff(epoch_seconds)
    positive = differences[differences > 1e-6]
    if len(positive) == 0:
        raise ValueError("at least two distinct sample times are required")

    # Communication gaps are multiples of the normal cadence. Estimate cadence
    # from the denser half of observed deltas, not from the largest outages.
    cutoff = float(np.quantile(positive, 0.50))
    dense = positive[positive <= cutoff + 1e-9]
    cadence = float(np.median(dense if len(dense) else positive))
    if not math.isfinite(cadence) or cadence <= 0:
        raise ValueError("could not infer a positive sampling cadence")
    return cadence


def _wgs84_arrays_to_local_m(
    latitude_deg: np.ndarray,
    longitude_deg: np.ndarray,
    origin_latitude_deg: float,
    origin_longitude_deg: float,
) -> np.ndarray:
    latitude = np.asarray(latitude_deg, dtype=float)
    longitude = np.asarray(longitude_deg, dtype=float)
    origin_latitude_rad = math.radians(origin_latitude_deg)
    east = (
        np.deg2rad(longitude - origin_longitude_deg)
        * EARTH_RADIUS_M
        * math.cos(origin_latitude_rad)
    )
    north = np.deg2rad(latitude - origin_latitude_deg) * EARTH_RADIUS_M
    return np.column_stack((east, north))


def build_vector_track(
    samples: Iterable[VehicleSample],
    *,
    grid_seconds: float | None = None,
    snap_tolerance_fraction: float = 0.35,
) -> PreparedVectorTrack | None:
    """Build a dense metric time grid while retaining missing network slots.

    `grid_seconds` is a numerical sampling-grid choice, not a route timing gate.
    A caller such as CoreSession may pass its configured logical grid. If it is
    omitted, cadence is inferred robustly from the densest observed intervals.
    """

    ordered = _valid_position_samples(samples)
    if len(ordered) < 3:
        return None
    if not 0.0 < snap_tolerance_fraction <= 0.5:
        raise ValueError("snap_tolerance_fraction must be in (0,0.5]")

    epoch = np.array(
        [sample.sample_time_utc.astimezone(UTC).timestamp() for sample in ordered],
        dtype=float,
    )
    cadence = _infer_grid_seconds(epoch) if grid_seconds is None else float(grid_seconds)
    if not math.isfinite(cadence) or cadence <= 0:
        raise ValueError("grid_seconds must be positive and finite")

    start_epoch = float(epoch[0])
    relative = epoch - start_epoch
    slot_float = relative / cadence
    slot = np.rint(slot_float).astype(np.int64)
    snap_error = np.abs(slot_float - slot)
    accepted = snap_error <= snap_tolerance_fraction
    if np.count_nonzero(accepted) < 3:
        return None

    slot = slot[accepted]
    accepted_indices = np.flatnonzero(accepted)
    max_slot = int(np.max(slot))
    if max_slot < 2:
        return None

    latitude = np.array(
        [float(ordered[index].latitude_deg) for index in accepted_indices],
        dtype=float,
    )
    longitude = np.array(
        [float(ordered[index].longitude_deg) for index in accepted_indices],
        dtype=float,
    )
    # The origin is just a numerically stable local projection anchor. Route
    # center is estimated later from phase-balanced geometry.
    origin_latitude = float(np.median(latitude))
    origin_longitude = float(np.median(longitude))
    local = _wgs84_arrays_to_local_m(
        latitude,
        longitude,
        origin_latitude,
        origin_longitude,
    )

    grid_length = max_slot + 1
    xy_sum = np.zeros((grid_length, 2), dtype=float)
    xy_count = np.zeros(grid_length, dtype=np.int32)
    np.add.at(xy_sum, slot, local)
    np.add.at(xy_count, slot, 1)
    observed = xy_count > 0
    xy = np.zeros((grid_length, 2), dtype=float)
    xy[observed] = xy_sum[observed] / xy_count[observed, None]

    # Velocity is optional. Only publish a dense velocity array if at least one
    # accepted source sample provides it. Missing velocity slots stay zero and
    # must be interpreted together with observed_mask by downstream users.
    has_velocity = any(
        ordered[index].velocity_east_mps is not None
        and ordered[index].velocity_north_mps is not None
        for index in accepted_indices
    )
    velocity: np.ndarray | None = None
    if has_velocity:
        velocity_sum = np.zeros((grid_length, 2), dtype=float)
        velocity_count = np.zeros(grid_length, dtype=np.int32)
        velocity_source_indices: list[int] = []
        velocity_slots: list[int] = []
        for source_index, target_slot in zip(accepted_indices, slot, strict=True):
            sample = ordered[int(source_index)]
            if sample.velocity_east_mps is None or sample.velocity_north_mps is None:
                continue
            velocity_source_indices.append(int(source_index))
            velocity_slots.append(int(target_slot))
        if velocity_slots:
            values = np.array(
                [
                    (
                        float(ordered[index].velocity_east_mps),
                        float(ordered[index].velocity_north_mps),
                    )
                    for index in velocity_source_indices
                ],
                dtype=float,
            )
            targets = np.asarray(velocity_slots, dtype=np.int64)
            np.add.at(velocity_sum, targets, values)
            np.add.at(velocity_count, targets, 1)
            velocity = np.zeros((grid_length, 2), dtype=float)
            valid_velocity = velocity_count > 0
            velocity[valid_velocity] = (
                velocity_sum[valid_velocity] / velocity_count[valid_velocity, None]
            )

    track = VectorTrack(
        time_s=np.arange(grid_length, dtype=float) * cadence,
        xy_m=xy,
        observed_mask=observed,
        velocity_xy_mps=velocity,
    )
    return PreparedVectorTrack(
        track=track,
        origin_latitude_deg=origin_latitude,
        origin_longitude_deg=origin_longitude,
        grid_start_utc=datetime.fromtimestamp(start_epoch, tz=UTC),
        grid_seconds=cadence,
        source_sample_count=len(ordered),
        observed_grid_count=int(np.count_nonzero(observed)),
    )
