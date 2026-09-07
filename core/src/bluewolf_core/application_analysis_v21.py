"""Blue Wolf application analysis v2.1 topology hardening.

A Figure-8 is a structural crossed-leg hippodrome, not merely any sampled
polyline containing an incidental self-intersection. Repeated noisy passes of a
Single or articulated Double can create tiny segment crossings even though the
physical route is not self-crossing. This refinement combines the intersection
classifier with signed-area evidence before accepting Figure-8 topology.

The module remains pure: no UI, DB, HTTP, filesystem or simulator-GT access.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from . import application_analysis_v18 as _v18
from . import application_analysis_v20 as _v20
from .v08_core import Point2D, RouteShape, classify_route

_base = _v18._base
_FIGURE8_MAX_NORMALIZED_AREA = 0.012


def _normalized_signed_area(samples: Sequence[Mapping[str, Any]]) -> float:
    if len(samples) < 3:
        return 1.0
    points = [_v18._xy(sample) for sample in samples]
    twice_area = 0.0
    length = 0.0
    for index, first in enumerate(points):
        second = points[(index + 1) % len(points)]
        twice_area += first[0] * second[1] - second[0] * first[1]
        dx = second[0] - first[0]
        dy = second[1] - first[1]
        length += (dx * dx + dy * dy) ** 0.5
    if length <= 1e-9:
        return 1.0
    return abs(twice_area) * 0.5 / (length * length)


def _topology_kind_v21(samples: Sequence[Mapping[str, Any]], fit: Any) -> str:
    aspect = fit.major_span / max(1.0, fit.minor_span)
    if aspect < 1.32:
        return "circle"

    cycle = _v18._representative_cycle(samples, fit)
    if len(cycle) < 20:
        return _base._estimate_kind(samples, fit)

    speed = _base._mean_speed(cycle)
    length = _v18._closed_length(cycle)
    rough_period = length / speed if speed > 0.15 and length > 1.0 else 120.0
    try:
        descriptor = classify_route(
            (Point2D(*_v18._xy(sample)) for sample in cycle),
            max(1.0, rough_period),
        )
    except (ValueError, ZeroDivisionError):
        return _base._estimate_kind(samples, fit)

    if descriptor.shape is RouteShape.FIGURE_EIGHT:
        # A real crossed-leg hippodrome has two oppositely oriented lobes, so
        # their signed areas substantially cancel. A normal Single/Double loop
        # keeps material enclosed signed area even if noisy repeated samples
        # produce one or more incidental segment intersections.
        if _normalized_signed_area(cycle) <= _FIGURE8_MAX_NORMALIZED_AREA:
            return "figure8"
        if descriptor.waist_ratio < 0.70:
            return "double"
        return _base._estimate_kind(samples, fit)
    if descriptor.shape is RouteShape.DOUBLE_HIPPODROME:
        return "double"
    if descriptor.shape is RouteShape.HIPPODROME:
        return "single"
    if descriptor.shape is RouteShape.COMPACT:
        return "circle"
    return _base._estimate_kind(samples, fit)


# The stable v1.8 envelope performs topology lookup through its own module
# globals. Patch only that pure primitive; public contracts and persistence do
# not change.
_v18._topology_kind = _topology_kind_v21

CORE_API_VERSION = _v20.CORE_API_VERSION
analyze_navigation_dataset = _v20.analyze_navigation_dataset
build_analysis_history = _v20.build_analysis_history
derive_events = _v20.derive_events
compare_membership = _v20.compare_membership
provenance_from_samples = _v20.provenance_from_samples
so_pair_compatibility = _v20.so_pair_compatibility

__all__ = [
    "CORE_API_VERSION",
    "analyze_navigation_dataset",
    "build_analysis_history",
    "derive_events",
    "compare_membership",
    "provenance_from_samples",
    "so_pair_compatibility",
]
