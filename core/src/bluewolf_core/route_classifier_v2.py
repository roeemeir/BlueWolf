"""Spec-conformant route topology classification over folded vector evidence.

Source of truth: core/docs/ROUTE_GEOMETRY_SPEC_HE.md.

The classifier does not encode the simulator's preferred Double-Hippodrome
10..40 degree QA sweep as a product rule. Double opening is fitted as a
continuous geometry parameter; coarse/fine search values are numerical solver
steps only and never acceptance gates.
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
    """Count proper crossings whose two segments are directly observed.

    Unsupported interpolated phase bins are never allowed to manufacture a
    Figure-8 crossing.
    """

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
    q = p[:, None, :]
    s = r[:, None, :]

    # Pairwise segment equations p_i + t*r_i = p_j + u*r_j.
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
    upper = np.triu(np.ones_like(proper, dtype=bool), k=1)
    proper &= ~adjacent & upper

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
    """Vectorized distances from P points to a closed M-segment polyline."""

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


def _align_template(template: np.ndarray, data_points: np.ndarray) -> np.ndarray:
    t_center, t_vectors, t_half = robust_axis_frame(template)
    d_center, d_vectors, d_half = robust_axis_frame(data_points)
    scale_ratios = d_half / np.maximum(t_half, _EPS)
    scale = float(np.median(scale_ratios))
    coordinates = (template - t_center) @ t_vectors

    candidates: list[np.ndarray] = []
    # PCA signs are arbitrary. Try all sign combinations; this is a fixed four
    # candidate loop independent of sample/history length.
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
) -> _ModelFit:
    aligned = _align_template(template, observed_points)
    distance = _point_to_polyline_distances(observed_points, aligned)
    rms = float(np.sqrt(np.mean(distance * distance)))
    p90 = float(np.quantile(distance, 0.90))
    return _ModelFit(
        rms_m=rms,
        p90_m=p90,
        normalized_rms=rms / max(short_scale_m, 1.0),
        metadata=metadata,
    )


@lru_cache(maxsize=256)
def _single_template(axis_ratio_bucket: float) -> np.ndarray:
    ratio = max(float(axis_ratio_bucket), 1.0)
    radius = 1.0
    half_straight = max(ratio - 1.0, 0.0)
    line = LineString(((-half_straight, 0.0), (half_straight, 0.0)))
    polygon = line.buffer(radius, cap_style=1, join_style=1, quad_segs=48)
    return _resample_closed(np.asarray(polygon.exterior.coords, dtype=float)[:-1])


@lru_cache(maxsize=4096)
def _double_template(opening_deg: float, radius_ratio: float) -> np.ndarray:
    """Normalized union-of-capsules Double Hippodrome template."""

    half_opening = math.radians(float(opening_deg) / 2.0)
    shared = np.array((0.0, 0.0), dtype=float)
    left = np.array((-math.sin(half_opening), math.cos(half_opening)), dtype=float)
    right = np.array((math.sin(half_opening), math.cos(half_opening)), dtype=float)
    radius = float(radius_ratio)
    first = LineString((tuple(shared), tuple(left))).buffer(
        radius, cap_style=1, join_style=1, quad_segs=32
    )
    second = LineString((tuple(shared), tuple(right))).buffer(
        radius, cap_style=1, join_style=1, quad_segs=32
    )
    polygon = unary_union((first, second))
    return _resample_closed(np.asarray(polygon.exterior.coords, dtype=float)[:-1])


def _fit_single_hippodrome(points: np.ndarray, axis_ratio: float, short_scale_m: float) -> _ModelFit:
    candidates = np.unique(
        np.clip(
            np.array((axis_ratio * 0.80, axis_ratio, axis_ratio * 1.20)),
            1.01,
            20.0,
        )
    )
    fits = [
        _fit_template(
            points,
            _single_template(round(float(candidate), 2)),
            short_scale_m,
            {"axis_ratio_model": float(candidate)},
        )
        for candidate in candidates
    ]
    return min(fits, key=lambda fit: fit.rms_m)


def _fit_double_hippodrome(points: np.ndarray, short_scale_m: float) -> _ModelFit:
    """Coarse-to-fine fit with no 10..40 degree acceptance rule.

    Opening search spans the complete undirected angle domain. Radius ratio is a
    numerical scale parameter searched logarithmically over a broad positive
    range; neither grid is a product constraint and the final acceptance uses
    residual/model separation only.
    """

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

    fine_angles = np.arange(max(0.0, best_angle - 10.0), min(180.0, best_angle + 10.0) + 0.1, 2.0)
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
    if not polygon.is_valid or polygon.area <= _EPS:
        return 0.0
    hull = polygon.convex_hull
    return float(polygon.area / max(hull.area, _EPS))


def classify_route(
    track: VectorTrack,
    evidence: FoldedRouteEvidence,
    *,
    si_axis_ratio_max: float = 1.5,
) -> RouteClassification:
    """Classify only the geometries approved in ROUTE_GEOMETRY_SPEC_HE.md."""

    periodic_points = track.xy_m[evidence.periodic_mask]
    if len(periodic_points) < 6:
        raise ValueError("classification requires periodic support")
    short_scale = float(np.min(evidence.half_axes_m))
    axis_ratio = evidence.axis_ratio
    crossings, crossing_angle = supported_self_crossings(
        evidence.canonical_xy_m,
        evidence.canonical_support,
    )
    concavity = _polygon_concavity_ratio(evidence.canonical_xy_m)

    base_quality = float(
        np.clip(
            0.45 * evidence.period.score
            + 0.55 * evidence.canonical_support_fraction,
            0.0,
            1.0,
        )
    )

    if crossings > 0:
        confidence = float(np.clip(base_quality + 0.12, 0.0, 1.0))
        return RouteClassification(
            family=RouteFamily.SO,
            subtype=RouteSubtype.FIGURE_EIGHT,
            topology=RouteTopology.SELF_CROSSING,
            confidence=confidence,
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
            },
        )

    single_fit = _fit_single_hippodrome(periodic_points, max(axis_ratio, 1.01), short_scale)
    double_fit = _fit_double_hippodrome(periodic_points, short_scale)
    double_improvement = (single_fit.rms_m - double_fit.rms_m) / max(single_fit.rms_m, 1.0)

    # Double is accepted by direct model evidence, not by an opening-angle gate.
    double_absolute_ok = double_fit.normalized_rms <= 0.24
    double_separated = double_improvement >= 0.08
    if double_absolute_ok and double_separated:
        confidence = float(
            np.clip(base_quality + min(0.25, max(0.0, double_improvement)), 0.0, 1.0)
        )
        diagnostics: dict[str, float | int | bool | str] = {
            "single_rms_m": single_fit.rms_m,
            "double_rms_m": double_fit.rms_m,
            "double_normalized_rms": double_fit.normalized_rms,
            "double_improvement": double_improvement,
            "concavity_ratio": concavity,
            "period_score": evidence.period.score,
            "support_fraction": evidence.canonical_support_fraction,
        }
        diagnostics.update(double_fit.metadata)
        return RouteClassification(
            family=RouteFamily.SO,
            subtype=RouteSubtype.DOUBLE_HIPPODROME,
            topology=RouteTopology.DOUBLE,
            confidence=confidence,
            axis_ratio=axis_ratio,
            period_s=evidence.period.period_s,
            canonical_xy_m=evidence.canonical_xy_m,
            canonical_support=evidence.canonical_support,
            diagnostics=diagnostics,
        )

    if axis_ratio <= si_axis_ratio_max:
        return RouteClassification(
            family=RouteFamily.SI,
            subtype=RouteSubtype.COMPACT,
            topology=RouteTopology.SIMPLE,
            confidence=base_quality,
            axis_ratio=axis_ratio,
            period_s=evidence.period.period_s,
            canonical_xy_m=evidence.canonical_xy_m,
            canonical_support=evidence.canonical_support,
            diagnostics={
                "single_rms_m": single_fit.rms_m,
                "double_rms_m": double_fit.rms_m,
                "double_improvement": double_improvement,
                "concavity_ratio": concavity,
                "period_score": evidence.period.score,
                "support_fraction": evidence.canonical_support_fraction,
            },
        )

    # An elongated route is not automatically a hippodrome. Require the capsule
    # model to explain the periodic observations within the same relative scale.
    if single_fit.normalized_rms <= 0.24:
        confidence = float(np.clip(base_quality + 0.08, 0.0, 1.0))
        return RouteClassification(
            family=RouteFamily.SO,
            subtype=RouteSubtype.HIPPODROME,
            topology=RouteTopology.SIMPLE,
            confidence=confidence,
            axis_ratio=axis_ratio,
            period_s=evidence.period.period_s,
            canonical_xy_m=evidence.canonical_xy_m,
            canonical_support=evidence.canonical_support,
            diagnostics={
                "single_rms_m": single_fit.rms_m,
                "single_normalized_rms": single_fit.normalized_rms,
                "double_rms_m": double_fit.rms_m,
                "double_improvement": double_improvement,
                "concavity_ratio": concavity,
                "period_score": evidence.period.score,
                "support_fraction": evidence.canonical_support_fraction,
            },
        )

    return RouteClassification(
        family=RouteFamily.FREE,
        subtype=RouteSubtype.UNKNOWN,
        topology=RouteTopology.SIMPLE,
        confidence=base_quality * 0.6,
        axis_ratio=axis_ratio,
        period_s=evidence.period.period_s,
        canonical_xy_m=evidence.canonical_xy_m,
        canonical_support=evidence.canonical_support,
        diagnostics={
            "single_rms_m": single_fit.rms_m,
            "single_normalized_rms": single_fit.normalized_rms,
            "double_rms_m": double_fit.rms_m,
            "double_normalized_rms": double_fit.normalized_rms,
            "double_improvement": double_improvement,
            "concavity_ratio": concavity,
            "period_score": evidence.period.score,
            "support_fraction": evidence.canonical_support_fraction,
        },
    )
