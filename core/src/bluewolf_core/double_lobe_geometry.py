"""Logical Single-Hippodrome components for an approved Double Hippodrome.

The Double detector fits the exterior boundary of the union of two capsule-like
Single Hippodromes that share the same turn-circle center. Synchronization uses
those two logical Single-Hippodrome surfaces, while route lifecycle continues to
use the full Double boundary.

This module reconstructs the two fitted component boundaries from the same model
family used by ``route_classifier_v2``. No new shape classifier, opening-angle
gate or time heuristic is introduced here.
"""
from __future__ import annotations

import math
from functools import lru_cache
from typing import Mapping

import numpy as np
from shapely.geometry import LineString

from .models import CanonicalPoint, ClosedRoute, RouteComponent, RouteSubtype
from .route_classifier_v2 import _align_template, _double_template, _fit_double_hippodrome
from .vector_trajectory import robust_axis_frame


_EPS = 1e-12


def _resample_closed(points: np.ndarray, count: int = 64) -> np.ndarray:
    points = np.asarray(points, dtype=float)
    if not np.allclose(points[0], points[-1]):
        points = np.vstack((points, points[0]))
    delta = np.diff(points, axis=0)
    ds = np.linalg.norm(delta, axis=1)
    distance = np.concatenate(([0.0], np.cumsum(ds)))
    if distance[-1] <= _EPS:
        raise ValueError("component boundary must have positive length")
    target = np.linspace(0.0, distance[-1], count, endpoint=False)
    return np.column_stack(
        (
            np.interp(target, distance, points[:, 0]),
            np.interp(target, distance, points[:, 1]),
        )
    )


def _component_templates(opening_deg: float, radius_ratio: float) -> tuple[np.ndarray, np.ndarray]:
    half_opening = math.radians(float(opening_deg) / 2.0)
    shared = np.array((0.0, 0.0), dtype=float)
    left = np.array((-math.sin(half_opening), math.cos(half_opening)), dtype=float)
    right = np.array((math.sin(half_opening), math.cos(half_opening)), dtype=float)
    radius = float(radius_ratio)
    if radius <= 0.0:
        raise ValueError("radius_ratio must be positive")

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
    return (
        _resample_closed(np.asarray(first.exterior.coords, dtype=float)[:-1]),
        _resample_closed(np.asarray(second.exterior.coords, dtype=float)[:-1]),
    )


def _affine_map_from_correspondence(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Return the exact 2D similarity/reflection map selected by the fitter."""

    source = np.asarray(source, dtype=float)
    target = np.asarray(target, dtype=float)
    if source.shape != target.shape or source.ndim != 2 or source.shape[1] != 2:
        raise ValueError("source and target must have the same shape (N,2)")
    design = np.column_stack((source, np.ones(len(source), dtype=float)))
    transform, *_ = np.linalg.lstsq(design, target, rcond=None)
    return transform


def _apply_affine(points: np.ndarray, transform: np.ndarray) -> np.ndarray:
    design = np.column_stack((np.asarray(points, dtype=float), np.ones(len(points), dtype=float)))
    return design @ transform


def _closed_length(points: np.ndarray) -> float:
    points = np.asarray(points, dtype=float)
    return float(np.sum(np.linalg.norm(np.roll(points, -1, axis=0) - points, axis=1)))


def derive_double_hippodrome_components(
    canonical_absolute_xy_m: np.ndarray,
    diagnostics: Mapping[str, float | int | bool | str],
) -> tuple[RouteComponent, RouteComponent]:
    """Reconstruct the two fitted logical Single-Hippodrome components."""

    opening_raw = diagnostics.get("opening_deg")
    radius_raw = diagnostics.get("radius_ratio")
    if opening_raw is None or radius_raw is None:
        raise ValueError("Double Hippodrome diagnostics must include opening_deg and radius_ratio")
    opening_deg = float(opening_raw)
    radius_ratio = float(radius_raw)

    parent = np.asarray(canonical_absolute_xy_m, dtype=float)
    if parent.ndim != 2 or parent.shape[1] != 2 or len(parent) < 6:
        raise ValueError("canonical_absolute_xy_m must have shape (N,2) with N>=6")

    base_union = _double_template(round(opening_deg, 3), round(radius_ratio, 4))
    aligned_union = _align_template(base_union, parent)
    transform = _affine_map_from_correspondence(base_union, aligned_union)
    base_components = _component_templates(opening_deg, radius_ratio)
    aligned_components = tuple(_apply_affine(component, transform) for component in base_components)

    parent_center, _, _ = robust_axis_frame(parent)
    prepared: list[tuple[tuple[float, float], RouteComponent]] = []
    for component_points in aligned_components:
        center, vectors, half_axes = robust_axis_frame(component_points)
        centered = component_points - center
        long_index = int(np.argmax(half_axes))
        long_vector = vectors[:, long_index]
        orientation = math.degrees(
            math.atan2(float(long_vector[1]), float(long_vector[0]))
        ) % 180.0
        offset = center - parent_center
        component = RouteComponent(
            component_id="pending",
            subtype=RouteSubtype.HIPPODROME,
            canonical_points=tuple(
                CanonicalPoint(float(point[0]), float(point[1])) for point in centered
            ),
            center_offset_east_m=float(offset[0]),
            center_offset_north_m=float(offset[1]),
            length_m=_closed_length(component_points),
            long_axis_a_m=float(np.max(half_axes)),
            short_axis_b_m=float(np.min(half_axes)),
            orientation_deg=orientation,
        )
        prepared.append(((float(center[0]), float(center[1])), component))

    prepared.sort(key=lambda item: (item[0][0], item[0][1]))
    output: list[RouteComponent] = []
    for index, (_, component) in enumerate(prepared):
        output.append(
            RouteComponent(
                component_id=f"lobe_{index}",
                subtype=component.subtype,
                canonical_points=component.canonical_points,
                center_offset_east_m=component.center_offset_east_m,
                center_offset_north_m=component.center_offset_north_m,
                length_m=component.length_m,
                long_axis_a_m=component.long_axis_a_m,
                short_axis_b_m=component.short_axis_b_m,
                orientation_deg=component.orientation_deg,
            )
        )
    if len(output) != 2:
        raise AssertionError("Double Hippodrome must reconstruct exactly two components")
    return output[0], output[1]


@lru_cache(maxsize=256)
def _cached_components_from_signature(
    canonical_signature: tuple[tuple[float, float], ...],
    short_axis_b_m: float,
) -> tuple[RouteComponent, RouteComponent]:
    points = np.asarray(canonical_signature, dtype=float)
    fit = _fit_double_hippodrome(points, max(float(short_axis_b_m), 1.0))
    return derive_double_hippodrome_components(points, fit.metadata)


def derive_double_hippodrome_components_from_route(
    route: ClosedRoute,
) -> tuple[RouteComponent, RouteComponent]:
    """Derive logical lobes from a confirmed Double route when not persisted.

    The fit runs against the route's small canonical polyline (<=64 points), not
    raw history. Results are cached by immutable geometry signature, so live
    projection pays this cost once per distinct detected Double geometry while
    checkpoint restart remains deterministic.
    """

    if route.subtype is not RouteSubtype.DOUBLE_HIPPODROME:
        raise ValueError("route must be a Double Hippodrome")
    if route.components:
        if len(route.components) != 2:
            raise ValueError("Double Hippodrome must contain exactly two components")
        return route.components[0], route.components[1]

    signature = tuple((float(point.x_m), float(point.y_m)) for point in route.canonical_points)
    return _cached_components_from_signature(signature, float(route.short_axis_b_m))
