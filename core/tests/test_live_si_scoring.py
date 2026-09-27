from __future__ import annotations

from datetime import UTC, datetime, timedelta
import math
import unittest

from bluewolf_core.geometry import (
    closed_polyline_length,
    local_m_to_wgs84,
    point_at_phase,
)
from bluewolf_core.live_si_scoring import LiveSIGroupScorer, LiveSIMemberInput
from bluewolf_core.models import (
    CanonicalPoint,
    ClosedRoute,
    Direction,
    RouteFamily,
    RouteSubtype,
    RouteTopology,
    VehicleSample,
)
from bluewolf_core.templates import SynchronizationTemplate, TemplateSlot


CENTER_LAT = 32.0
CENTER_LON = 34.0
RADIUS_M = 100.0
PERIOD_S = 120.0
START = datetime(2026, 9, 17, 3, 0, tzinfo=UTC)


def _route() -> ClosedRoute:
    points = tuple(
        CanonicalPoint(
            RADIUS_M * math.cos(2.0 * math.pi * index / 24.0),
            RADIUS_M * math.sin(2.0 * math.pi * index / 24.0),
        )
        for index in range(24)
    )
    return ClosedRoute(
        route_id="si-circle",
        family=RouteFamily.SI,
        subtype=RouteSubtype.COMPACT,
        topology=RouteTopology.SIMPLE,
        canonical_points=points,
        center_latitude_deg=CENTER_LAT,
        center_longitude_deg=CENTER_LON,
        length_m=closed_polyline_length(points),
        long_axis_a_m=RADIUS_M,
        short_axis_b_m=RADIUS_M,
        orientation_deg=0.0,
        estimated_period_s=PERIOD_S,
        direction=Direction.COUNTERCLOCKWISE,
        detection_quality=1.0,
    )


def _sample(route: ClosedRoute, vehicle: int, phase: float, when: datetime) -> VehicleSample:
    point = point_at_phase(route.canonical_points, phase)[0]
    latitude, longitude = local_m_to_wgs84(
        point,
        route.center_latitude_deg,
        route.center_longitude_deg,
    )
    return VehicleSample(
        sample_time_utc=when,
        server_id=1,
        vehicle_number=vehicle,
        vehicle_identifier=vehicle,
        active=True,
        latitude_deg=latitude,
        longitude_deg=longitude,
        reliability=1.0,
    )


def _template(second_offset: float) -> SynchronizationTemplate:
    return SynchronizationTemplate(
        template_id=f"si-{second_offset:.6f}",
        name="SI runtime test",
        family=RouteFamily.SI,
        slots=(
            TemplateSlot("outer-a", "TYPE_A", 0.0, route_role="outer"),
            TemplateSlot("outer-b", "TYPE_A", second_offset, route_role="outer"),
        ),
    )


def _members(route: ClosedRoute, when: datetime, phase_a: float, phase_b: float):
    speed = route.length_m / PERIOD_S
    return (
        LiveSIMemberInput(
            "v1",
            "TYPE_A",
            "outer",
            route,
            _sample(route, 101, phase_a, when),
            phase_a,
            speed,
        ),
        LiveSIMemberInput(
            "v2",
            "TYPE_A",
            "outer",
            route,
            _sample(route, 102, phase_b, when),
            phase_b,
            speed,
        ),
    )


