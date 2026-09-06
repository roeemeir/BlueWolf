from __future__ import annotations

from dataclasses import dataclass
from math import atan2, cos, degrees, hypot, radians, sin

KNOTS_PER_MPS = 1.9438444924406


@dataclass(frozen=True)
class WindEstimate:
    north_mps: float
    east_mps: float
    speed_knots: float
    bearing_deg: float
    confidence: float


def _bearing_from_components(north_mps: float, east_mps: float) -> float:
    if abs(north_mps) < 1e-12 and abs(east_mps) < 1e-12:
        return 0.0
    return (degrees(atan2(east_mps, north_mps)) + 360.0) % 360.0


def wind_vector(speed_knots: float, bearing_deg: float) -> tuple[float, float]:
    """Return north/east disturbance components in m/s for a clockwise bearing from north."""
    speed_mps = speed_knots / KNOTS_PER_MPS
    angle = radians(bearing_deg)
    return speed_mps * cos(angle), speed_mps * sin(angle)


def apply_wind(
    expected_north_mps: float,
    expected_east_mps: float,
    speed_knots: float,
    bearing_deg: float,
) -> tuple[float, float]:
    wind_north, wind_east = wind_vector(speed_knots, bearing_deg)
    return expected_north_mps + wind_north, expected_east_mps + wind_east


def estimate_wind_from_navigation(
    expected_speed_mps: float,
    expected_heading_deg: float,
    measured_north_mps: float,
    measured_east_mps: float,
) -> WindEstimate:
    """Estimate horizontal wind/disturbance from navigation residuals.

    Assumption: over the estimation window the nominal commanded/expected speed is
    locally constant.  The residual between the expected velocity vector and the
    measured navigation velocity vector is reported as estimated wind/disturbance.
    This is intentionally labelled an estimate because controller/model errors are
    not separable from true wind using navigation alone.
    """
    heading = radians(expected_heading_deg)
    expected_north = expected_speed_mps * cos(heading)
    expected_east = expected_speed_mps * sin(heading)
    residual_north = measured_north_mps - expected_north
    residual_east = measured_east_mps - expected_east
    residual_speed = hypot(residual_north, residual_east)
    measured_speed = hypot(measured_north_mps, measured_east_mps)
    scale = max(expected_speed_mps, 0.5)
    mismatch = abs(measured_speed - expected_speed_mps) / scale
    confidence = max(0.35, min(0.99, 0.96 - 0.35 * mismatch))
    return WindEstimate(
        north_mps=residual_north,
        east_mps=residual_east,
        speed_knots=residual_speed * KNOTS_PER_MPS,
        bearing_deg=_bearing_from_components(residual_north, residual_east),
        confidence=confidence,
    )
