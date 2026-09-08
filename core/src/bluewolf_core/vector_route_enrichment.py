"""Post-detection enrichment for hierarchical route geometry.

The vector detector remains authoritative for route acquisition/classification.
This layer only attaches geometry that is needed by later synchronization
semantics once a supported hierarchical route has already been identified.
"""
from __future__ import annotations

from dataclasses import replace
from typing import Iterable

import numpy as np

from .config import DetectionConfig
from .double_lobe_geometry import derive_double_hippodrome_components
from .models import RouteSubtype, VehicleSample
from .route_detection import RouteDetection
from .vector_route_detection import detect_closed_route_vector


def _route_xy(route) -> np.ndarray:
    return np.asarray(
        [(point.x_m, point.y_m) for point in route.canonical_points],
        dtype=float,
    )


def _with_double_components(
    detection: RouteDetection,
) -> RouteDetection:
    if detection.effective.subtype is not RouteSubtype.DOUBLE_HIPPODROME:
        return detection
    if detection.effective.components:
        return detection

    effective_components = derive_double_hippodrome_components(
        _route_xy(detection.effective),
        detection.diagnostics,
    )
    observed_components = derive_double_hippodrome_components(
        _route_xy(detection.observed),
        detection.diagnostics,
    )
    return replace(
        detection,
        effective=replace(detection.effective, components=effective_components),
        observed=replace(detection.observed, components=observed_components),
    )


def detect_closed_route_vector_enriched(
    samples: Iterable[VehicleSample],
    config: DetectionConfig | None = None,
    *,
    require_confirmation: bool = True,
    grid_seconds: float | None = None,
) -> RouteDetection | None:
    """Run V2 detection, then attach approved hierarchical components."""

    detection = detect_closed_route_vector(
        samples,
        config,
        require_confirmation=require_confirmation,
        grid_seconds=grid_seconds,
    )
    if detection is None:
        return None
    return _with_double_components(detection)
