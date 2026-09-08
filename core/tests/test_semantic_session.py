from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core import CoreSession, VehicleSample
from bluewolf_core.geometry import closed_polyline_length, local_m_to_wgs84
from bluewolf_core.models import (
    CanonicalPoint,
    ClosedRoute,
    Direction,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
)
from bluewolf_core.semantic_session import _projective_mean_axis
from bluewolf_core.session import _RouteRuntimeState


START = datetime(2026, 1, 1, tzinfo=UTC)
CENTER_LAT = 32.0
CENTER_LON = 34.8
KEY = (1, 101)


def _route(
    route_id: str,
    points: tuple[CanonicalPoint, ...],
    *,
    family: RouteFamily = RouteFamily.SO,
    subtype: RouteSubtype = RouteSubtype.HIPPODROME,
    topology: RouteTopology = RouteTopology.SIMPLE,
    orientation_deg: float = 0.0,
) -> ClosedRoute:
    return ClosedRoute(
        route_id=route_id,
        family=family,
        subtype=subtype,
        topology=topology,
        canonical_points=points,
        center_latitude_deg=CENTER_LAT,
        center_longitude_deg=CENTER_LON,
        length_m=closed_polyline_length(points),
        long_axis_a_m=10.0,
        short_axis_b_m=4.0,
        orientation_deg=orientation_deg,
        estimated_period_s=120.0,
        direction=Direction.UNKNOWN,
        detection_quality=1.0,
    )


def _diamond() -> tuple[CanonicalPoint, ...]:
    return (
        CanonicalPoint(10.0, 0.0),
        CanonicalPoint(0.0, 4.0),
        CanonicalPoint(-10.0, 0.0),
        CanonicalPoint(0.0, -4.0),
    )


def _figure_eight() -> tuple[CanonicalPoint, ...]:
    return (
        CanonicalPoint(8.0, 0.0),
        CanonicalPoint(4.0, 3.0),
        CanonicalPoint(0.0, 0.0),
        CanonicalPoint(-4.0, 3.0),
        CanonicalPoint(-8.0, 0.0),
        CanonicalPoint(-4.0, -3.0),
        CanonicalPoint(0.0, 0.0),
        CanonicalPoint(4.0, -3.0),
    )


def _sample(
    second: int,
    point: CanonicalPoint,
    *,
    velocity_east_mps: float | None = None,
    velocity_north_mps: float | None = None,
) -> VehicleSample:
    latitude, longitude = local_m_to_wgs84(
        point,
        CENTER_LAT,
        CENTER_LON,
    )
    return VehicleSample(
        sample_time_utc=START + timedelta(seconds=second),
        server_id=KEY[0],
        vehicle_number=1,
        vehicle_identifier=KEY[1],
        active=True,
        latitude_deg=latitude,
        longitude_deg=longitude,
        velocity_east_mps=velocity_east_mps,
        velocity_north_mps=velocity_north_mps,
    )


def _session_with_route(route: ClosedRoute) -> CoreSession:
    session = CoreSession()
    session._routes[KEY] = _RouteRuntimeState(confirmed=route)
    return session


