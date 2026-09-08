"""Adapter from the vector route-discovery core to the existing ClosedRoute API.

This module is intentionally side-by-side with route_detection.py until V2 has
passed lifecycle equivalence tests. It must not change CoreSession behavior yet.

Conformance sources:
- core/docs/ROUTE_GEOMETRY_SPEC_HE.md
- core/docs/ADAPTIVE_ROUTE_LIFECYCLE_HE.md
"""
from __future__ import annotations

import math
from typing import Iterable

import numpy as np

from .config import DetectionConfig
from .geometry import local_m_to_wgs84
from .models import CanonicalPoint, ClosedRoute, Direction, RouteFamily, RouteTopology, VehicleSample
from .route_classifier_v2 import RouteClassification, classify_route
from .route_detection import RouteDetection
from .vector_sample_adapter import PreparedVectorTrack, build_vector_track
from .vector_trajectory import FoldedRouteEvidence, VectorTrack, extract_periodic_evidence, robust_axis_frame


_EPS = 1e-12


def _closed_length(points: np.ndarray) -> float:
    return float(np.sum(np.linalg.norm(np.roll(points, -1, axis=0) - points, axis=1)))


def _polyline_distances(points: np.ndarray, canonical: np.ndarray) -> np.ndarray:
    """Vectorized point-to-closed-polyline distances."""

    points = np.asarray(points, dtype=float)
    start = np.asarray(canonical, dtype=float)
    end = np.roll(start, -1, axis=0)
    direction = end - start
    denominator = np.sum(direction * direction, axis=1)
    offset = points[:, None, :] - start[None, :, :]
    fraction = np.divide(
        np.sum(offset * direction[None, :, :], axis=2),
        denominator[None, :],
        out=np.zeros((len(points), len(start)), dtype=float),
        where=denominator[None, :] > _EPS,
    )
    fraction = np.clip(fraction, 0.0, 1.0)
    nearest = start[None, :, :] + fraction[:, :, None] * direction[None, :, :]
    squared = np.sum((points[:, None, :] - nearest) ** 2, axis=2)
    return np.sqrt(np.min(squared, axis=1))


def _phase_fold_mean(track: VectorTrack, evidence: FoldedRouteEvidence) -> np.ndarray:
    """Raw/observed phase fold used only for the `observed` route view.

    Effective geometry uses the robust median fold from vector_trajectory. This
    mean fold deliberately retains more noise/spike influence so observed and
    effective remain distinct. Unsupported phase bins fall back to the effective
    hypothesis but remain unsupported in evidence; no confirmation credit is
    created by that fallback.
    """

    bins = len(evidence.canonical_xy_m)
    periodic = evidence.periodic_mask & track.observed_mask
    indices = np.flatnonzero(periodic)
    if len(indices) < 3:
        return evidence.canonical_xy_m.copy()
    phase_origin = track.time_s[indices[0]]
    phase = np.mod((track.time_s - phase_origin) / evidence.period.period_s, 1.0)
    bin_index = np.floor(phase * bins).astype(int) % bins
    result = evidence.canonical_xy_m.copy()
    for index in range(bins):
        selected = periodic & (bin_index == index)
        if np.any(selected):
            result[index] = np.mean(track.xy_m[selected], axis=0)
    return result


def _direction(canonical_absolute: np.ndarray, topology: RouteTopology) -> Direction:
    # A global CW/CCW sign is not well-defined for a self-crossing Figure-8.
    # Return UNKNOWN rather than inventing a product convention.
    if topology is RouteTopology.SELF_CROSSING:
        return Direction.UNKNOWN
    x = canonical_absolute[:, 0]
    y = canonical_absolute[:, 1]
    signed_twice_area = float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))
    if abs(signed_twice_area) <= 1e-6:
        return Direction.UNKNOWN
    return Direction.COUNTERCLOCKWISE if signed_twice_area > 0 else Direction.CLOCKWISE


def _to_route(
    *,
    route_id: str,
    classification: RouteClassification,
    canonical_absolute: np.ndarray,
    prepared: PreparedVectorTrack,
    period_s: float,
    quality: float,
) -> ClosedRoute:
    center, vectors, half_axes = robust_axis_frame(canonical_absolute)
    center_latitude, center_longitude = local_m_to_wgs84(
        CanonicalPoint(float(center[0]), float(center[1])),
        prepared.origin_latitude_deg,
        prepared.origin_longitude_deg,
    )
    centered = canonical_absolute - center
    canonical_points = tuple(
        CanonicalPoint(float(point[0]), float(point[1])) for point in centered
    )
    long_axis = float(np.max(half_axes))
    short_axis = float(np.min(half_axes))
    long_index = int(np.argmax(half_axes))
    long_vector = vectors[:, long_index]
    orientation = math.degrees(math.atan2(float(long_vector[1]), float(long_vector[0]))) % 180.0
    return ClosedRoute(
        route_id=route_id,
        family=classification.family,
        subtype=classification.subtype,
        topology=classification.topology,
        canonical_points=canonical_points,
        center_latitude_deg=center_latitude,
        center_longitude_deg=center_longitude,
        length_m=_closed_length(canonical_absolute),
        long_axis_a_m=long_axis,
        short_axis_b_m=short_axis,
        orientation_deg=orientation,
        estimated_period_s=period_s,
        direction=_direction(canonical_absolute, classification.topology),
        detection_quality=float(np.clip(quality, 0.0, 1.0)),
    )


