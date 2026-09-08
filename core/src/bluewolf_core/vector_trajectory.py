"""Vectorized periodic-trajectory primitives for route discovery.

This module is intentionally topology-agnostic. It extracts recurrence,
periodic support, a phase-folded centerline hypothesis and robust spatial axes.
Route-family classification lives in a separate module.

The heavy path is NumPy vectorized. The only small Python loop is over the fixed
canonical phase-bin count (<=128), never over the 40-minute sample history.
"""
from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np


_EPS = 1e-12


@dataclass(frozen=True, slots=True)
class VectorTrack:
    """Uniform-time trajectory with explicit missing-data mask."""

    time_s: np.ndarray
    xy_m: np.ndarray
    observed_mask: np.ndarray
    velocity_xy_mps: np.ndarray | None = None

    def __post_init__(self) -> None:
        time_s = np.asarray(self.time_s, dtype=float)
        xy_m = np.asarray(self.xy_m, dtype=float)
        observed = np.asarray(self.observed_mask, dtype=bool)
        if time_s.ndim != 1:
            raise ValueError("time_s must be one-dimensional")
        if xy_m.shape != (len(time_s), 2):
            raise ValueError("xy_m must have shape (N,2)")
        if observed.shape != (len(time_s),):
            raise ValueError("observed_mask must have shape (N,)")
        if len(time_s) < 3:
            raise ValueError("track requires at least three timestamps")
        if not np.all(np.isfinite(time_s)) or not np.all(np.diff(time_s) > 0):
            raise ValueError("time_s must be finite and strictly increasing")
        if not np.all(np.isfinite(xy_m)):
            raise ValueError("xy_m must remain finite; use observed_mask for missing data")
        if self.velocity_xy_mps is not None:
            velocity = np.asarray(self.velocity_xy_mps, dtype=float)
            if velocity.shape != (len(time_s), 2):
                raise ValueError("velocity_xy_mps must have shape (N,2)")
        dt = np.diff(time_s)
        median_dt = float(np.median(dt))
        if np.max(np.abs(dt - median_dt)) > max(1e-6, 0.05 * median_dt):
            raise ValueError("VectorTrack requires a near-uniform time grid")
        object.__setattr__(self, "time_s", time_s)
        object.__setattr__(self, "xy_m", xy_m)
        object.__setattr__(self, "observed_mask", observed)
        if self.velocity_xy_mps is not None:
            object.__setattr__(self, "velocity_xy_mps", np.asarray(self.velocity_xy_mps, dtype=float))

    @property
    def sample_interval_s(self) -> float:
        return float(np.median(np.diff(self.time_s)))


@dataclass(frozen=True, slots=True)
class PeriodEstimate:
    period_s: float
    lag_samples: int
    recurrence_mse_m2: float
    support_pairs: int
    score: float


@dataclass(frozen=True, slots=True)
class FoldedRouteEvidence:
    period: PeriodEstimate
    periodic_mask: np.ndarray
    canonical_xy_m: np.ndarray
    canonical_support: np.ndarray
    canonical_counts: np.ndarray
    axis_center_m: np.ndarray
    axis_vectors: np.ndarray
    half_axes_m: np.ndarray

    @property
    def canonical_support_fraction(self) -> float:
        return float(np.mean(self.canonical_support))

    @property
    def axis_ratio(self) -> float:
        small = max(float(np.min(self.half_axes_m)), _EPS)
        return float(np.max(self.half_axes_m) / small)


def _fft_cross_correlation(first: np.ndarray, second: np.ndarray, nfft: int) -> np.ndarray:
    return np.fft.irfft(
        np.fft.rfft(first, nfft) * np.conj(np.fft.rfft(second, nfft)),
        nfft,
    )


