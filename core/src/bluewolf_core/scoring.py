"""Pure deterministic score calculations."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable

from .config import ErrorBand, ScoringConfig
from .models import (
    ComponentScores,
    GroupScores,
    PrimitiveMetrics,
    RouteFamily,
    VehicleScores,
)


def score_error(error: float, band: ErrorBand) -> float:
    """Map a non-negative error to [0, 100] using the approved flat/linear/zero law."""
    if error < 0:
        raise ValueError("error must be non-negative")
    if error <= band.full_score_through:
        return 100.0
    if error >= band.zero_score_from:
        return 0.0
    span = band.zero_score_from - band.full_score_through
    return 100.0 * (band.zero_score_from - error) / span


def _weighted_available(values: tuple[float | None, ...], weights: tuple[float, ...]) -> float:
    available = [(value, weight) for value, weight in zip(values, weights, strict=True) if value is not None]
    total_weight = sum(weight for _, weight in available)
    if total_weight <= 0:
        raise ValueError("no scored component is available")
    return sum(float(value) * weight for value, weight in available) / total_weight


def _primary_reason(
    metrics: PrimitiveMetrics,
    components: ComponentScores,
    config: ScoringConfig,
) -> str | None:
    sync_weights = config.sync_weights.normalized()
    route_weights = config.route_weights.normalized()
    total_weights = config.total_weights.normalized()
    losses: list[tuple[float, str]] = [
        (
            (100.0 - components.sync_position) * sync_weights[0] * total_weights[0],
            metrics.position_reason,
        ),
        ((100.0 - components.sync_period) * sync_weights[1] * total_weights[0], "period"),
        ((100.0 - components.sync_movement) * sync_weights[2] * total_weights[0], "movement"),
        ((100.0 - components.route_distance) * route_weights[0] * total_weights[1], "distance"),
    ]
    if components.route_tangent is not None:
        losses.append(
            ((100.0 - components.route_tangent) * route_weights[1] * total_weights[1], "tangent")
        )
    if components.route_curvature is not None:
        losses.append(
            (
                (100.0 - components.route_curvature) * route_weights[2] * total_weights[1],
                "curvature",
            )
        )
    loss, reason = max(losses, key=lambda item: item[0])
    return reason if loss > 0 else None


def score_vehicle(metrics: PrimitiveMetrics, config: ScoringConfig | None = None) -> VehicleScores:
    """Calculate the three required scores for one vehicle in a synchronization group."""
    config = config or ScoringConfig()
    if metrics.active is not True:
        return VehicleScores(False, None, None, None, None, "inactive", metrics.reliability)
    if metrics.reliability < config.minimum_valid_reliability:
        return VehicleScores(False, None, None, None, None, "low_reliability", metrics.reliability)
    if metrics.family is RouteFamily.FREE:
        return VehicleScores(False, None, None, None, None, "free_route", metrics.reliability)

    position_band = (
        config.si_position_deg if metrics.family is RouteFamily.SI else config.so_position_cycle
    )
    low_speed = metrics.speed_fraction < config.minimum_motion_speed_fraction
    tangent_error = None if low_speed else metrics.tangent_error_deg
    curvature_error = None if low_speed else metrics.curvature_error_ratio

    components = ComponentScores(
        sync_position=score_error(metrics.position_error, position_band),
        sync_period=score_error(metrics.period_error_ratio, config.period_ratio),
        sync_movement=score_error(metrics.movement_error_ratio, config.movement_ratio),
        route_distance=score_error(
            metrics.distance_error_b_ratio, config.distance_short_axis_ratio
        ),
        route_tangent=(
            None if tangent_error is None else score_error(tangent_error, config.tangent_deg)
        ),
        route_curvature=(
            None
            if curvature_error is None
            else score_error(curvature_error, config.curvature_ratio)
        ),
    )

    sync_score = _weighted_available(
        (components.sync_position, components.sync_period, components.sync_movement),
        config.sync_weights.normalized(),
    )
    route_score = _weighted_available(
        (components.route_distance, components.route_tangent, components.route_curvature),
        config.route_weights.normalized(),
    )

    if (
        metrics.family is RouteFamily.SI
        and not low_speed
        and metrics.wrong_direction_seconds >= config.wrong_direction_zero_seconds
    ):
        sync_score = 0.0
        primary_reason = "wrong_direction"
    else:
        primary_reason = _primary_reason(metrics, components, config)

    total_score = _weighted_available(
        (sync_score, route_score), config.total_weights.normalized()
    )
    return VehicleScores(
        valid=True,
        sync=round(sync_score, 6),
        route=round(route_score, 6),
        total=round(total_score, 6),
        components=components,
        primary_reason=primary_reason,
        reliability=metrics.reliability,
    )


def aggregate_group_scores(
    vehicle_scores: Iterable[VehicleScores], minimum_valid_vehicles: int = 2
) -> GroupScores:
    """Derive group scores from vehicle scores; no independent group formula exists."""
    valid = [score for score in vehicle_scores if score.valid]
    if len(valid) < minimum_valid_vehicles:
        return GroupScores(False, None, None, None, len(valid), "insufficient_coverage")
    sync = sum(float(item.sync) for item in valid) / len(valid)
    route = sum(float(item.route) for item in valid) / len(valid)
    total = sum(float(item.total) for item in valid) / len(valid)
    reasons = [item.primary_reason for item in valid if item.primary_reason]
    reason = Counter(reasons).most_common(1)[0][0] if reasons else None
    return GroupScores(
        True,
        round(sync, 6),
        round(route, 6),
        round(total, 6),
        len(valid),
        reason,
    )

