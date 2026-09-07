"""Sparse-Live guard for canonical route detection.

The topology classifier requires at least 20 trajectory points. A legitimate
Live source can cover the configured 60-second candidate interval with fewer
points (for example a 5-second sampling cadence). In that state the correct
answer is "not enough evidence yet", not an exception.

This wrapper changes no successful route-detection result. It only converts the
specific minimum-point classifier error into ``None`` and leaves every other
validation error untouched.
"""

from __future__ import annotations

from typing import Iterable

from .config import DetectionConfig
from .models import VehicleSample
from .route_detection import RouteDetection, detect_closed_route as _detect_closed_route
from . import session as _session


def detect_closed_route_live_safe(
    samples: Iterable[VehicleSample],
    config: DetectionConfig | None = None,
) -> RouteDetection | None:
    try:
        return _detect_closed_route(samples, config)
    except ValueError as exc:
        if "at least 20 route points are required" in str(exc):
            return None
        raise


# CoreSession resolves this module-global function at runtime, so the guard
# applies to streaming route lifecycle without modifying the stable detector.
_session.detect_closed_route = detect_closed_route_live_safe

__all__ = ["detect_closed_route_live_safe"]