def masked_lag_mse(track: VectorTrack) -> tuple[np.ndarray, np.ndarray]:
    """Return spatial MSE and observed-pair support for every positive lag.

    For each lag k this computes the mean ||x[i+k]-x[i]||^2 only where both
    samples are observed. Algebraic expansion plus FFT correlations makes the
    full lag sweep O(N log N), rather than an O(N^2) pair-distance matrix.
    """

    xy = track.xy_m
    mask = track.observed_mask.astype(float)
    n = len(mask)
    nfft = 1 << (2 * n - 1).bit_length()

    def corr(a: np.ndarray, b: np.ndarray) -> np.ndarray:
        return _fft_cross_correlation(a, b, nfft)[:n]

    support = corr(mask, mask)
    squared_norm = np.sum(xy * xy, axis=1)
    masked_xy = xy * mask[:, None]
    masked_squared = squared_norm * mask
    dot = corr(masked_xy[:, 0], masked_xy[:, 0]) + corr(
        masked_xy[:, 1], masked_xy[:, 1]
    )
    sse = corr(masked_squared, mask) + corr(mask, masked_squared) - 2.0 * dot
    # FFT roundoff can make exact zero slightly negative.
    sse = np.maximum(sse, 0.0)
    mse = np.divide(
        sse,
        support,
        out=np.full(n, np.inf, dtype=float),
        where=support > 0.5,
    )
    return mse, support


def _local_minima(values: np.ndarray, indices: np.ndarray) -> np.ndarray:
    if len(indices) == 0:
        return indices
    before = values[np.maximum(indices - 1, 0)]
    after = values[np.minimum(indices + 1, len(values) - 1)]
    return indices[(values[indices] <= before) & (values[indices] <= after)]


def estimate_period(
    track: VectorTrack,
    *,
    minimum_period_s: float = 20.0,
    maximum_period_s: float | None = None,
    minimum_pair_support: int = 8,
    minimum_pair_support_fraction: float = 0.05,
    strong_minimum_ratio: float = 1.35,
) -> PeriodEstimate | None:
    """Estimate the smallest well-supported spatial recurrence period.

    The estimator does not require turn observations. If turns disappear from
    the network but straight/curved legs repeat one cycle later, those repeated
    samples still create a deep recurrence minimum.
    """

    dt = track.sample_interval_s
    mse, support = masked_lag_mse(track)
    n = len(track.time_s)
    min_lag = max(2, int(math.ceil(minimum_period_s / dt)))
    if maximum_period_s is None:
        max_lag = min(n - 2, int(math.floor(0.80 * (n - 1))))
    else:
        max_lag = min(n - 2, int(math.floor(maximum_period_s / dt)))
    if max_lag < min_lag:
        return None

    required_support = max(
        minimum_pair_support,
        int(math.ceil(minimum_pair_support_fraction * np.count_nonzero(track.observed_mask))),
    )
    indices = np.arange(min_lag, max_lag + 1, dtype=int)
    valid = indices[support[indices] >= required_support]
    if len(valid) == 0:
        return None
    local = _local_minima(mse, valid)
    if len(local) == 0:
        local = valid

    best_mse = float(np.min(mse[local]))
    strong = local[mse[local] <= best_mse * strong_minimum_ratio + 1e-6]
    lag = int(np.min(strong))

    # Recurrence quality is normalized by the robust spatial variance. A lower
    # MSE produces a score closer to one without using a route-type assumption.
    observed_xy = track.xy_m[track.observed_mask]
    spatial_variance = float(np.sum(np.var(observed_xy, axis=0))) if len(observed_xy) else 0.0
    score = 1.0 / (1.0 + float(mse[lag]) / max(spatial_variance, 1.0))
    return PeriodEstimate(
        period_s=lag * dt,
        lag_samples=lag,
        recurrence_mse_m2=float(mse[lag]),
        support_pairs=int(round(float(support[lag]))),
        score=float(np.clip(score, 0.0, 1.0)),
    )