class LiveSIScoringTests(unittest.TestCase):
    def _second_snapshot(self, scorer: LiveSIGroupScorer):
        route = _route()
        first = _members(route, START, 0.0, 1.0 / 3.0)
        warmup = scorer.score_group("g-si", first, reference_period_s=PERIOD_S)
        self.assertIsNone(warmup.scoring)
        self.assertEqual(warmup.pending_reason, "temporal_warmup")

        step = 1.0 / PERIOD_S
        second = _members(route, START + timedelta(seconds=1), step, 1.0 / 3.0 + step)
        result = scorer.score_group("g-si", second, reference_period_s=PERIOD_S)
        self.assertIsNotNone(result.scoring)
        return result

    def test_bw_sync_012_live_web_template_offset_changes_actual_group_score(self) -> None:
        exact = self._second_snapshot(LiveSIGroupScorer(_template(1.0 / 3.0)))
        changed = self._second_snapshot(LiveSIGroupScorer(_template(1.0 / 4.0)))

        assert exact.scoring is not None
        assert changed.scoring is not None
        self.assertEqual(exact.scoring.group_scores.sync, 100.0)
        self.assertLess(changed.scoring.group_scores.sync, exact.scoring.group_scores.sync)
        self.assertLess(changed.scoring.group_scores.total, exact.scoring.group_scores.total)
        self.assertEqual(
            exact.scoring.member_scores["v1"].components.sync_position,
            100.0,
        )
        self.assertLess(
            changed.scoring.member_scores["v1"].components.sync_position,
            100.0,
        )

    def test_checkpoint_restore_preserves_si_temporal_score_without_warmup(self) -> None:
        route = _route()
        scorer = LiveSIGroupScorer(_template(1.0 / 3.0))
        scorer.score_group(
            "g-si",
            _members(route, START, 0.0, 1.0 / 3.0),
            reference_period_s=PERIOD_S,
        )
        checkpoint = scorer.export_state()

        restored = LiveSIGroupScorer(_template(1.0 / 3.0))
        restored.restore_state(checkpoint)

        step = 1.0 / PERIOD_S
        second = _members(
            route,
            START + timedelta(seconds=1),
            step,
            1.0 / 3.0 + step,
        )
        continuous = scorer.score_group("g-si", second, reference_period_s=PERIOD_S)
        replayed = restored.score_group("g-si", second, reference_period_s=PERIOD_S)

        self.assertIsNotNone(continuous.scoring)
        self.assertIsNotNone(replayed.scoring)
        assert continuous.scoring is not None
        assert replayed.scoring is not None
        self.assertEqual(replayed.scoring.group_scores, continuous.scoring.group_scores)
        self.assertEqual(replayed.scoring.member_scores, continuous.scoring.member_scores)

    def test_live_si_metrics_fail_closed_across_large_temporal_gap(self) -> None:
        route = _route()
        scorer = LiveSIGroupScorer(_template(1.0 / 3.0))
        scorer.score_group(
            "g-si",
            _members(route, START, 0.0, 1.0 / 3.0),
            reference_period_s=PERIOD_S,
        )
        delayed = scorer.score_group(
            "g-si",
            _members(route, START + timedelta(seconds=7), 7.0 / PERIOD_S, 1.0 / 3.0 + 7.0 / PERIOD_S),
            reference_period_s=PERIOD_S,
        )
        self.assertIsNone(delayed.scoring)
        self.assertEqual(delayed.pending_reason, "temporal_gap")

    def test_live_si_rejects_non_si_route(self) -> None:
        route = _route()
        wrong = ClosedRoute(
            route_id=route.route_id,
            family=RouteFamily.SO,
            subtype=RouteSubtype.HIPPODROME,
            topology=route.topology,
            canonical_points=route.canonical_points,
            center_latitude_deg=route.center_latitude_deg,
            center_longitude_deg=route.center_longitude_deg,
            length_m=route.length_m,
            long_axis_a_m=route.long_axis_a_m,
            short_axis_b_m=route.short_axis_b_m,
            orientation_deg=route.orientation_deg,
            estimated_period_s=route.estimated_period_s,
            direction=route.direction,
            detection_quality=route.detection_quality,
        )
        with self.assertRaisesRegex(ValueError, "SI route"):
            LiveSIMemberInput(
                "v1",
                "TYPE_A",
                "outer",
                wrong,
                _sample(wrong, 101, 0.0, START),
                0.0,
                5.0,
            )


if __name__ == "__main__":
    unittest.main()
