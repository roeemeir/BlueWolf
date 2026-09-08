from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta

import numpy as np

from bluewolf_core.double_lobe_geometry import derive_double_hippodrome_components_from_route
from bluewolf_core.geometry import (
    closed_polyline_length,
    local_m_to_wgs84,
    point_at_phase,
    project_onto_closed_polyline,
)
from bluewolf_core.live_so_scoring import (
    LiveSOGroupScorer,
    LiveSOMemberInput,
    LiveSOMetricsEngine,
)
from bluewolf_core.models import (
    CanonicalPoint,
    ClosedRoute,
    Direction,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
    VehicleSample,
)
from bluewolf_core.so_phase import build_so_phase_frame
from bluewolf_core.so_template_bank import (
    SOConstellationRoute,
    SOConstellationSignature,
    SOTemplateBank,
    SOTemplateBankEntry,
)
from bluewolf_core.so_template_selection import SOTemplateSelectionRegistry
from bluewolf_core.so_templates import (
    Quarter,
    SORouteInstance,
    SORouteKind,
    SOTemplate,
    SOVehicleSlot,
)
from bluewolf_core.trajectory_simulator import RouteShape, make_route
from bluewolf_core.vector_trajectory import robust_axis_frame


CENTER_LAT = 32.0
CENTER_LON = 34.8
START = datetime(2026, 9, 9, 8, 0, tzinfo=UTC)


def _route(
    shape: RouteShape = RouteShape.SO_HIPPODROME,
    *,
    period_s: float = 100.0,
    opening_deg: float | None = None,
) -> ClosedRoute:
    geometry = make_route(
        shape,
        point_count=512,
        rotation_deg=13.0,
        double_opening_deg=opening_deg,
    )
    indices = np.linspace(0, len(geometry.xy_m), 64, endpoint=False).astype(int)
    xy = geometry.xy_m[indices]
    center, vectors, half_axes = robust_axis_frame(xy)
    centered = xy - center
    long_index = int(np.argmax(half_axes))
    long_vector = vectors[:, long_index]
    orientation = math.degrees(
        math.atan2(float(long_vector[1]), float(long_vector[0]))
    ) % 180.0
    points = tuple(CanonicalPoint(float(x), float(y)) for x, y in centered)
    is_double = shape is RouteShape.SO_DOUBLE_HIPPODROME
    return ClosedRoute(
        route_id=f"{shape.value}-{period_s:g}",
        family=RouteFamily.SO,
        subtype=(RouteSubtype.DOUBLE_HIPPODROME if is_double else RouteSubtype.HIPPODROME),
        topology=(RouteTopology.DOUBLE if is_double else RouteTopology.SIMPLE),
        canonical_points=points,
        center_latitude_deg=CENTER_LAT,
        center_longitude_deg=CENTER_LON,
        length_m=closed_polyline_length(points),
        long_axis_a_m=float(np.max(half_axes)),
        short_axis_b_m=float(np.min(half_axes)),
        orientation_deg=orientation,
        estimated_period_s=period_s,
        direction=Direction.UNKNOWN,
        detection_quality=1.0,
    )


def _raw_phase_for_semantic(route: ClosedRoute, semantic_phase: float) -> float:
    frame = build_so_phase_frame(route)
    if frame.phase_sign > 0:
        return (frame.anchor_phase + semantic_phase) % 1.0
    return (frame.anchor_phase - semantic_phase) % 1.0


def _sample_on_route(
    route: ClosedRoute,
    semantic_phase: float,
    when: datetime,
    *,
    vehicle_identifier: int = 1,
    work_speed_mps: float | None = None,
) -> VehicleSample:
    raw = _raw_phase_for_semantic(route, semantic_phase)
    point = point_at_phase(route.canonical_points, raw)[0]
    latitude, longitude = local_m_to_wgs84(point, CENTER_LAT, CENTER_LON)
    projection = project_onto_closed_polyline(route.canonical_points, point)
    frame = build_so_phase_frame(route)
    speed = work_speed_mps if work_speed_mps is not None else route.length_m / route.estimated_period_s
    return VehicleSample(
        sample_time_utc=when,
        server_id=1,
        vehicle_number=vehicle_identifier,
        vehicle_identifier=vehicle_identifier,
        active=True,
        latitude_deg=latitude,
        longitude_deg=longitude,
        velocity_east_mps=projection.tangent_east * frame.phase_sign * speed,
        velocity_north_mps=projection.tangent_north * frame.phase_sign * speed,
        reliability=1.0,
    )


