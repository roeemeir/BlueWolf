"""Vectorized periodic-trajectory primitives for route discovery.

Source of truth:
- core/docs/ROUTE_GEOMETRY_SPEC_HE.md
- core/docs/ADAPTIVE_ROUTE_LIFECYCLE_HE.md

This module is intentionally topology-agnostic. It extracts recurrence,
periodic support, a phase-folded centerline hypothesis and robust spatial axes.
Route-family classification lives in a separate module.

The sample-heavy path is NumPy vectorized. Small Python loops are bounded by a
fixed phase-bin count or a small local lag-jitter window; no operation builds an
N x N matrix over the 40-minute history.
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
            object.__setattr__(
                self,
                "velocity_xy_mps",
                np.asarray(self.velocity_xy_mps, dtype=float),
            )

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

    The FFT stage is a fast global proposal. It does not require turn samples:
    repeated legs one cycle apart are sufficient evidence for a recurrence
    minimum. A later local refinement makes the exact phase fold robust to the
    few-sample bias caused by approach/exit, wind and missing turns.
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


def _local_lag_radius_samples(track: VectorTrack, period: PeriodEstimate) -> int:
    """Small numerical search radius around the FFT period proposal.

    This is not a timing gate. It only compensates for a few samples of period
    estimation bias before phase folding. The radius is capped so runtime stays
    linear in N with a small constant.
    """

    dt = track.sample_interval_s
    seconds = min(12.0, max(2.0 * dt, 0.04 * period.period_s))
    return max(1, int(math.ceil(seconds / dt)))


def _robust_lag_cost(track: VectorTrack, lag: int) -> tuple[float, int, float]:
    if lag <= 0 or lag >= len(track.time_s):
        return math.inf, 0, math.inf
    valid = track.observed_mask[:-lag] & track.observed_mask[lag:]
    count = int(np.count_nonzero(valid))
    if count < 6:
        return math.inf, count, math.inf
    distance2 = np.sum((track.xy_m[:-lag] - track.xy_m[lag:]) ** 2, axis=1)
    selected = distance2[valid]
    # Route recurrence normally occupies the majority of valid pairs while
    # approach/exit are one-off. Median cost is therefore much less sensitive
    # to non-periodic tails than the global mean used by the FFT proposal.
    cost = float(np.median(selected))
    mse = float(np.mean(selected))
    return cost, count, mse


def refine_period_local(track: VectorTrack, period: PeriodEstimate) -> PeriodEstimate:
    """Refine an FFT proposal within a small local lag window."""

    radius = _local_lag_radius_samples(track, period)
    lo = max(2, period.lag_samples - radius)
    hi = min(len(track.time_s) - 2, period.lag_samples + radius)
    lags = np.arange(lo, hi + 1, dtype=int)
    costs = np.full(len(lags), np.inf, dtype=float)
    counts = np.zeros(len(lags), dtype=int)
    means = np.full(len(lags), np.inf, dtype=float)
    for index, lag in enumerate(lags):
        costs[index], counts[index], means[index] = _robust_lag_cost(track, int(lag))
    if not np.any(np.isfinite(costs)):
        return period
    best_index = int(np.argmin(costs))
    lag = int(lags[best_index])

    observed_xy = track.xy_m[track.observed_mask]
    spatial_variance = float(np.sum(np.var(observed_xy, axis=0))) if len(observed_xy) else 0.0
    robust_recurrence = float(costs[best_index])
    score = 1.0 / (1.0 + robust_recurrence / max(spatial_variance, 1.0))
    return PeriodEstimate(
        period_s=lag * track.sample_interval_s,
        lag_samples=lag,
        recurrence_mse_m2=float(means[best_index]),
        support_pairs=int(counts[best_index]),
        score=float(np.clip(score, 0.0, 1.0)),
    )


def robust_axis_frame(points: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return geometry-centered principal vectors and robust half extents.

    The returned center is the midpoint of the robust spatial envelope in the
    PCA frame, not the sample median. This makes it insensitive to observing a
    non-integer number of cycles or oversampling one phase.
    """

    points = np.asarray(points, dtype=float)
    if points.ndim != 2 or points.shape[1] != 2 or len(points) < 3:
        raise ValueError("points must have shape (N,2), N>=3")
    origin = np.median(points, axis=0)
    centered = points - origin
    covariance = centered.T @ centered / max(len(points) - 1, 1)
    _, eigenvectors = np.linalg.eigh(covariance)
    vectors = eigenvectors[:, ::-1]
    projected = centered @ vectors
    low = np.quantile(projected, 0.02, axis=0)
    high = np.quantile(projected, 0.98, axis=0)
    midpoint = 0.5 * (low + high)
    center = origin + midpoint @ vectors.T
    half_axes = np.maximum(0.5 * (high - low), _EPS)
    return center, vectors, half_axes