class SemanticSessionTests(unittest.TestCase):
    def test_simple_so_preserves_raw_phase_and_adds_semantic_phase(self) -> None:
        session = _session_with_route(_route("so", _diamond()))
        result = session.process_batch((_sample(0, CanonicalPoint(0.0, 4.0)),))
        frame = result.frames[0]

        self.assertEqual(frame.route_id, "so")
        self.assertIsNotNone(frame.phase)
        self.assertAlmostEqual(frame.semantic_phase or 0.0, 0.25)

    def test_si_does_not_publish_so_semantic_phase(self) -> None:
        route = _route(
            "si",
            _diamond(),
            family=RouteFamily.SI,
            subtype=RouteSubtype.COMPACT,
        )
        session = _session_with_route(route)
        frame = session.process_batch((_sample(0, CanonicalPoint(0.0, 4.0)),)).frames[0]

        self.assertIsNotNone(frame.phase)
        self.assertIsNone(frame.semantic_phase)

    def test_figure_eight_crossing_without_heading_is_semantically_invalid(self) -> None:
        route = _route(
            "figure8",
            _figure_eight(),
            subtype=RouteSubtype.FIGURE_EIGHT,
            topology=RouteTopology.SELF_CROSSING,
        )
        session = _session_with_route(route)
        frame = session.process_batch((_sample(0, CanonicalPoint(0.0, 0.0)),)).frames[0]

        # Raw legacy phase remains available, but synchronization semantics must
        # not consume it at a self-crossing without heading evidence.
        self.assertIsNotNone(frame.phase)
        self.assertIsNone(frame.semantic_phase)

    def test_figure_eight_crossing_uses_sample_velocity_for_semantic_phase(self) -> None:
        route = _route(
            "figure8",
            _figure_eight(),
            subtype=RouteSubtype.FIGURE_EIGHT,
            topology=RouteTopology.SELF_CROSSING,
        )
        first = _session_with_route(route).process_batch(
            (
                _sample(
                    0,
                    CanonicalPoint(0.0, 0.0),
                    velocity_east_mps=-4.0,
                    velocity_north_mps=3.0,
                ),
            )
        ).frames[0]
        second = _session_with_route(route).process_batch(
            (
                _sample(
                    0,
                    CanonicalPoint(0.0, 0.0),
                    velocity_east_mps=4.0,
                    velocity_north_mps=-3.0,
                ),
            )
        ).frames[0]

        self.assertAlmostEqual(first.semantic_phase or 0.0, 0.25)
        self.assertAlmostEqual(second.semantic_phase or 0.0, 0.75)

    def test_semantic_output_survives_checkpoint_restore(self) -> None:
        route = _route("so", _diamond())
        uninterrupted = _session_with_route(route)
        uninterrupted.process_batch((_sample(0, CanonicalPoint(10.0, 0.0)),))
        expected = uninterrupted.process_batch((_sample(5, CanonicalPoint(0.0, 4.0)),))

        before_restart = _session_with_route(route)
        before_restart.process_batch((_sample(0, CanonicalPoint(10.0, 0.0)),))
        restored = CoreSession.from_checkpoint(before_restart.export_checkpoint())
        actual = restored.process_batch((_sample(5, CanonicalPoint(0.0, 4.0)),))

        self.assertIsInstance(restored, CoreSession)
        self.assertEqual(actual, expected)
        self.assertAlmostEqual(actual.frames[0].semantic_phase or 0.0, 0.25)

    def test_one_batch_and_incremental_batches_keep_semantic_frames_identical(self) -> None:
        route = _route("so", _diamond())
        samples = (
            _sample(0, CanonicalPoint(10.0, 0.0)),
            _sample(5, CanonicalPoint(0.0, 4.0)),
            _sample(10, CanonicalPoint(-10.0, 0.0)),
            _sample(15, CanonicalPoint(0.0, -4.0)),
        )

        one = _session_with_route(route)
        expected = one.process_batch(samples)

        incremental = _session_with_route(route)
        frames = []
        changes = []
        for sample in samples:
            result = incremental.process_batch((sample,))
            frames.extend(result.frames)
            changes.extend(result.changes)

        self.assertEqual(tuple(frames), expected.frames)
        self.assertEqual(tuple(changes), expected.changes)
        self.assertEqual(incremental.export_checkpoint(), one.export_checkpoint())

    def test_projective_group_axis_is_order_and_sign_boundary_independent(self) -> None:
        first = _projective_mean_axis((134.9, 135.1))
        second = _projective_mean_axis((135.1, 134.9))
        self.assertIsNotNone(first)
        self.assertEqual(first, second)
        assert first is not None
        self.assertAlmostEqual(math.hypot(first[0], first[1]), 1.0)


if __name__ == "__main__":
    unittest.main()