def _input(
    route: ClosedRoute,
    semantic_phase: float,
    when: datetime,
    *,
    member_id: str = "m1",
    vehicle_identifier: int = 1,
    route_instance_id: str = "r1",
    vehicle_type: str = "A",
    work_speed_mps: float | None = None,
) -> LiveSOMemberInput:
    speed = work_speed_mps if work_speed_mps is not None else route.length_m / route.estimated_period_s
    return LiveSOMemberInput(
        member_id=member_id,
        vehicle_type=vehicle_type,
        route_instance_id=route_instance_id,
        route=route,
        sample=_sample_on_route(
            route,
            semantic_phase,
            when,
            vehicle_identifier=vehicle_identifier,
            work_speed_mps=speed,
        ),
        semantic_phase=semantic_phase,
        work_speed_mps=speed,
    )


def _template(template_id: str = "default") -> SOTemplate:
    return SOTemplate(
        template_id=template_id,
        name=template_id,
        route_instances=(
            SORouteInstance(
                route_instance_id="r1",
                route_kind=SORouteKind.SINGLE,
                vehicle_slots=(
                    SOVehicleSlot("front", "A", Quarter.Q0),
                    SOVehicleSlot("back", "A", Quarter.Q2),
                ),
            ),
        ),
    )


def _constellation() -> SOConstellationSignature:
    return SOConstellationSignature(
        (SOConstellationRoute(SORouteKind.SINGLE, ("A", "A")),)
    )


def _component_absolute_point(component, index: int) -> CanonicalPoint:
    point = component.canonical_points[index % len(component.canonical_points)]
    return CanonicalPoint(
        point.x_m + component.center_offset_east_m,
        point.y_m + component.center_offset_north_m,
    )


def _double_input(
    route: ClosedRoute,
    component_id: str,
    point: CanonicalPoint,
    semantic_phase: float,
    when: datetime,
) -> LiveSOMemberInput:
    latitude, longitude = local_m_to_wgs84(point, CENTER_LAT, CENTER_LON)
    sample = VehicleSample(
        sample_time_utc=when,
        server_id=1,
        vehicle_number=1,
        vehicle_identifier=1,
        active=True,
        latitude_deg=latitude,
        longitude_deg=longitude,
        reliability=1.0,
    )
    return LiveSOMemberInput(
        member_id="m1",
        vehicle_type="A",
        route_instance_id="double",
        route=route,
        sample=sample,
        semantic_phase=semantic_phase,
        active_so_component_id=component_id,
        work_speed_mps=20.0,
    )


