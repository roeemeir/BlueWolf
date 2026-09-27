"""Spec-conformant route topology classification over folded vector evidence.

Source of truth: core/docs/ROUTE_GEOMETRY_SPEC_HE.md.

Important distinction:
- simulator QA samples Double-Hippodrome openings densely around 10..40 deg;
- the classifier has NO 10..40 acceptance gate;
- fitted opening is a continuous geometry parameter and model evidence decides.

The classifier consumes phase-balanced recurrence evidence. Model fitting may
also use real observed samples inside the recurrent time span so incomplete
phase support does not turn an otherwise complete traversal into interpolated
pseudo-topology. No missing coordinate is ever synthesized for that evidence.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import math
from types import MappingProxyType
from typing import Mapping

import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

from .models import RouteFamily, RouteSubtype, RouteTopology
from .vector_trajectory import FoldedRouteEvidence, VectorTrack, robust_axis_frame


_EPS = 1e-12

# Initial calibration values, not physical/product laws. Changes must be
# validated against the simulation sweep before merge.
_SINGLE_MAX_NORMALIZED_RMS = 0.24
_SPARSE_SINGLE_MAX_NORMALIZED_RMS = 0.40
_SPARSE_SINGLE_MAX_SUPPORT_FRACTION = 0.75
_DOUBLE_MAX_NORMALIZED_RMS = 0.24
_DOUBLE_MIN_MODEL_IMPROVEMENT = 0.25
_DOUBLE_MIN_ORDERED_MODEL_IMPROVEMENT = 0.35
_STRONG_DOUBLE_CONCAVITY_RATIO = 0.94
_STRONG_DOUBLE_MODEL_IMPROVEMENT = 0.45
_COMPACT_DOUBLE_MAX_CONCAVITY_RATIO = 0.97
_COMPACT_DOUBLE_MIN_MODEL_IMPROVEMENT = 0.55


@dataclass(frozen=True, slots=True)
class RouteClassification:
    family: RouteFamily
    subtype: RouteSubtype
    topology: RouteTopology
    confidence: float
    axis_ratio: float
    period_s: float
    canonical_xy_m: np.ndarray
    canonical_support: np.ndarray
    diagnostics: Mapping[str, float | int | bool | str]

    def __post_init__(self) -> None:
        object.__setattr__(self, "diagnostics", MappingProxyType(dict(self.diagnostics)))
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be in [0,1]")


@dataclass(frozen=True, slots=True)
class _ModelFit:
    rms_m: float
    p90_m: float
    normalized_rms: float
    metadata: Mapping[str, float]


def _cross2(first: np.ndarray, second: np.ndarray) -> np.ndarray:
    return first[..., 0] * second[..., 1] - first[..., 1] * second[..., 0]


def supported_self_crossings(
    canonical_xy_m: np.ndarray,
    support: np.ndarray,
    *,
    minimum_crossing_angle_deg: float = 20.0,
) -> tuple[int, float]:
    """Count proper crossings whose two segments are directly observed."""

    points = np.asarray(canonical_xy_m, dtype=float)
    support = np.asarray(support, dtype=bool)
    n = len(points)
    if points.shape != (n, 2) or support.shape != (n,) or n < 8:
        return 0, 0.0

    start = points
    end = np.roll(points, -1, axis=0)
    segment_supported = support & np.roll(support, -1)
    indices = np.flatnonzero(segment_supported)
    if len(indices) < 4:
        return 0, 0.0

    p = start[indices]
    r = end[indices] - start[indices]
    p_i = p[:, None, :]
    p_j = p[None, :, :]
    r_i = r[:, None, :]
    r_j = r[None, :, :]
    denominator = _cross2(r_i, r_j)
    delta = p_j - p_i
    t = np.divide(
        _cross2(delta, r_j),
        denominator,
        out=np.full_like(denominator, np.nan, dtype=float),
        where=np.abs(denominator) > _EPS,
    )
    u = np.divide(
        _cross2(delta, r_i),
        denominator,
        out=np.full_like(denominator, np.nan, dtype=float),
        where=np.abs(denominator) > _EPS,
    )

    proper = (t > 1e-4) & (t < 1.0 - 1e-4) & (u > 1e-4) & (u < 1.0 - 1e-4)
    original_i = indices[:, None]
    original_j = indices[None, :]
    separation = np.abs(original_i - original_j)
    adjacent = (separation <= 1) | (separation >= n - 1)
    proper &= ~adjacent & np.triu(np.ones_like(proper, dtype=bool), k=1)

    norm_i = np.linalg.norm(r_i, axis=2)
    norm_j = np.linalg.norm(r_j, axis=2)
    cosine = np.divide(
        np.abs(np.sum(r_i * r_j, axis=2)),
        norm_i * norm_j,
        out=np.ones_like(denominator),
        where=(norm_i * norm_j) > _EPS,
    )
    acute_angle = np.degrees(np.arccos(np.clip(cosine, 0.0, 1.0)))
    proper &= acute_angle >= minimum_crossing_angle_deg

    count = int(np.count_nonzero(proper))
    max_angle = float(np.max(acute_angle[proper])) if count else 0.0
    return count, max_angle


def _resample_closed(points: np.ndarray, count: int = 64) -> np.ndarray:
    points = np.asarray(points, dtype=float)
    if not np.allclose(points[0], points[-1]):
        points = np.vstack((points, points[0]))
    delta = np.diff(points, axis=0)
    ds = np.linalg.norm(delta, axis=1)
    s = np.concatenate(([0.0], np.cumsum(ds)))
    target = np.linspace(0.0, s[-1], count, endpoint=False)
    return np.column_stack(
        (np.interp(target, s, points[:, 0]), np.interp(target, s, points[:, 1]))
    )


def _point_to_polyline_distances(points: np.ndarray, polyline: np.ndarray) -> np.ndarray:
    points = np.asarray(points, dtype=float)
    start = np.asarray(polyline, dtype=float)
    end = np.roll(start, -1, axis=0)
    direction = end - start
    denom = np.sum(direction * direction, axis=1)
    offset = points[:, None, :] - start[None, :, :]
    fraction = np.divide(
        np.sum(offset * direction[None, :, :], axis=2),
        denom[None, :],
        out=np.zeros((len(points), len(start)), dtype=float),
        where=denom[None, :] > _EPS,
    )
    fraction = np.clip(fraction, 0.0, 1.0)
    nearest = start[None, :, :] + fraction[:, :, None] * direction[None, :, :]
    squared = np.sum((points[:, None, :] - nearest) ** 2, axis=2)
    return np.sqrt(np.min(squared, axis=1))


def _align_template(
    template: np.ndarray,
    data_points: np.ndarray,
    *,
    scale_mode: str = "median",
) -> np.ndarray:
    t_center, t_vectors, t_half = robust_axis_frame(template)
    d_center, d_vectors, d_half = robust_axis_frame(data_points)
    ratio = d_half / np.maximum(t_half, _EPS)
    if scale_mode == "median":
        scale = float(np.median(ratio))
    elif scale_mode == "short_axis":
        scale = float(np.min(d_half) / max(float(np.min(t_half)), _EPS))
    else:
        raise ValueError(f"unsupported scale_mode: {scale_mode}")
    coordinates = (template - t_center) @ t_vectors

    candidates: list[np.ndarray] = []
    for first_sign in (-1.0, 1.0):
        for second_sign in (-1.0, 1.0):
            basis = d_vectors * np.array((first_sign, second_sign))[None, :]
            candidates.append(coordinates @ basis.T * scale + d_center)

    residual = [
        float(np.mean(_point_to_polyline_distances(data_points, candidate) ** 2))
        for candidate in candidates
    ]
    return candidates[int(np.argmin(residual))]


def _fit_template(
    observed_points: np.ndarray,
    template: np.ndarray,
    short_scale_m: float,
    metadata: Mapping[str, float],
    *,
    scale_mode: str = "median",
) -> _ModelFit:
    aligned = _align_template(template, observed_points, scale_mode=scale_mode)
    distance = _point_to_polyline_distances(observed_points, aligned)
    rms = float(np.sqrt(np.mean(distance * distance)))
    p90 = float(np.quantile(distance, 0.90))
    return _ModelFit(
        rms_m=rms,
        p90_m=p90,
        normalized_rms=rms / max(short_scale_m, 1.0),
        metadata=metadata,
    )


def _ordered_phase_rms(
    canonical_xy_m: np.ndarray,
    support: np.ndarray,
    template: np.ndarray,
    observed_points: np.ndarray,
    *,
    scale_mode: str = "median",
) -> float:
    canonical = np.asarray(canonical_xy_m, dtype=float)
    support = np.asarray(support, dtype=bool)
    if canonical.ndim != 2 or canonical.shape[1] != 2:
        raise ValueError("canonical_xy_m must have shape (N,2)")
    if support.shape != (len(canonical),):
        raise ValueError("support must match canonical bins")
    if np.count_nonzero(support) < 3:
        return math.inf

    sampled_template = _resample_closed(np.asarray(template, dtype=float), len(canonical))
    aligned = _align_template(sampled_template, observed_points, scale_mode=scale_mode)
    best = math.inf
    for ordered in (aligned, aligned[::-1]):
        for shift in range(len(canonical)):
            shifted = np.roll(ordered, shift, axis=0)
            delta = canonical[support] - shifted[support]
            rms = float(np.sqrt(np.mean(np.sum(delta * delta, axis=1))))
            if rms < best:
                best = rms
    return best


@lru_cache(maxsize=256)
def _single_template(axis_ratio_bucket: float) -> np.ndarray:
    ratio = max(float(axis_ratio_bucket), 1.0)
    radius = 1.0
    half_straight = max(ratio - 1.0, 0.0)
    polygon = LineString(((-half_straight, 0.0), (half_straight, 0.0))).buffer(
        radius,
        cap_style=1,
        join_style=1,
        quad_segs=48,
    )
    return _resample_closed(np.asarray(polygon.exterior.coords, dtype=float)[:-1])


@lru_cache(maxsize=4096)
def _double_template(opening_deg: float, radius_ratio: float) -> np.ndarray:
    half_opening = math.radians(float(opening_deg) / 2.0)
    shared = np.array((0.0, 0.0), dtype=float)
    left = np.array((-math.sin(half_opening), math.cos(half_opening)), dtype=float)
    right = np.array((math.sin(half_opening), math.cos(half_opening)), dtype=float)
    radius = float(radius_ratio)
    first = LineString((tuple(shared), tuple(left))).buffer(
        radius,
        cap_style=1,
        join_style=1,
        quad_segs=32,
    )
    second = LineString((tuple(shared), tuple(right))).buffer(
        radius,
        cap_style=1,
        join_style=1,
        quad_segs=32,
    )
    polygon = unary_union((first, second))
    return _resample_closed(np.asarray(polygon.exterior.coords, dtype=float)[:-1])


def _fit_single_hippodrome(
    points: np.ndarray,
    axis_ratio: float,
    short_scale_m: float,
) -> _ModelFit:
    ratio_factors = np.array((0.50, 0.70, 1.00, 1.40, 2.00), dtype=float)
    candidates = np.unique(np.clip(axis_ratio * ratio_factors, 1.01, 20.0))
    fits: list[_ModelFit] = []
    for candidate in candidates:
        template = _single_template(round(float(candidate), 2))
        for scale_mode, short_axis_alignment in (("median", 0.0), ("short_axis", 1.0)):
            fits.append(
                _fit_template(
                    points,
                    template,
                    short_scale_m,
                    {
                        "axis_ratio_model": float(candidate),
                        "single_short_axis_alignment": short_axis_alignment,
                    },
                    scale_mode=scale_mode,
                )
            )
    return min(fits, key=lambda fit: fit.rms_m)


def _fit_double_hippodrome(points: np.ndarray, short_scale_m: float) -> _ModelFit:
    coarse_angles = np.arange(0.0, 180.0, 10.0)
    coarse_radius = np.exp(np.linspace(math.log(0.04), math.log(1.5), 8))
    best: _ModelFit | None = None
    best_angle = 0.0
    best_radius = 0.25
    for angle in coarse_angles:
        for radius in coarse_radius:
            fit = _fit_template(
                points,
                _double_template(round(float(angle), 3), round(float(radius), 4)),
                short_scale_m,
                {"opening_deg": float(angle), "radius_ratio": float(radius)},
            )
            if best is None or fit.rms_m < best.rms_m:
                best = fit
                best_angle = float(angle)
                best_radius = float(radius)
    assert best is not None

    fine_angles = np.arange(
        max(0.0, best_angle - 10.0),
        min(180.0, best_angle + 10.0) + 0.1,
        2.0,
    )
    radius_factors = np.exp(np.linspace(math.log(0.65), math.log(1.55), 5))
    for angle in fine_angles:
        for radius in best_radius * radius_factors:
            fit = _fit_template(
                points,
                _double_template(round(float(angle), 3), round(float(radius), 4)),
                short_scale_m,
                {"opening_deg": float(angle), "radius_ratio": float(radius)},
            )
            if fit.rms_m < best.rms_m:
                best = fit
    return best


def _polygon_concavity_ratio(canonical: np.ndarray) -> float:
    polygon = Polygon(canonical)
    # Invalid geometry is absence of usable concavity evidence, not evidence of
    # maximal concavity. Returning 0 here used to promote partial/noisy SI traces
    # to Double through the strong-concavity fallback.
    if not polygon.is_valid or polygon.area <= _EPS:
        return 1.0
    return float(polygon.area / max(polygon.convex_hull.area, _EPS))


def _observed_recurrent_span(
    track: VectorTrack,
    evidence: FoldedRouteEvidence,
) -> tuple[np.ndarray, np.ndarray]:
    """Return real observations inside the recurrent envelope and one cycle.

    Recurrence support marks only samples having a counterpart roughly one
    period away. With ~1.5 cycles that can cover only half the phase bins even
    though the vehicle actually traversed a complete route between the first
    and last recurrent samples. Those intermediate samples are real evidence and
    are therefore valid for model fitting; they are not allowed to add closure
    credit or canonical support.
    """

    recurrent = np.flatnonzero(evidence.periodic_mask & track.observed_mask)
    if len(recurrent) < 2:
        return np.empty((0, 2), dtype=float), np.empty((0, 2), dtype=float)

    first = int(recurrent[0])
    last = int(recurrent[-1])
    span_mask = track.observed_mask.copy()
    span_mask[:first] = False
    span_mask[last + 1 :] = False
    span_points = track.xy_m[span_mask]

    cycle_end_time = track.time_s[first] + evidence.period.period_s
    cycle_mask = (
        track.observed_mask
        & (track.time_s >= track.time_s[first])
        & (track.time_s <= cycle_end_time + 0.5 * track.sample_interval_s)
    )
    cycle_points = track.xy_m[cycle_mask]
    return span_points, cycle_points


def _phase_direction(points_major: np.ndarray, side_mask: np.ndarray) -> tuple[float, int]:
    adjacent = side_mask & np.roll(side_mask, -1)
    indices = np.flatnonzero(adjacent)
    if len(indices) == 0:
        return 0.0, 0
    delta = np.roll(points_major, -1) - points_major
    selected = delta[indices]
    selected = selected[np.abs(selected) > 1e-6]
    if len(selected) == 0:
        return 0.0, 0
    return float(np.median(selected)), int(len(selected))


def _sparse_two_leg_evidence(evidence: FoldedRouteEvidence) -> dict[str, float | int | bool]:
    """Identify the two recurrent straight legs when turn samples are absent."""

    canonical = evidence.canonical_xy_m
    support = evidence.canonical_support
    coordinates = (canonical - evidence.axis_center_m) @ evidence.axis_vectors
    major_index = int(np.argmax(evidence.half_axes_m))
    minor_index = int(np.argmin(evidence.half_axes_m))
    major = coordinates[:, major_index]
    minor = coordinates[:, minor_index]
    long_half = max(float(evidence.half_axes_m[major_index]), 1.0)
    short_half = max(float(evidence.half_axes_m[minor_index]), 1.0)

    outer = np.abs(minor) >= 0.35 * short_half
    positive = support & outer & (minor > 0.0)
    negative = support & outer & (minor < 0.0)

    def side_metrics(mask: np.ndarray) -> tuple[int, float, float, float]:
        values_major = major[mask]
        values_minor = minor[mask]
        count = int(len(values_major))
        if count < 2:
            return count, 0.0, math.inf, 0.0
        span = float(np.quantile(values_major, 0.90) - np.quantile(values_major, 0.10))
        span_fraction = span / max(2.0 * long_half, 1.0)
        lateral_iqr = float(np.quantile(values_minor, 0.75) - np.quantile(values_minor, 0.25))
        flatness = lateral_iqr / short_half
        offset = abs(float(np.median(values_minor))) / short_half
        return count, span_fraction, flatness, offset

    pos_count, pos_span, pos_flatness, pos_offset = side_metrics(positive)
    neg_count, neg_span, neg_flatness, neg_offset = side_metrics(negative)
    pos_median = float(np.median(minor[positive])) if pos_count else 0.0
    neg_median = float(np.median(minor[negative])) if neg_count else 0.0
    symmetry = abs(pos_median + neg_median) / max(abs(pos_median) + abs(neg_median), 1.0)
    pos_direction, pos_pairs = _phase_direction(major, positive)
    neg_direction, neg_pairs = _phase_direction(major, negative)
    opposite_progression = (
        pos_pairs >= 2
        and neg_pairs >= 2
        and pos_direction * neg_direction < 0.0
    )

    passed = (
        pos_count >= 4
        and neg_count >= 4
        and min(pos_span, neg_span) >= 0.25
        and max(pos_flatness, neg_flatness) <= 0.45
        and min(pos_offset, neg_offset) >= 0.45
        and symmetry <= 0.45
        and opposite_progression
    )
    return {
        "sparse_two_leg_evidence": passed,
        "positive_leg_bins": pos_count,
        "negative_leg_bins": neg_count,
        "positive_leg_span_fraction": pos_span,
        "negative_leg_span_fraction": neg_span,
        "positive_leg_flatness": pos_flatness,
        "negative_leg_flatness": neg_flatness,
        "positive_leg_offset": pos_offset,
        "negative_leg_offset": neg_offset,
        "leg_symmetry_error": symmetry,
        "positive_leg_phase_pairs": pos_pairs,
        "negative_leg_phase_pairs": neg_pairs,
        "opposite_leg_progression": opposite_progression,
    }


def _base_diagnostics(
    evidence: FoldedRouteEvidence,
    *,
    single_fit: _ModelFit | None = None,
    double_fit: _ModelFit | None = None,
    double_improvement: float | None = None,
    concavity: float,
    model_span_point_count: int = 0,
    model_axis_ratio: float | None = None,
    observed_cycle_point_count: int = 0,
) -> dict[str, float | int | bool | str]:
    diagnostics: dict[str, float | int | bool | str] = {
        "concavity_ratio": concavity,
        "period_score": evidence.period.score,
        "support_fraction": evidence.canonical_support_fraction,
        "model_span_point_count": model_span_point_count,
        "observed_cycle_point_count": observed_cycle_point_count,
    }
    if model_axis_ratio is not None:
        diagnostics["model_axis_ratio"] = model_axis_ratio
    if single_fit is not None:
        diagnostics.update(
            {
                "single_rms_m": single_fit.rms_m,
                "single_normalized_rms": single_fit.normalized_rms,
            }
        )
        diagnostics.update(single_fit.metadata)
    if double_fit is not None:
        diagnostics.update(
            {
                "double_rms_m": double_fit.rms_m,
                "double_normalized_rms": double_fit.normalized_rms,
            }
        )
        diagnostics.update(double_fit.metadata)
    if double_improvement is not None:
        diagnostics["double_improvement"] = double_improvement
    return diagnostics


def classify_route(
    track: VectorTrack,
    evidence: FoldedRouteEvidence,
    *,
    si_axis_ratio_max: float = 1.5,
) -> RouteClassification:
    recurrent_span_points, observed_cycle_points = _observed_recurrent_span(track, evidence)
    model_points = recurrent_span_points
    if len(model_points) < 6:
        model_points = evidence.canonical_xy_m[evidence.canonical_support]
    if len(model_points) < 6:
        model_points = track.xy_m[evidence.periodic_mask]
    if len(model_points) < 6:
        raise ValueError("classification requires periodic support")

    _, _, model_half_axes = robust_axis_frame(model_points)
    short_scale = max(float(np.min(model_half_axes)), 1.0)
    model_axis_ratio = float(np.max(model_half_axes) / max(np.min(model_half_axes), _EPS))
    axis_ratio = model_axis_ratio

    crossings, crossing_angle = supported_self_crossings(
        evidence.canonical_xy_m,
        evidence.canonical_support,
    )
    concavity_points = (
        observed_cycle_points if len(observed_cycle_points) >= 6 else evidence.canonical_xy_m
    )
    concavity = _polygon_concavity_ratio(concavity_points)
    base_quality = float(
        np.clip(
            0.45 * evidence.period.score + 0.55 * evidence.canonical_support_fraction,
            0.0,
            1.0,
        )
    )

    if crossings > 0:
        return RouteClassification(
            family=RouteFamily.SO,
            subtype=RouteSubtype.FIGURE_EIGHT,
            topology=RouteTopology.SELF_CROSSING,
            confidence=float(np.clip(base_quality + 0.12, 0.0, 1.0)),
            axis_ratio=axis_ratio,
            period_s=evidence.period.period_s,
            canonical_xy_m=evidence.canonical_xy_m,
            canonical_support=evidence.canonical_support,
            diagnostics={
                "supported_crossings": crossings,
                "crossing_angle_deg": crossing_angle,
                "concavity_ratio": concavity,
                "period_score": evidence.period.score,
                "support_fraction": evidence.canonical_support_fraction,
                "model_span_point_count": len(model_points),
                "observed_cycle_point_count": len(observed_cycle_points),
                "model_axis_ratio": model_axis_ratio,
            },
        )

    single_fit = _fit_single_hippodrome(model_points, max(axis_ratio, 1.01), short_scale)
    double_fit = _fit_double_hippodrome(model_points, short_scale)
    double_improvement = (single_fit.rms_m - double_fit.rms_m) / max(single_fit.rms_m, 1.0)

    single_ratio = float(single_fit.metadata["axis_ratio_model"])
    single_scale_mode = (
        "short_axis"
        if float(single_fit.metadata.get("single_short_axis_alignment", 0.0)) >= 0.5
        else "median"
    )
    single_ordered_rms = _ordered_phase_rms(
        evidence.canonical_xy_m,
        evidence.canonical_support,
        _single_template(round(single_ratio, 2)),
        model_points,
        scale_mode=single_scale_mode,
    )
    double_opening = float(double_fit.metadata["opening_deg"])
    double_radius = float(double_fit.metadata["radius_ratio"])
    double_ordered_rms = _ordered_phase_rms(
        evidence.canonical_xy_m,
        evidence.canonical_support,
        _double_template(round(double_opening, 3), round(double_radius, 4)),
        model_points,
    )
    ordered_improvement = (single_ordered_rms - double_ordered_rms) / max(single_ordered_rms, 1.0)
    single_fit = _ModelFit(
        single_fit.rms_m,
        single_fit.p90_m,
        single_fit.normalized_rms,
        {
            **dict(single_fit.metadata),
            "single_ordered_rms_m": single_ordered_rms,
            "single_ordered_normalized_rms": single_ordered_rms / max(short_scale, 1.0),
        },
    )
    double_fit = _ModelFit(
        double_fit.rms_m,
        double_fit.p90_m,
        double_fit.normalized_rms,
        {
            **dict(double_fit.metadata),
            "double_ordered_rms_m": double_ordered_rms,
            "double_ordered_normalized_rms": double_ordered_rms / max(short_scale, 1.0),
            "ordered_model_improvement": ordered_improvement,
        },
    )

    double_absolute_ok = double_fit.normalized_rms <= _DOUBLE_MAX_NORMALIZED_RMS
    double_separated = double_improvement >= _DOUBLE_MIN_MODEL_IMPROVEMENT
    double_ordered_separated = ordered_improvement >= _DOUBLE_MIN_ORDERED_MODEL_IMPROVEMENT
    strong_double_shape_evidence = (
        concavity <= _STRONG_DOUBLE_CONCAVITY_RATIO
        and double_improvement >= _STRONG_DOUBLE_MODEL_IMPROVEMENT
    )
    double_evidence_ok = double_ordered_separated or strong_double_shape_evidence
    compact = axis_ratio <= si_axis_ratio_max
    compact_double_mild_concavity = (
        concavity <= _COMPACT_DOUBLE_MAX_CONCAVITY_RATIO
        and double_improvement >= _COMPACT_DOUBLE_MIN_MODEL_IMPROVEMENT
    )
    compact_double_topology = strong_double_shape_evidence or compact_double_mild_concavity
    double_topology_ok = (not compact) or compact_double_topology

    common_diag = {
        "model_span_point_count": len(model_points),
        "model_axis_ratio": model_axis_ratio,
        "observed_cycle_point_count": len(observed_cycle_points),
    }

    if double_absolute_ok and double_separated and double_evidence_ok and double_topology_ok:
        diagnostics = _base_diagnostics(
            evidence,
            single_fit=single_fit,
            double_fit=double_fit,
            double_improvement=double_improvement,
            concavity=concavity,
            **common_diag,
        )
        diagnostics["ordered_gate_passed"] = double_ordered_separated
        diagnostics["strong_double_shape_evidence"] = strong_double_shape_evidence
        diagnostics["compact_double_topology"] = compact_double_topology
        return RouteClassification(
            family=RouteFamily.SO,
            subtype=RouteSubtype.DOUBLE_HIPPODROME,
            topology=RouteTopology.DOUBLE,
            confidence=float(
                np.clip(base_quality + min(0.25, max(0.0, double_improvement)), 0.0, 1.0)
            ),
            axis_ratio=axis_ratio,
            period_s=evidence.period.period_s,
            canonical_xy_m=evidence.canonical_xy_m,
            canonical_support=evidence.canonical_support,
            diagnostics=diagnostics,
        )

    if compact:
        return RouteClassification(
            family=RouteFamily.SI,
            subtype=RouteSubtype.COMPACT,
            topology=RouteTopology.SIMPLE,
            confidence=base_quality,
            axis_ratio=axis_ratio,
            period_s=evidence.period.period_s,
            canonical_xy_m=evidence.canonical_xy_m,
            canonical_support=evidence.canonical_support,
            diagnostics=_base_diagnostics(
                evidence,
                single_fit=single_fit,
                double_fit=double_fit,
                double_improvement=double_improvement,
                concavity=concavity,
                **common_diag,
            ),
        )

    single_fit_ok = single_fit.normalized_rms <= _SINGLE_MAX_NORMALIZED_RMS
    sparse_leg_diagnostics = _sparse_two_leg_evidence(evidence)
    sparse_single_ok = (
        evidence.canonical_support_fraction <= _SPARSE_SINGLE_MAX_SUPPORT_FRACTION
        and single_fit.normalized_rms <= _SPARSE_SINGLE_MAX_NORMALIZED_RMS
        and ordered_improvement < 0.20
        and bool(sparse_leg_diagnostics["sparse_two_leg_evidence"])
    )
    if single_fit_ok or sparse_single_ok:
        diagnostics = _base_diagnostics(
            evidence,
            single_fit=single_fit,
            double_fit=double_fit,
            double_improvement=double_improvement,
            concavity=concavity,
            **common_diag,
        )
        diagnostics.update(sparse_leg_diagnostics)
        diagnostics["sparse_single_fallback"] = sparse_single_ok
        return RouteClassification(
            family=RouteFamily.SO,
            subtype=RouteSubtype.HIPPODROME,
            topology=RouteTopology.SIMPLE,
            confidence=float(np.clip(base_quality + (0.04 if sparse_single_ok else 0.08), 0.0, 1.0)),
            axis_ratio=axis_ratio,
            period_s=evidence.period.period_s,
            canonical_xy_m=evidence.canonical_xy_m,
            canonical_support=evidence.canonical_support,
            diagnostics=diagnostics,
        )

    diagnostics = _base_diagnostics(
        evidence,
        single_fit=single_fit,
        double_fit=double_fit,
        double_improvement=double_improvement,
        concavity=concavity,
        **common_diag,
    )
    diagnostics.update(sparse_leg_diagnostics)
    return RouteClassification(
        family=RouteFamily.FREE,
        subtype=RouteSubtype.UNKNOWN,
        topology=RouteTopology.SIMPLE,
        confidence=base_quality * 0.6,
        axis_ratio=axis_ratio,
        period_s=evidence.period.period_s,
        canonical_xy_m=evidence.canonical_xy_m,
        canonical_support=evidence.canonical_support,
        diagnostics=diagnostics,
    )
