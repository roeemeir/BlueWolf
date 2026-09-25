"""Spec-conformant vectorized trajectory simulator for Blue Wolf.

Source of truth:
- core/docs/ROUTE_GEOMETRY_SPEC_HE.md
- core/docs/ADAPTIVE_ROUTE_LIFECYCLE_HE.md

This module generates geometry and data-quality failure modes only. It is not a
vehicle-dynamics model and must not encode detector priors as geometry limits.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import math
from typing import Mapping

import numpy as np
from shapely.geometry import LineString
from shapely.ops import unary_union


# QA sampling priorities only. These are explicitly NOT detector/product limits.
DOUBLE_HIPPODROME_PRIORITY_OPENINGS_DEG = (10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0)
DOUBLE_HIPPODROME_EDGE_OPENINGS_DEG = (5.0, 50.0, 60.0)


class RouteShape(StrEnum):
    SI_CIRCLE = "si_circle"
    SI_OCTAGON = "si_octagon"
    SI_FREE_CLOSED = "si_free_closed"
    SO_HIPPODROME = "so_hippodrome"
    SO_FIGURE_EIGHT = "so_figure_eight"
    SO_DOUBLE_HIPPODROME = "so_double_hippodrome"


class SegmentKind(StrEnum):
    APPROACH = "approach"
    ROUTE = "route"
    EXIT = "exit"


@dataclass(frozen=True, slots=True)
class WindConfig:
    max_speed_mps: float = 0.0
    response_gain_s: float = 0.0
    knot_seconds: float = 45.0


@dataclass(frozen=True, slots=True)
class NetworkLossConfig:
    base_dropout_probability: float = 0.0
    turn_dropout_probability: float = 0.0
    turn_burst_count: int = 0
    turn_burst_half_width_fraction: float = 0.035


@dataclass(frozen=True, slots=True)
class NoiseConfig:
    gps_std_m: float = 0.0
    spike_probability: float = 0.0
    spike_std_m: float = 20.0


@dataclass(frozen=True, slots=True)
class SimulationConfig:
    seed: int = 1
    sample_interval_s: float = 2.0
    period_s: float = 240.0
    route_cycles: float = 1.55
    approach_duration_s: float = 80.0
    exit_duration_s: float = 55.0
    approach_distance_m: float = 160.0
    exit_distance_m: float = 140.0
    route_phase0: float = 0.0
    approach_lateral_offset_m: float = 0.0
    wind: WindConfig = WindConfig()
    network: NetworkLossConfig = NetworkLossConfig()
    noise: NoiseConfig = NoiseConfig()


@dataclass(frozen=True, slots=True)
class RouteGeometry:
    shape: RouteShape
    xy_m: np.ndarray
    metadata: Mapping[str, float]


@dataclass(frozen=True, slots=True)
class SimulatedTrace:
    route: RouteGeometry
    time_s: np.ndarray
    truth_xy_m: np.ndarray
    observed_xy_m: np.ndarray
    observed_mask: np.ndarray
    segment: np.ndarray
    wind_xy_mps: np.ndarray
    route_turn_mask: np.ndarray

    @property
    def dropout_fraction(self) -> float:
        return float(1.0 - np.mean(self.observed_mask))

    @property
    def observed_count(self) -> int:
        return int(np.count_nonzero(self.observed_mask))


def double_hippodrome_sweep_angles(*, include_edges: bool = True) -> tuple[float, ...]:
    """Return the QA scenario bank, never a classifier acceptance range."""
    if not include_edges:
        return DOUBLE_HIPPODROME_PRIORITY_OPENINGS_DEG
    return DOUBLE_HIPPODROME_PRIORITY_OPENINGS_DEG + DOUBLE_HIPPODROME_EDGE_OPENINGS_DEG


def _resample_closed(xy: np.ndarray, n: int) -> np.ndarray:
    xy = np.asarray(xy, dtype=float)
    if xy.ndim != 2 or xy.shape[1] != 2 or len(xy) < 3:
        raise ValueError("closed route must have shape (N,2), N>=3")
    if not np.allclose(xy[0], xy[-1]):
        xy = np.vstack((xy, xy[0]))
    ds = np.linalg.norm(np.diff(xy, axis=0), axis=1)
    s = np.concatenate(([0.0], np.cumsum(ds)))
    if s[-1] <= 0:
        raise ValueError("route length must be positive")
    target = np.linspace(0.0, s[-1], n, endpoint=False)
    return np.column_stack(
        (np.interp(target, s, xy[:, 0]), np.interp(target, s, xy[:, 1]))
    )


def _rotate(xy: np.ndarray, rotation_deg: float) -> np.ndarray:
    theta = math.radians(rotation_deg)
    c, s = math.cos(theta), math.sin(theta)
    return np.asarray(xy, dtype=float) @ np.array(((c, -s), (s, c))).T


def _circle(radius_m: float, n: int, rotation_deg: float) -> RouteGeometry:
    t = np.linspace(0.0, 2.0 * np.pi, n, endpoint=False)
    xy = np.column_stack((radius_m * np.cos(t), radius_m * np.sin(t)))
    return RouteGeometry(RouteShape.SI_CIRCLE, _rotate(xy, rotation_deg), {"radius_m": radius_m})


def _octagon(radius_m: float, n: int, rotation_deg: float) -> RouteGeometry:
    t = math.pi / 8.0 + np.arange(8) * (2.0 * np.pi / 8.0)
    vertices = np.column_stack((radius_m * np.cos(t), radius_m * np.sin(t)))
    return RouteGeometry(
        RouteShape.SI_OCTAGON,
        _rotate(_resample_closed(vertices, n), rotation_deg),
        {"radius_m": radius_m},
    )


def _free_closed(radius_m: float, n: int, rotation_deg: float, variant: float) -> RouteGeometry:
    t = np.linspace(0.0, 2.0 * np.pi, n, endpoint=False)
    radial = radius_m * (
        1.0
        + 0.10 * np.cos(3.0 * t + 0.35 + variant)
        + 0.055 * np.sin(5.0 * t - 0.65 * variant)
    )
    xy = np.column_stack((radial * np.cos(t), 0.95 * radial * np.sin(t)))
    return RouteGeometry(
        RouteShape.SI_FREE_CLOSED,
        _rotate(_resample_closed(xy, n), rotation_deg),
        {"radius_m": radius_m, "variant": variant},
    )


def _hippodrome(
    half_straight_m: float,
    turn_radius_m: float,
    n: int,
    rotation_deg: float,
) -> RouteGeometry:
    resolution = max(64, n // 4)
    top_x = np.linspace(-half_straight_m, half_straight_m, resolution, endpoint=False)
    top = np.column_stack((top_x, np.full_like(top_x, turn_radius_m)))
    theta_r = np.linspace(np.pi / 2, -np.pi / 2, resolution, endpoint=False)
    right = np.column_stack(
        (
            half_straight_m + turn_radius_m * np.cos(theta_r),
            turn_radius_m * np.sin(theta_r),
        )
    )
    bottom_x = np.linspace(half_straight_m, -half_straight_m, resolution, endpoint=False)
    bottom = np.column_stack((bottom_x, np.full_like(bottom_x, -turn_radius_m)))
    theta_l = np.linspace(-np.pi / 2, -3 * np.pi / 2, resolution, endpoint=False)
    left = np.column_stack(
        (
            -half_straight_m + turn_radius_m * np.cos(theta_l),
            turn_radius_m * np.sin(theta_l),
        )
    )
    xy = _resample_closed(np.vstack((top, right, bottom, left)), n)
    return RouteGeometry(
        RouteShape.SO_HIPPODROME,
        _rotate(xy, rotation_deg),
        {"half_straight_m": half_straight_m, "turn_radius_m": turn_radius_m},
    )


def _figure_eight(
    long_scale_m: float,
    short_scale_m: float,
    n: int,
    rotation_deg: float,
    leg_softness: float,
) -> RouteGeometry:
    # Hippodrome-like self-crossing route with deliberately soft/curved legs.
    t = np.linspace(0.0, 2.0 * np.pi, n, endpoint=False)
    x = long_scale_m * np.sin(t)
    y = short_scale_m * (np.sin(2.0 * t) + leg_softness * np.sin(4.0 * t))
    xy = _resample_closed(np.column_stack((x, y)), n)
    return RouteGeometry(
        RouteShape.SO_FIGURE_EIGHT,
        _rotate(xy, rotation_deg),
        {
            "long_scale_m": long_scale_m,
            "short_scale_m": short_scale_m,
            "leg_softness": leg_softness,
        },
    )


def _double_hippodrome(
    arm_length_m: float,
    turn_radius_m: float,
    opening_deg: float,
    n: int,
    rotation_deg: float,
) -> RouteGeometry:
    if not math.isfinite(opening_deg):
        raise ValueError("opening_deg must be finite")
    half_opening = math.radians(opening_deg / 2.0)
    shared_turn_center = np.array((0.0, -0.20 * arm_length_m), dtype=float)
    left_dir = np.array((-math.sin(half_opening), math.cos(half_opening)), dtype=float)
    right_dir = np.array((math.sin(half_opening), math.cos(half_opening)), dtype=float)
    left_center = shared_turn_center + arm_length_m * left_dir
    right_center = shared_turn_center + arm_length_m * right_dir

    # Each area is one approved Hippodrome/capsule sharing the same turn-circle
    # center. Driving geometry is the exterior of their union, so the internal
    # U-turn arcs are absent by construction.
    left_area = LineString((tuple(shared_turn_center), tuple(left_center))).buffer(
        turn_radius_m,
        cap_style=1,
        join_style=1,
        quad_segs=96,
    )
    right_area = LineString((tuple(shared_turn_center), tuple(right_center))).buffer(
        turn_radius_m,
        cap_style=1,
        join_style=1,
        quad_segs=96,
    )
    merged = unary_union((left_area, right_area))
    exterior = np.asarray(merged.exterior.coords, dtype=float)[:-1]
    xy = _resample_closed(exterior, n)
    return RouteGeometry(
        RouteShape.SO_DOUBLE_HIPPODROME,
        _rotate(xy, rotation_deg),
        {
            "arm_length_m": arm_length_m,
            "turn_radius_m": turn_radius_m,
            "opening_deg": float(opening_deg),
            "shared_turn_center_x_m": float(shared_turn_center[0]),
            "shared_turn_center_y_m": float(shared_turn_center[1]),
        },
    )


def make_route(
    shape: RouteShape | str,
    *,
    point_count: int = 2048,
    rotation_deg: float = 0.0,
    variant: float = 0.0,
    double_opening_deg: float | None = None,
) -> RouteGeometry:
    shape = RouteShape(shape)
    if point_count < 128:
        raise ValueError("point_count must be at least 128")
    if shape is RouteShape.SI_CIRCLE:
        return _circle(100.0, point_count, rotation_deg)
    if shape is RouteShape.SI_OCTAGON:
        return _octagon(105.0, point_count, rotation_deg)
    if shape is RouteShape.SI_FREE_CLOSED:
        return _free_closed(102.0, point_count, rotation_deg, variant)
    if shape is RouteShape.SO_HIPPODROME:
        return _hippodrome(135.0 + 12.0 * variant, 55.0, point_count, rotation_deg)
    if shape is RouteShape.SO_FIGURE_EIGHT:
        return _figure_eight(
            165.0 + 10.0 * variant,
            74.0,
            point_count,
            rotation_deg,
            0.10 + 0.07 * variant,
        )
    if shape is RouteShape.SO_DOUBLE_HIPPODROME:
        opening_deg = 25.0 if double_opening_deg is None else float(double_opening_deg)
        return _double_hippodrome(
            205.0 + 10.0 * variant,
            52.0,
            opening_deg,
            point_count,
            rotation_deg,
        )
    raise AssertionError(shape)


def _sample_closed_polyline(xy: np.ndarray, phases: np.ndarray) -> np.ndarray:
    points = np.vstack((xy, xy[0]))
    ds = np.linalg.norm(np.diff(points, axis=0), axis=1)
    s = np.concatenate(([0.0], np.cumsum(ds)))
    target = np.mod(phases, 1.0) * s[-1]
    return np.column_stack(
        (np.interp(target, s, points[:, 0]), np.interp(target, s, points[:, 1]))
    )


def _closed_tangent(xy: np.ndarray, phases: np.ndarray) -> np.ndarray:
    epsilon = 1e-4
    tangent = _sample_closed_polyline(xy, phases + epsilon) - _sample_closed_polyline(
        xy,
        phases - epsilon,
    )
    return tangent / np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-12)


def _bezier(
    p0: np.ndarray,
    p1: np.ndarray,
    p2: np.ndarray,
    p3: np.ndarray,
    t: np.ndarray,
) -> np.ndarray:
    t = np.asarray(t, dtype=float)[:, None]
    return (
        (1 - t) ** 3 * p0
        + 3 * (1 - t) ** 2 * t * p1
        + 3 * (1 - t) * t**2 * p2
        + t**3 * p3
    )


def _curvature(points: np.ndarray) -> np.ndarray:
    if len(points) < 3:
        return np.zeros(len(points), dtype=float)
    first = points[1:-1] - points[:-2]
    second = points[2:] - points[1:-1]
    first_len = np.linalg.norm(first, axis=1)
    second_len = np.linalg.norm(second, axis=1)
    first_unit = first / np.maximum(first_len[:, None], 1e-12)
    second_unit = second / np.maximum(second_len[:, None], 1e-12)
    angle = np.arccos(np.clip(np.sum(first_unit * second_unit, axis=1), -1.0, 1.0))
    middle = angle / np.maximum(0.5 * (first_len + second_len), 1e-9)
    return np.concatenate(([middle[0]], middle, [middle[-1]]))


def _turn_mask(route_points: np.ndarray) -> np.ndarray:
    """Return distinct high-curvature regions without labelling flat legs.

    The previous quantile-over-all-points implementation could produce a zero
    threshold on a polygon and therefore label the entire octagon as a turn.
    We instead estimate the threshold from positive/significant curvature only.
    A circle has near-constant curvature and intentionally has no *distinct*
    turn region for turn-biased communication loss.
    """

    curvature = _curvature(route_points)
    if len(curvature) == 0:
        return np.zeros(0, dtype=bool)
    mean = float(np.mean(curvature))
    std = float(np.std(curvature))
    if std <= max(1e-6, 0.05 * max(mean, 1e-12)):
        return np.zeros_like(curvature, dtype=bool)

    maximum = float(np.max(curvature))
    significant_floor = max(1e-8, 0.02 * maximum)
    positive = curvature[curvature > significant_floor]
    if len(positive) == 0:
        return np.zeros_like(curvature, dtype=bool)
    threshold = max(
        significant_floor,
        0.10 * maximum,
        float(np.quantile(positive, 0.30)),
    )
    return curvature >= threshold


def _smooth_wind(
    sample_count: int,
    sample_interval_s: float,
    config: WindConfig,
    rng: np.random.Generator,
) -> np.ndarray:
    if config.max_speed_mps <= 0 or config.response_gain_s <= 0:
        return np.zeros((sample_count, 2), dtype=float)
    duration_s = max(sample_interval_s, (sample_count - 1) * sample_interval_s)
    knot_count = max(
        4,
        int(math.ceil(duration_s / max(config.knot_seconds, sample_interval_s))) + 1,
    )
    knot_index = np.linspace(0.0, sample_count - 1, knot_count)
    magnitude = rng.uniform(0.10 * config.max_speed_mps, config.max_speed_mps, size=knot_count)
    # Direction is a smooth random walk, so both magnitude and direction vary.
    direction = np.cumsum(rng.normal(0.0, 0.65, size=knot_count))
    grid = np.arange(sample_count, dtype=float)
    return np.column_stack(
        (
            np.interp(grid, knot_index, magnitude * np.cos(direction)),
            np.interp(grid, knot_index, magnitude * np.sin(direction)),
        )
    )


def simulate(route: RouteGeometry, config: SimulationConfig) -> SimulatedTrace:
    if config.sample_interval_s <= 0 or config.period_s <= 0:
        raise ValueError("sample interval and period must be positive")
    if config.route_cycles <= 0:
        raise ValueError("route_cycles must be positive")

    rng = np.random.default_rng(config.seed)
    dt = config.sample_interval_s
    approach_count = max(2, int(round(config.approach_duration_s / dt)))
    route_count = max(12, int(round(config.period_s * config.route_cycles / dt)))
    exit_count = max(2, int(round(config.exit_duration_s / dt)))

    route_phase = config.route_phase0 + np.arange(route_count, dtype=float) * dt / config.period_s
    route_truth = _sample_closed_polyline(route.xy_m, route_phase)
    route_tangent = _closed_tangent(route.xy_m, route_phase)

    entry = route_truth[0]
    entry_tangent = route_tangent[0]
    entry_normal = np.array((-entry_tangent[1], entry_tangent[0]))
    approach_start = (
        entry
        - entry_tangent * config.approach_distance_m
        + entry_normal * config.approach_lateral_offset_m
    )
    approach_t = np.linspace(0.0, 1.0, approach_count, endpoint=False)
    approach_truth = _bezier(
        approach_start,
        approach_start + entry_tangent * (0.35 * config.approach_distance_m),
        entry - entry_tangent * (0.30 * config.approach_distance_m),
        entry,
        approach_t,
    )

    last = route_truth[-1]
    last_tangent = route_tangent[-1]
    last_normal = np.array((-last_tangent[1], last_tangent[0]))
    exit_end = (
        last
        + last_tangent * config.exit_distance_m
        + last_normal * rng.uniform(-0.30, 0.30) * config.exit_distance_m
    )
    exit_t = np.linspace(0.0, 1.0, exit_count)
    exit_truth = _bezier(
        last,
        last + last_tangent * (0.30 * config.exit_distance_m),
        exit_end - last_tangent * (0.35 * config.exit_distance_m),
        exit_end,
        exit_t,
    )

    truth = np.vstack((approach_truth, route_truth, exit_truth))
    segment = np.array(
        [SegmentKind.APPROACH.value] * approach_count
        + [SegmentKind.ROUTE.value] * route_count
        + [SegmentKind.EXIT.value] * exit_count
    )
    time_s = np.arange(len(truth), dtype=float) * dt

    derivative = np.gradient(truth, axis=0)
    tangent = derivative / np.maximum(np.linalg.norm(derivative, axis=1, keepdims=True), 1e-12)
    normal = np.column_stack((-tangent[:, 1], tangent[:, 0]))

    wind = _smooth_wind(len(truth), dt, config.wind, rng)
    cross_wind = np.sum(wind * normal, axis=1)
    along_wind = np.sum(wind * tangent, axis=1)
    wind_displacement = (
        normal * (cross_wind * config.wind.response_gain_s)[:, None]
        + tangent * (0.15 * along_wind * config.wind.response_gain_s)[:, None]
    )

    observed = truth + wind_displacement
    if config.noise.gps_std_m > 0:
        observed = observed + rng.normal(0.0, config.noise.gps_std_m, size=observed.shape)
    if config.noise.spike_probability > 0:
        spike = rng.random(len(observed)) < config.noise.spike_probability
        if np.any(spike):
            observed[spike] += rng.normal(
                0.0,
                config.noise.spike_std_m,
                size=(int(np.count_nonzero(spike)), 2),
            )

    observed_mask = rng.random(len(truth)) >= config.network.base_dropout_probability
    route_indices = np.arange(approach_count, approach_count + route_count)
    turn_mask = _turn_mask(route_truth)

    if config.network.turn_dropout_probability > 0 and np.any(turn_mask):
        survive_turn = rng.random(route_count) >= (
            config.network.turn_dropout_probability * turn_mask.astype(float)
        )
        observed_mask[route_indices] &= survive_turn

    if config.network.turn_burst_count > 0 and np.any(turn_mask):
        turn_indices = np.flatnonzero(turn_mask)
        half_width = max(
            2,
            int(round(config.network.turn_burst_half_width_fraction * route_count)),
        )
        # Small scenario-count loop; geometry/sample math remains vectorized.
        for _ in range(config.network.turn_burst_count):
            center = int(rng.choice(turn_indices))
            lo = max(0, center - half_width)
            hi = min(route_count, center + half_width + 1)
            observed_mask[route_indices[lo:hi]] = False

    return SimulatedTrace(
        route=route,
        time_s=time_s,
        truth_xy_m=truth,
        observed_xy_m=observed,
        observed_mask=observed_mask,
        segment=segment,
        wind_xy_mps=wind,
        route_turn_mask=turn_mask,
    )
