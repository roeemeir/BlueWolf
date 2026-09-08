"""Topology-neutral evidence for an early route candidate.

A partial candidate must not pretend to be a ClosedRoute: before recurrence we
do not yet know a defensible period, closure, family or topology. This module
therefore extracts only ordered geometric evidence from the observed portion of
the trajectory. It does not make a binary candidate decision yet; thresholds
will be calibrated against the simulator/GT bank before lifecycle integration.

Missing network slots remain explicit gaps. No segment is drawn through a gap
for either metrics or diagnostic geometry.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import math
from typing import Iterable

import numpy as np

from .models import CanonicalPoint, VehicleSample
from .vector_sample_adapter import build_vector_track


_EPS = 1e-12


@dataclass(frozen=True, slots=True)
class PartialRouteEvidence:
    """Evidence that can exist before one complete route recurrence.

    `turn_fraction` is accumulated absolute change of tangent divided by 2π.
    It is topology-neutral: a Figure-8 may change turn sign while still
    accumulating substantial absolute turning.

    `turn_sign_persistence` measures whether meaningful curvature keeps its sign
    over adjacent heading changes. It does not require one global CW/CCW sign:
    a Figure-8 may change sign between lobes while still having long coherent
    runs. Random GPS meander tends to alternate sign much more frequently.

    `path_efficiency` is robust spatial extent / observed travelled distance.
    A straight approach tends toward one; a path that bends around an area falls
    below one. It is evidence only, not an acceptance gate.

    `observed_runs` keeps communication gaps explicit. Each inner tuple is one
    contiguous observed run; consumers must never connect separate runs as if a
    position had been observed through the outage.
    """

    stream_key: tuple[int, int]
    window_start_utc: datetime
    window_end_utc: datetime
    source_sample_count: int
    observed_grid_count: int
    observed_travel_m: float
    turn_fraction: float
    smooth_heading_fraction: float
    turn_sign_persistence: float
    path_efficiency: float
    contiguous_observation_fraction: float
    observed_runs: tuple[tuple[CanonicalPoint, ...], ...]

    def __post_init__(self) -> None:
        for name in (
            "turn_fraction",
            "smooth_heading_fraction",
            "turn_sign_persistence",
            "path_efficiency",
            "contiguous_observation_fraction",
        ):
            value = float(getattr(self, name))
            if not math.isfinite(value) or value < 0.0:
                raise ValueError(f"{name} must be finite and non-negative")
        for name in (
            "smooth_heading_fraction",
            "turn_sign_persistence",
            "contiguous_observation_fraction",
        ):
            if not 0.0 <= float(getattr(self, name)) <= 1.0:
                raise ValueError(f"{name} must be in [0,1]")
        if self.observed_travel_m <= 0.0:
            raise ValueError("observed_travel_m must be positive")
        if not self.observed_runs or any(len(run) < 2 for run in self.observed_runs):
            raise ValueError("observed_runs must contain non-empty contiguous paths")


def _contiguous_runs(mask: np.ndarray) -> tuple[np.ndarray, ...]:
    indices = np.flatnonzero(mask)
    if len(indices) == 0:
        return ()
    split = np.flatnonzero(np.diff(indices) > 1) + 1
    return tuple(run for run in np.split(indices, split) if len(run) > 0)


def _resample_open(points: np.ndarray, count: int) -> np.ndarray:
    points = np.asarray(points, dtype=float)
    if len(points) < 2:
        return points.copy()
    segment = np.linalg.norm(np.diff(points, axis=0), axis=1)
    keep = np.concatenate(([True], segment > _EPS))
    points = points[keep]
    if len(points) < 2:
        return points.copy()
    segment = np.linalg.norm(np.diff(points, axis=0), axis=1)
    distance = np.concatenate(([0.0], np.cumsum(segment)))
    if distance[-1] <= _EPS:
        return points[:1].copy()
    count = max(2, min(int(count), 32))
    target = np.linspace(0.0, distance[-1], count)
    return np.column_stack(
        (
            np.interp(target, distance, points[:, 0]),
            np.interp(target, distance, points[:, 1]),
        )
    )


def _wrapped_angle_delta(first: np.ndarray, second: np.ndarray) -> np.ndarray:
    return (second - first + np.pi) % (2.0 * np.pi) - np.pi


def _run_metrics(points: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    """Return observed travel, signed heading changes and bounded display path."""

    if len(points) < 2:
        return 0.0, np.zeros(0, dtype=float), points.copy()
    raw_travel = float(np.sum(np.linalg.norm(np.diff(points, axis=0), axis=1)))
    if raw_travel <= _EPS:
        return 0.0, np.zeros(0, dtype=float), points[:1].copy()

    # Equal-arc resampling makes heading evidence much less sensitive to a
    # 1s/2s/5s navigation cadence. This interpolation occurs only inside one
    # contiguous observed run; it never bridges a network outage.
    count = min(32, max(8, int(round(math.sqrt(len(points)) * 2.0))))
    sampled = _resample_open(points, count)
    if len(sampled) < 4:
        return raw_travel, np.zeros(0, dtype=float), sampled

    # A two-segment chord suppresses one-sample GPS zig-zag.
    chord = sampled[2:] - sampled[:-2]
    chord_length = np.linalg.norm(chord, axis=1)
    chord = chord[chord_length > _EPS]
    if len(chord) < 2:
        return raw_travel, np.zeros(0, dtype=float), sampled
    heading = np.arctan2(chord[:, 1], chord[:, 0])
    signed_turn = _wrapped_angle_delta(heading[:-1], heading[1:])
    return raw_travel, signed_turn, sampled


def extract_partial_route_evidence(
    samples: Iterable[VehicleSample],
    *,
    grid_seconds: float | None = None,
) -> PartialRouteEvidence | None:
    """Extract early ordered-route evidence without asserting a closed route."""

    materialized = tuple(samples)
    prepared = build_vector_track(materialized, grid_seconds=grid_seconds)
    if prepared is None:
        return None

    runs = _contiguous_runs(prepared.track.observed_mask)
    usable = tuple(run for run in runs if len(run) >= 3)
    if not usable:
        return None

    total_travel = 0.0
    total_turn = 0.0
    heading_turn_count = 0
    smooth_turn_count = 0
    persistent_sign_pairs = 0
    meaningful_sign_pairs = 0
    diagnostic_runs: list[tuple[CanonicalPoint, ...]] = []

    for run in usable:
        travel, signed_turn, sampled = _run_metrics(prepared.track.xy_m[run])
        total_travel += travel
        if len(signed_turn):
            turn = np.abs(signed_turn)
            # One spike may not contribute an arbitrary amount of apparent
            # coverage. The cap is a numerical robustness guard, not a vehicle
            # dynamics or route-shape limit.
            capped = np.minimum(turn, math.radians(75.0))
            total_turn += float(np.sum(capped))
            heading_turn_count += len(turn)
            smooth_turn_count += int(np.count_nonzero(turn <= math.radians(45.0)))

            # Ignore tiny sign changes dominated by measurement noise. The
            # threshold is a numerical evidence filter, not a route curvature
            # limit. Persistence is computed inside each observed run only.
            meaningful = signed_turn[turn >= math.radians(3.0)]
            if len(meaningful) >= 2:
                signs = np.sign(meaningful)
                meaningful_sign_pairs += len(signs) - 1
                persistent_sign_pairs += int(np.count_nonzero(signs[:-1] == signs[1:]))
        if len(sampled) >= 2:
            diagnostic_runs.append(
                tuple(
                    CanonicalPoint(float(point[0]), float(point[1]))
                    for point in sampled
                )
            )

    if total_travel <= _EPS or heading_turn_count < 2 or not diagnostic_runs:
        return None

    observed_points = prepared.track.xy_m[prepared.track.observed_mask]
    if len(observed_points) < 3:
        return None
    low = np.quantile(observed_points, 0.05, axis=0)
    high = np.quantile(observed_points, 0.95, axis=0)
    robust_extent = float(np.linalg.norm(high - low))
    path_efficiency = robust_extent / max(total_travel, _EPS)

    longest_run = max(len(run) for run in runs)
    contiguous_fraction = longest_run / max(prepared.observed_grid_count, 1)
    sign_persistence = (
        persistent_sign_pairs / meaningful_sign_pairs
        if meaningful_sign_pairs > 0
        else 0.0
    )

    ordered_valid = sorted(
        (
            sample
            for sample in materialized
            if sample.active is not False
            and sample.latitude_deg is not None
            and sample.longitude_deg is not None
            and sample.reliability > 0.0
        ),
        key=lambda sample: sample.sample_time_utc,
    )
    if len(ordered_valid) < 3:
        return None

    return PartialRouteEvidence(
        stream_key=ordered_valid[0].stream_key,
        window_start_utc=ordered_valid[0].sample_time_utc,
        window_end_utc=ordered_valid[-1].sample_time_utc,
        source_sample_count=prepared.source_sample_count,
        observed_grid_count=prepared.observed_grid_count,
        observed_travel_m=total_travel,
        turn_fraction=total_turn / (2.0 * math.pi),
        smooth_heading_fraction=smooth_turn_count / heading_turn_count,
        turn_sign_persistence=sign_persistence,
        path_efficiency=path_efficiency,
        contiguous_observation_fraction=contiguous_fraction,
        observed_runs=tuple(diagnostic_runs),
    )
