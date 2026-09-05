"""Synchronization primitive metrics for Blue Wolf v0.8.

The functions here produce physical/cyclic errors. The existing scorer maps
those errors to 0..100. Keeping metric generation separate from scoring avoids
letting a score influence route grouping.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

from .v08_core import Point2D, Rotation, SoRelation

_EPS = 1e-9


def circular_cycle_distance(a: float, b: float) -> float:
    delta = abs((a - b) % 1.0)
    return min(delta, 1.0 - delta)


def circular_angle_distance_deg(a: float, b: float) -> float:
    delta = abs((a - b) % 360.0)
    return min(delta, 360.0 - delta)


def si_pair_angle_error_deg(actual_angle_deg: float, expected_angle_deg: float) -> float:
    """Smallest error between an observed and template SI pair separation."""
    observed = actual_angle_deg % 360.0
    expected = expected_angle_deg % 360.0
    # Pair separation is undirected: 120 and 240 describe the same pair gap.
    observed = min(observed, 360.0 - observed)
    expected = min(expected, 360.0 - expected)
    return abs(observed - expected)


def si_tangent_error_deg(
    position: Point2D,
    center: Point2D,
    velocity_east: float,
    velocity_north: float,
    rotation: Rotation,
    *,
    minimum_speed: float = 1e-3,
) -> float | None:
    """Velocity-vs-tangent error used to reject radial/self-inconsistent motion.

    This uses translational velocity. Detecting a vehicle rotating in place
    requires an independent heading/yaw source; velocity-derived heading alone
    cannot honestly distinguish stationary spin from no motion.
    """
    speed = math.hypot(velocity_east, velocity_north)
    radius = math.hypot(position.x - center.x, position.y - center.y)
    if speed < minimum_speed or radius < _EPS or rotation is Rotation.UNKNOWN:
        return None
    rx = (position.x - center.x) / radius
    ry = (position.y - center.y) / radius
    if rotation is Rotation.CCW:
        tx, ty = -ry, rx
    else:
        tx, ty = ry, -rx
    dot = max(-1.0, min(1.0, (velocity_east * tx + velocity_north * ty) / speed))
    return math.degrees(math.acos(dot))


def so_relation_phase_error(phase_a: float, phase_b: float, relation: SoRelation) -> float:
    """Return SO relation error as fraction of one cycle."""
    delta = (phase_b - phase_a) % 1.0
    if relation is SoRelation.SAME:
        targets = (0.0,)
    elif relation is SoRelation.OPPOSITE:
        targets = (0.5,)
    else:
        # Mixed represents adjacent quarters of a double entity. Both +/- 1/4
        # are valid because the chain orientation can be mirrored.
        targets = (0.25, 0.75)
    return min(circular_cycle_distance(delta, target) for target in targets)


def double_quarter(phase: float) -> int:
    return int(math.floor((phase % 1.0) * 4.0)) % 4


def double_quarter_relation(phase_a: float, phase_b: float) -> SoRelation:
    """Quarter semantics locked by the product definition.

    Same quarter -> same; opposite quarters -> opposite; adjacent quarters ->
    mixed. Empty quarters are naturally allowed because this function only
    compares observed members.
    """
    qa, qb = double_quarter(phase_a), double_quarter(phase_b)
    difference = (qb - qa) % 4
    if difference == 0:
        return SoRelation.SAME
    if difference == 2:
        return SoRelation.OPPOSITE
    return SoRelation.MIXED


@dataclass(frozen=True, slots=True)
class DoubleSingleEquivalent:
    local_single_phase: float
    half_index: int
    relation_to_first_half: SoRelation


def double_as_single(double_phase: float) -> DoubleSingleEquivalent:
    """Map one double cycle to two single cycles with opposite synchronization."""
    phase = double_phase % 1.0
    if phase < 0.5:
        return DoubleSingleEquivalent(phase * 2.0, 0, SoRelation.SAME)
    return DoubleSingleEquivalent((phase - 0.5) * 2.0, 1, SoRelation.OPPOSITE)


def phase_in_region(phase: float, start: float, end: float) -> bool:
    p, a, b = phase % 1.0, start % 1.0, end % 1.0
    if a <= b:
        return a <= p <= b
    return p >= a or p <= b


def so_turn_weighted_error(
    phase_error: float,
    phase: float,
    turn_regions: Iterable[tuple[float, float]],
    *,
    turn_multiplier: float = 1.5,
) -> float:
    """Emphasize SO near/far turn timing without introducing a new score weight."""
    if phase_error < 0:
        raise ValueError("phase_error must be non-negative")
    if turn_multiplier < 1.0:
        raise ValueError("turn_multiplier must be >= 1")
    in_turn = any(phase_in_region(phase, start, end) for start, end in turn_regions)
    return min(0.5, phase_error * (turn_multiplier if in_turn else 1.0))