class LiveSOMetricsTests(unittest.TestCase):
    def test_expected_phase_progress_produces_zero_period_and_movement_error(self) -> None:
        route = _route(period_s=100.0)
        engine = LiveSOMetricsEngine(max_contiguous_gap_s=5.0)
        first = engine.observe(_input(route, 0.00, START), reference_period_s=100.0)
        second = engine.observe(
            _input(route, 0.05, START + timedelta(seconds=5)),
            reference_period_s=100.0,
        )

        self.assertFalse(first.ready)
        self.assertEqual(first.reason, "temporal_warmup")
        self.assertTrue(second.ready)
        assert second.observation is not None
        self.assertAlmostEqual(second.observation.period_error_ratio, 0.0, places=9)
        self.assertAlmostEqual(second.observation.movement_error_ratio, 0.0, places=6)
        self.assertAlmostEqual(second.observation.distance_error_b_ratio, 0.0, places=6)
        self.assertIsNotNone(second.observation.tangent_error_deg)
        self.assertAlmostEqual(float(second.observation.tangent_error_deg), 0.0, places=5)
        self.assertAlmostEqual(second.observation.speed_fraction, 1.0, places=5)

    def test_period_error_uses_explicit_group_reference_period(self) -> None:
        route = _route(period_s=110.0)
        engine = LiveSOMetricsEngine()
        engine.observe(_input(route, 0.00, START), reference_period_s=100.0)
        result = engine.observe(
            _input(route, 0.05, START + timedelta(seconds=5)),
            reference_period_s=100.0,
        )
        self.assertTrue(result.ready)
        assert result.observation is not None
        self.assertAlmostEqual(result.observation.period_error_ratio, 0.10, places=6)

    def test_so_tangent_adherence_is_direction_invariant(self) -> None:
        route = _route(period_s=100.0)
        speed = route.length_m / route.estimated_period_s
        first = _input(route, 0.00, START, work_speed_mps=speed)
        second = _input(route, 0.95, START + timedelta(seconds=5), work_speed_mps=speed)
        # Reverse the supplied velocity to match decreasing semantic phase.
        second_sample = second.sample
        second = LiveSOMemberInput(
            member_id=second.member_id,
            vehicle_type=second.vehicle_type,
            route_instance_id=second.route_instance_id,
            route=second.route,
            sample=VehicleSample(
                sample_time_utc=second_sample.sample_time_utc,
                server_id=second_sample.server_id,
                vehicle_number=second_sample.vehicle_number,
                vehicle_identifier=second_sample.vehicle_identifier,
                active=True,
                latitude_deg=second_sample.latitude_deg,
                longitude_deg=second_sample.longitude_deg,
                velocity_east_mps=-float(second_sample.velocity_east_mps),
                velocity_north_mps=-float(second_sample.velocity_north_mps),
                reliability=1.0,
            ),
            semantic_phase=second.semantic_phase,
            work_speed_mps=second.work_speed_mps,
        )

        engine = LiveSOMetricsEngine()
        engine.observe(first, reference_period_s=100.0)
        result = engine.observe(second, reference_period_s=100.0)
        self.assertTrue(result.ready)
        assert result.observation is not None
        self.assertAlmostEqual(float(result.observation.tangent_error_deg), 0.0, places=5)
        self.assertAlmostEqual(result.observation.movement_error_ratio, 0.0, places=6)

    def test_double_lobe_switch_resets_temporal_derivative_instead_of_bridging_roles(self) -> None:
        route = _route(
            RouteShape.SO_DOUBLE_HIPPODROME,
            period_s=200.0,
            opening_deg=30.0,
        )
        components = derive_double_hippodrome_components_from_route(route)
        first, second = components
        first_point_0 = _component_absolute_point(first, 6)
        first_point_1 = _component_absolute_point(first, 7)
        second_point = _component_absolute_point(second, 8)

        engine = LiveSOMetricsEngine()
        warmup = engine.observe(
            _double_input(route, first.component_id, first_point_0, 0.10, START),
            reference_period_s=100.0,
        )
        ready = engine.observe(
            _double_input(
                route,
                first.component_id,
                first_point_1,
                0.15,
                START + timedelta(seconds=5),
            ),
            reference_period_s=100.0,
        )
        switched = engine.observe(
            _double_input(
                route,
                second.component_id,
                second_point,
                0.20,
                START + timedelta(seconds=10),
            ),
            reference_period_s=100.0,
        )

        self.assertEqual(warmup.reason, "temporal_warmup")
        self.assertTrue(ready.ready)
        self.assertFalse(switched.ready)
        self.assertEqual(switched.reason, "active_component_changed")

    def test_temporal_gap_resets_progress_evidence(self) -> None:
        route = _route(period_s=100.0)
        engine = LiveSOMetricsEngine(max_contiguous_gap_s=5.0)
        engine.observe(_input(route, 0.00, START), reference_period_s=100.0)
        result = engine.observe(
            _input(route, 0.10, START + timedelta(seconds=10)),
            reference_period_s=100.0,
        )
        self.assertFalse(result.ready)
        self.assertEqual(result.reason, "temporal_gap")

    def test_metric_state_round_trip_preserves_next_result(self) -> None:
        route = _route(period_s=100.0)
        engine = LiveSOMetricsEngine()
        engine.observe(_input(route, 0.00, START), reference_period_s=100.0)
        restored = LiveSOMetricsEngine.from_state(engine.export_state())

        next_item = _input(route, 0.05, START + timedelta(seconds=5))
        original = engine.observe(next_item, reference_period_s=100.0)
        replay = restored.observe(next_item, reference_period_s=100.0)
        self.assertEqual(original, replay)