def robust_axis_frame(points: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return center, principal vectors and robust half extents."""

    points = np.asarray(points, dtype=float)
    if points.ndim != 2 or points.shape[1] != 2 or len(points) < 3:
        raise ValueError("points must have shape (N,2), N>=3")
    center = np.median(points, axis=0)
    centered = points - center
    covariance = centered.T @ centered / max(len(points) - 1, 1)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    order = np.argsort(eigenvalues)[::-1]
    vectors = eigenvectors[:, order]
    projected = centered @ vectors
    low = np.quantile(projected, 0.02, axis=0)
    high = np.quantile(projected, 0.98, axis=0)
    half_axes = np.maximum((high - low) / 2.0, _EPS)
    return center, vectors, half_axes


def periodic_support_mask(
    track: VectorTrack,
    period: PeriodEstimate,
    *,
    spatial_tolerance_fraction: float = 0.12,
    minimum_spatial_tolerance_m: float = 6.0,
) -> np.ndarray:
    """Mark samples that have a spatially consistent counterpart one period away."""

    lag = period.lag_samples
    n = len(track.time_s)
    output = np.zeros(n, dtype=bool)
    if lag <= 0 or lag >= n:
        return output
    observed_points = track.xy_m[track.observed_mask]
    if len(observed_points) < 3:
        return output
    _, _, half_axes = robust_axis_frame(observed_points)
    tolerance = max(
        minimum_spatial_tolerance_m,
        spatial_tolerance_fraction * float(np.min(half_axes)),
    )
    valid = track.observed_mask[:-lag] & track.observed_mask[lag:]
    distance = np.linalg.norm(track.xy_m[:-lag] - track.xy_m[lag:], axis=1)
    recurrent = valid & (distance <= tolerance)
    output[:-lag] |= recurrent
    output[lag:] |= recurrent
    return output


def _circular_interpolate_bins(values: np.ndarray, support: np.ndarray) -> np.ndarray:
    valid = np.flatnonzero(support)
    if len(valid) < 3:
        raise ValueError("at least three supported phase bins are required")
    bins = len(values)
    index = np.arange(bins, dtype=float)
    extended_index = np.concatenate((valid - bins, valid, valid + bins))
    output = values.copy()
    for dimension in range(2):
        known = values[valid, dimension]
        extended_value = np.concatenate((known, known, known))
        output[:, dimension] = np.interp(index, extended_index, extended_value)
    return output


def fold_periodic_route(
    track: VectorTrack,
    period: PeriodEstimate,
    periodic_mask: np.ndarray,
    *,
    canonical_bins: int = 64,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Fold recurrent samples modulo period into a canonical phase path.

    Unsupported bins are interpolated only to form a geometry *hypothesis*.
    `canonical_support` and `canonical_counts` remain authoritative evidence and
    downstream confirmation must never count interpolated bins as observed.
    """

    if not 16 <= canonical_bins <= 128:
        raise ValueError("canonical_bins must be in [16,128]")
    periodic_mask = np.asarray(periodic_mask, dtype=bool)
    if periodic_mask.shape != track.observed_mask.shape:
        raise ValueError("periodic_mask shape mismatch")
    periodic_mask &= track.observed_mask
    periodic_indices = np.flatnonzero(periodic_mask)
    if len(periodic_indices) < 6:
        raise ValueError("insufficient periodic support")

    phase_origin = track.time_s[periodic_indices[0]]
    phase = np.mod((track.time_s - phase_origin) / period.period_s, 1.0)
    bin_index = np.floor(phase * canonical_bins).astype(int) % canonical_bins
    canonical = np.full((canonical_bins, 2), np.nan, dtype=float)
    counts = np.zeros(canonical_bins, dtype=int)

    # Fixed <=128-bin loop; sample-heavy work remains vectorized.
    for index in range(canonical_bins):
        selected = periodic_mask & (bin_index == index)
        if np.any(selected):
            canonical[index] = np.median(track.xy_m[selected], axis=0)
            counts[index] = int(np.count_nonzero(selected))

    support = counts > 0
    canonical = _circular_interpolate_bins(canonical, support)
    return canonical, support, counts


def extract_periodic_evidence(
    track: VectorTrack,
    *,
    minimum_period_s: float = 20.0,
    maximum_period_s: float | None = None,
    canonical_bins: int = 64,
) -> FoldedRouteEvidence | None:
    period = estimate_period(
        track,
        minimum_period_s=minimum_period_s,
        maximum_period_s=maximum_period_s,
    )
    if period is None:
        return None
    periodic = periodic_support_mask(track, period)
    try:
        canonical, support, counts = fold_periodic_route(
            track,
            period,
            periodic,
            canonical_bins=canonical_bins,
        )
    except ValueError:
        return None
    supported_points = track.xy_m[periodic]
    if len(supported_points) < 3:
        return None
    center, vectors, half_axes = robust_axis_frame(supported_points)
    return FoldedRouteEvidence(
        period=period,
        periodic_mask=periodic,
        canonical_xy_m=canonical,
        canonical_support=support,
        canonical_counts=counts,
        axis_center_m=center,
        axis_vectors=vectors,
        half_axes_m=half_axes,
    )
