from __future__ import annotations

import math
import unittest

import numpy as np
from shapely.geometry import LineString, Point

from bluewolf_core.double_lobe_geometry import derive_double_hippodrome_components_from_route
from bluewolf_core.double_lobe_phase import (
    AmbiguousDoubleLobeProjection,
    project_double_active_lobe_wgs84,
)
from bluewolf_core.geometry import (
    closed_polyline_length,
    local_m_to_wgs84,
    project_onto_closed_polyline,
)
from bluewolf_core.models import (
    CanonicalPoint,
    ClosedRoute,
    Direction,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
)
from bluewolf_core.trajectory_simulator import RouteShape, make_route
from bluewolf_core.vector_trajectory import robust_axis_frame


CENTER_LAT = 32.0
CENTER_LON = 34.8


def _double_route(opening_deg: float = 25.0, rotation_deg: float = 17.0) -> ClosedRoute:
    geometry = make_route(
        RouteShape.SO_DOUBLE_HIPPODROME,
        point_count=512,
        rotation_deg=rotation_deg,
        double_opening_deg=opening_deg,
    )
    indices = np.linspace(0, len(geometry.xy_m), 64, endpoint=False).astype(int)
    xy = geometry.xy_m[indices]
    center, vectors, half_axes = robust_axis_frame(xy)
    centered = xy - center
    long_index = int(np.argmax(half_axes))
    long_vector = vectors[:, long_index]
    orientation = math.degrees(math.atan2(float(long_vector[1]), float(long_vector[0]))) % 180.0
    points = tuple(CanonicalPoint(float(x), float(y)) for x, y in centered)
    return ClosedRoute(
        route_id=f"double-{opening_deg:g}",
        family=RouteFamily.SO,
        subtype=RouteSubtype.DOUBLE_HIPPODROME,
        topology=RouteTopology.DOUBLE,
        canonical_points=points,
        center_latitude_deg=CENTER_LAT,
        center_longitude_deg=CENTER_LON,
        length_m=closed_polyline_length(points),
        long_axis_a_m=float(np.max(half_axes)),
        short_axis_b_m=float(np.min(half_axes)),
        orientation_deg=orientation,
        estimated_period_s=300.0,
        direction=Direction.UNKNOWN,
        detection_quality=1.0,
    )


def _absolute_component_xy(component) -> np.ndarray:
    return np.asarray(
        [
            (
                point.x_m + component.center_offset_east_m,
                point.y_m + component.center_offset_north_m,
            )
            for point in component.canonical_points
        ],
        dtype=float,
    )


def _intersection_point(first, second) -> np.ndarray:
    first_xy = _absolute_component_xy(first)
    second_xy = _absolute_component_xy(second)
    first_line = LineString(np.vstack((first_xy, first_xy[0])))
    second_line = LineString(np.vstack((second_xy, second_xy[0])))
    intersection = first_line.intersection(second_line)
    points: list[Point] = []
    if isinstance(intersection, Point):
        points = [intersection]
    elif hasattr(intersection, "geoms"):
        points = [item for item in intersection.geoms if isinstance(item, Point)]
    if not points:
        raise AssertionError("derived Double components must intersect at the handoff region")
    chosen = sorted(points, key=lambda item: (item.x, item.y))[0]
    return np.array((float(chosen.x), float(chosen.y)), dtype=float)


def _to_wgs84(point_xy: np.ndarray) -> tuple[float, float]:
    return local_m_to_wgs84(
        CanonicalPoint(float(point_xy[0]), float(point_xy[1])),
        CENTER_LAT,
        CENTER_LON,
    )