class LiveSOGroupScorerTests(unittest.TestCase):
    def test_default_template_scores_complete_live_snapshot_after_warmup(self) -> None:
        route = _route(period_s=100.0)
        bank = SOTemplateBank((SOTemplateBankEntry(_template(), is_default=True),))
        scorer = LiveSOGroupScorer(SOTemplateSelectionRegistry(bank))
        constellation = _constellation()

        first = (
            _input(route, 0.00, START, member_id="m1", vehicle_identifier=1),
            _input(route, 0.50, START, member_id="m2", vehicle_identifier=2),
        )
        second = (
            _input(route, 0.05, START + timedelta(seconds=5), member_id="m1", vehicle_identifier=1),
            _input(route, 0.55, START + timedelta(seconds=5), member_id="m2", vehicle_identifier=2),
        )
        warmup = scorer.score_snapshot(
            "g1", constellation, first, reference_period_s=100.0
        )
        result = scorer.score_snapshot(
            "g1", constellation, second, reference_period_s=100.0
        )

        self.assertIsNone(warmup.scoring)
        self.assertTrue(warmup.pending_reason.startswith("member_metrics_pending:"))
        self.assertIsNotNone(result.scoring)
        assert result.scoring is not None
        self.assertEqual(result.selection.template_id, "default")
        self.assertTrue(result.scoring.group_scores.valid)
        self.assertAlmostEqual(float(result.scoring.group_scores.sync), 100.0, places=4)
        self.assertTrue(all(item.scores.valid for item in result.scoring.members))

    def test_no_default_or_manual_selection_leaves_group_explicitly_unscored(self) -> None:
        route = _route(period_s=100.0)
        bank = SOTemplateBank((SOTemplateBankEntry(_template("candidate")),))
        scorer = LiveSOGroupScorer(SOTemplateSelectionRegistry(bank))
        result = scorer.score_snapshot(
            "g1",
            _constellation(),
            (
                _input(route, 0.00, START, member_id="m1", vehicle_identifier=1),
                _input(route, 0.50, START, member_id="m2", vehicle_identifier=2),
            ),
            reference_period_s=100.0,
        )
        self.assertIsNone(result.scoring)
        self.assertEqual(result.pending_reason, "no_active_template")
        self.assertIsNone(result.selection.template_id)

    def test_group_scorer_checkpoint_restores_selection_and_temporal_state(self) -> None:
        route = _route(period_s=100.0)
        template = _template("manual")
        bank = SOTemplateBank((SOTemplateBankEntry(template),))
        registry = SOTemplateSelectionRegistry(bank)
        registry.select_manual("g1", _constellation(), "manual")
        scorer = LiveSOGroupScorer(registry)
        first = (
            _input(route, 0.00, START, member_id="m1", vehicle_identifier=1),
            _input(route, 0.50, START, member_id="m2", vehicle_identifier=2),
        )
        scorer.score_snapshot("g1", _constellation(), first, reference_period_s=100.0)
        restored, invalidated = LiveSOGroupScorer.from_state(bank, scorer.export_state())
        self.assertEqual(invalidated, ())

        second = (
            _input(route, 0.05, START + timedelta(seconds=5), member_id="m1", vehicle_identifier=1),
            _input(route, 0.55, START + timedelta(seconds=5), member_id="m2", vehicle_identifier=2),
        )
        original = scorer.score_snapshot(
            "g1", _constellation(), second, reference_period_s=100.0
        )
        replay = restored.score_snapshot(
            "g1", _constellation(), second, reference_period_s=100.0
        )
        self.assertEqual(original, replay)
        self.assertEqual(replay.selection.template_id, "manual")


if __name__ == "__main__":
    unittest.main()