def detect_closed_route_vector(
    samples: Iterable[VehicleSample],
    config: DetectionConfig | None = None,
    *,
    require_confirmation: bool = True,
    grid_seconds: float | None = None,
) -> RouteDetection | None:
    """Detect an approved closed route using the vector V2 pipeline.

    This first implementation intentionally requires periodic evidence for both
    candidate and confirmation. A faster *partial-cycle candidate* path is a
    separate milestone; it will not be faked with a timer or by reusing the old
    ellipse/stadium assumption.
    """

    detection = config or DetectionConfig()
    materialized = tuple(samples)
    prepared = build_vector_track(materialized, grid_seconds=grid_seconds)
    if prepared is None:
        return None
    evidence = extract_periodic_evidence(
        prepared.track,
        minimum_period_s=max(2.0 * prepared.grid_seconds, 20.0),
        canonical_bins=min(detection.canonical_point_limit, 64),
    )
    if evidence is None:
        return None
    classification = classify_route(
        prepared.track,
        evidence,
        si_axis_ratio_max=detection.si_axis_ratio_max,
    )

    periodic_points = prepared.track.xy_m[evidence.periodic_mask]
    if len(periodic_points) < 6:
        return None
    effective_canonical = evidence.canonical_xy_m
    short_axis = max(float(np.min(evidence.half_axes_m)), 1.0)
    tolerance_m = max(
        1.0,
        short_axis * detection.closure_distance_short_axis_ratio,
    )
    residual = _polyline_distances(periodic_points, effective_canonical)
    fitted = residual <= tolerance_m
    fit_fraction = float(np.mean(fitted))
    inlier_fraction = fit_fraction
    coverage_fraction = evidence.canonical_support_fraction

    periodic_indices = np.flatnonzero(evidence.periodic_mask)
    if len(periodic_indices) < 2:
        return None
    periodic_span_s = float(
        prepared.track.time_s[periodic_indices[-1]] - prepared.track.time_s[periodic_indices[0]]
    )
    completed_cycles = max(0.0, periodic_span_s / max(evidence.period.period_s, _EPS))

    # Recurrence one period apart is the V2 closure evidence. It remains valid
    # when the physical turn itself is missing from the network.
    minimum_recurrence_pairs = max(
        8,
        int(math.ceil(0.05 * prepared.observed_grid_count)),
    )
    closure_ok = evidence.period.support_pairs >= minimum_recurrence_pairs

    # V1's 82% confirmation coverage assumed a detector that had to observe
    # nearly the complete fitted path. V2 explicitly supports a different
    # operational case: the network may lose almost every sample in both turns.
    # Missing turn bins remain unobserved and reduce quality, but do not veto
    # strong recurrent evidence. The topology classifier already contains the
    # model-specific acceptance gates; its confidence is a quality signal, not
    # a second binary threshold in the contract adapter.
    recognized_route = classification.family is not RouteFamily.FREE
    candidate_ready = (
        recognized_route
        and fit_fraction + _EPS >= detection.candidate_fit_fraction
        and coverage_fraction + _EPS >= detection.candidate_coverage_fraction
        and completed_cycles + _EPS >= detection.candidate_travel_fraction
        and closure_ok
    )
    confirmation_ready = (
        recognized_route
        and fit_fraction + _EPS >= detection.required_fit_fraction
        and coverage_fraction + _EPS >= detection.candidate_coverage_fraction
        and completed_cycles + _EPS >= detection.required_completed_cycles
        and closure_ok
    )
    if require_confirmation and not confirmation_ready:
        return None
    if not require_confirmation and not candidate_ready:
        return None

    quality = float(
        np.clip(
            0.30 * classification.confidence
            + 0.25 * fit_fraction
            + 0.25 * coverage_fraction
            + 0.20 * evidence.period.score,
            0.0,
            1.0,
        )
    )

    ordered_valid = sorted(
        (
            sample
            for sample in materialized
            if sample.latitude_deg is not None and sample.longitude_deg is not None
        ),
        key=lambda sample: sample.sample_time_utc,
    )
    if not ordered_valid:
        return None
    server_id, vehicle_identifier = ordered_valid[0].stream_key
    prefix = f"{server_id}:{vehicle_identifier}"
    observed_canonical = _phase_fold_mean(prepared.track, evidence)
    observed = _to_route(
        route_id=f"{prefix}:observed:v2",
        classification=classification,
        canonical_absolute=observed_canonical,
        prepared=prepared,
        period_s=evidence.period.period_s,
        quality=fit_fraction,
    )
    effective = _to_route(
        route_id=f"{prefix}:effective:v2",
        classification=classification,
        canonical_absolute=effective_canonical,
        prepared=prepared,
        period_s=evidence.period.period_s,
        quality=quality,
    )

    return RouteDetection(
        observed=observed,
        effective=effective,
        fit_fraction=fit_fraction,
        inlier_fraction=inlier_fraction,
        coverage_fraction=coverage_fraction,
        completed_cycles=completed_cycles,
        outlier_count=int(np.count_nonzero(~fitted)),
        diagnostics={
            "detector": "vector_v2",
            "candidate_ready": candidate_ready,
            "confirmation_ready": confirmation_ready,
            "recognized_route": recognized_route,
            "classification_confidence": classification.confidence,
            "closure_ok": closure_ok,
            "period_score": evidence.period.score,
            "period_support_pairs": evidence.period.support_pairs,
            "canonical_support_fraction": coverage_fraction,
            "grid_seconds": prepared.grid_seconds,
            "source_sample_count": prepared.source_sample_count,
            "observed_grid_count": prepared.observed_grid_count,
            "family": classification.family.value,
            "subtype": classification.subtype.value,
            "topology": classification.topology.value,
            **dict(classification.diagnostics),
        },
    )