class DoubleLobePhaseTests(unittest.TestCase):
    def test_double_geometry_derives_exactly_two_single_hippodrome_components(self) -> None:
        route = _double_route(25.0)
        components = derive_double_hippodrome_components_from_route(route)
        self.assertEqual(len(components), 2)
        self.assertEqual({item.component_id for item in components}, {"lobe_0", "lobe_1"})
        self.assertTrue(all(item.subtype is RouteSubtype.HIPPODROME for item in components))
        self.assertTrue(all(item.length_m > 0.0 for item in components))

    def test_unique_position_selects_component_without_vehicle_identity(self) -> None:
        route = _double_route(30.0)
        components = derive_double_hippodrome_components_from_route(route)
        first = components[0]
        first_xy = _absolute_component_xy(first)
        # Pick the point on lobe_0 furthest from the other logical lobe.
        second_xy = _absolute_component_xy(components[1])
        second_line = LineString(np.vstack((second_xy, second_xy[0])))
        distances = np.asarray([second_line.distance(Point(x, y)) for x, y in first_xy])
        point = first_xy[int(np.argmax(distances))]
        latitude, longitude = _to_wgs84(point)

        result = project_double_active_lobe_wgs84(route, latitude, longitude)
        self.assertEqual(result.component_id, first.component_id)
        self.assertFalse(result.heading_disambiguated)
        self.assertEqual(result.candidate_count, 1)

    def test_connection_without_heading_is_explicitly_ambiguous(self) -> None:
        route = _double_route(25.0)
        first, second = derive_double_hippodrome_components_from_route(route)
        point = _intersection_point(first, second)
        latitude, longitude = _to_wgs84(point)
        with self.assertRaises(AmbiguousDoubleLobeProjection):
            project_double_active_lobe_wgs84(route, latitude, longitude)

    def test_connection_heading_selects_the_matching_logical_hippodrome(self) -> None:
        route = _double_route(25.0)
        first, second = derive_double_hippodrome_components_from_route(route)
        point = _intersection_point(first, second)
        latitude, longitude = _to_wgs84(point)

        selected: list[str] = []
        for component in (first, second):
            local_query = CanonicalPoint(
                float(point[0] - component.center_offset_east_m),
                float(point[1] - component.center_offset_north_m),
            )
            projection = project_onto_closed_polyline(component.canonical_points, local_query)
            result = project_double_active_lobe_wgs84(
                route,
                latitude,
                longitude,
                velocity_east_mps=projection.tangent_east,
                velocity_north_mps=projection.tangent_north,
            )
            selected.append(result.component_id)
            self.assertTrue(result.heading_disambiguated)
            self.assertGreaterEqual(result.candidate_count, 2)

        self.assertEqual(set(selected), {first.component_id, second.component_id})

    def test_full_double_traversal_switches_active_lobe_without_vehicle_id_state(self) -> None:
        route = _double_route(35.0)
        points = np.asarray([(p.x_m, p.y_m) for p in route.canonical_points], dtype=float)
        component_ids: list[str] = []
        for index, point in enumerate(points):
            previous = points[(index - 1) % len(points)]
            following = points[(index + 1) % len(points)]
            velocity = following - previous
            latitude, longitude = _to_wgs84(point)
            result = project_double_active_lobe_wgs84(
                route,
                latitude,
                longitude,
                velocity_east_mps=float(velocity[0]),
                velocity_north_mps=float(velocity[1]),
            )
            component_ids.append(result.component_id)

        self.assertEqual(set(component_ids), {"lobe_0", "lobe_1"})
        transitions = sum(
            first != second
            for first, second in zip(component_ids, component_ids[1:] + component_ids[:1])
        )
        self.assertGreaterEqual(transitions, 2)

    def test_role_swap_is_a_consequence_of_geometry_not_vehicle_id(self) -> None:
        route = _double_route(25.0)
        first, second = derive_double_hippodrome_components_from_route(route)
        first_point = _absolute_component_xy(first)[8]
        second_point = _absolute_component_xy(second)[8]

        def active(point: np.ndarray) -> str:
            latitude, longitude = _to_wgs84(point)
            return project_double_active_lobe_wgs84(route, latitude, longitude).component_id

        vehicle_a_before = active(first_point)
        vehicle_b_before = active(second_point)
        vehicle_a_after = active(second_point)
        vehicle_b_after = active(first_point)

        self.assertNotEqual(vehicle_a_before, vehicle_b_before)
        self.assertEqual(vehicle_a_after, vehicle_b_before)
        self.assertEqual(vehicle_b_after, vehicle_a_before)


if __name__ == "__main__":
    unittest.main()