def _support_spatial_tolerance(track: VectorTrack) -> float:
    observed_points = track.xy_m[track.observed_mask]
    if len(observed_points) < 3:
        return 8.0
    center = np.median(observed_points, axis=0)
    radial = np.linalg.norm(observed_points - center, axis=1)
    cutoff = float(np.quantile(radial, 0.85))
    core = observed_points[radial <= cutoff]
    if len(core) < 3:
        core = observed_points
    _, _, half_axes = robust_axis_frame(core)
    return max(8.0, 0.16 * float(np.min(half_axes)))


def periodic_support_mask(
    track: VectorTrack,
    period: PeriodEstimate,
    *,
    spatial_tolerance_m: float | None = None,
    heading_tolerance_deg: float | None = 60.0,
) -> np.ndarray:
    """Mark samples with a recurrent counterpart near one period away.

    Spatial proximity remains the primary recurrence evidence. When velocity is
    available at both endpoints, heading must also agree; this prevents a
    one-off approach/exit path that merely crosses the route from being credited
    as periodic motion. Missing velocity never removes otherwise valid spatial
    evidence.

    A single exact lag is intentionally *not* required. Period estimates can be
    biased by a few samples when turns are missing or wind varies. We search a
    small bounded lag neighborhood and OR the recurrent pairs. Missing turn
    samples remain missing; no coordinates are synthesized here.
    """

    n = len(track.time_s)
    output = np.zeros(n, dtype=bool)
    radius = _local_lag_radius_samples(track, period)
    tolerance = _support_spatial_tolerance(track) if spatial_tolerance_m is None else float(
        spatial_tolerance_m
    )
    if heading_tolerance_deg is not None and not 0.0 < heading_tolerance_deg <= 180.0:
        raise ValueError("heading_tolerance_deg must be in (0,180] or None")
    cosine_threshold = (
        math.cos(math.radians(float(heading_tolerance_deg)))
        if heading_tolerance_deg is not None
        else -1.0
    )

    for lag in range(max(2, period.lag_samples - radius), min(n - 1, period.lag_samples + radius) + 1):
        valid = track.observed_mask[:-lag] & track.observed_mask[lag:]
        if not np.any(valid):
            continue
        distance = np.linalg.norm(track.xy_m[:-lag] - track.xy_m[lag:], axis=1)
        recurrent = valid & (distance <= tolerance)

        if track.velocity_xy_mps is not None and heading_tolerance_deg is not None:
            first_velocity = track.velocity_xy_mps[:-lag]
            second_velocity = track.velocity_xy_mps[lag:]
            first_speed = np.linalg.norm(first_velocity, axis=1)
            second_speed = np.linalg.norm(second_velocity, axis=1)
            heading_available = (first_speed > _EPS) & (second_speed > _EPS)
            dot = np.sum(first_velocity * second_velocity, axis=1)
            heading_matches = dot >= (
                cosine_threshold * first_speed * second_speed - _EPS
            )
            recurrent &= (~heading_available) | heading_matches

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

    Unsupported bins are interpolated only to form a geometry hypothesis.
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
    heading_tolerance_deg: float | None = 60.0,
) -> FoldedRouteEvidence | None:
    period = estimate_period(
        track,
        minimum_period_s=minimum_period_s,
        maximum_period_s=maximum_period_s,
    )
    if period is None:
        return None
    period = refine_period_local(track, period)
    periodic = periodic_support_mask(
        track,
        period,
        heading_tolerance_deg=heading_tolerance_deg,
    )
    try:
        canonical, support, counts = fold_periodic_route(
            track,
            period,
            periodic,
            canonical_bins=canonical_bins,
        )
    except ValueError:
        return None

    # Canonical bins are phase-balanced by construction, so their geometry is a
    # better axis estimator than raw recurrent samples whose phase density may
    # be heavily skewed by turn outages or a non-integer number of cycles.
    center, vectors, half_axes = robust_axis_frame(canonical)
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
