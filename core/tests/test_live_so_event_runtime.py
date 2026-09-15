from __future__ import annotations

import unittest
from datetime import timedelta

from bluewolf_core.event_alert import EventAlertEngine
from bluewolf_core.live_so_event_runtime import (
    LiveSOEventRuntime,
    TemplateComparisonDimension,
    build_so_event_context_key,
)
from bluewolf_core.live_so_scoring import LiveSOGroupScorer
from bluewolf_core.models import ChangeKind
from bluewolf_core.so_template_bank import SOTemplateBank, SOTemplateBankEntry
from bluewolf_core.so_template_selection import SOTemplateSelectionRegistry
from bluewolf_core.so_templates import (
    Quarter,
    SORouteInstance,
    SORouteKind,
    SOTemplate,
    SOVehicleSlot,
)

from test_live_so_scoring import START, _constellation, _input, _route, _template


def _same_quarter_template(template_id: str = "same") -> SOTemplate:
    return SOTemplate(
        template_id=template_id,
        name=template_id,
        route_instances=(
            SORouteInstance(
                route_instance_id="r1",
                route_kind=SORouteKind.SINGLE,
                vehicle_slots=(
                    SOVehicleSlot("a", "A", Quarter.Q0),
                    SOVehicleSlot("b", "A", Quarter.Q0),
                ),
            ),
        ),
    )


def _members(route, seconds: int):
    phase = (seconds / 100.0) % 1.0
    when = START + timedelta(seconds=seconds)
    return (
        _input(
            route,
            phase,
            when,
            member_id="m1",
            vehicle_identifier=1,
        ),
        _input(
            route,
            phase,
            when,
            member_id="m2",
            vehicle_identifier=2,
        ),
    )


def _runtime():
    default = _template("default")
    same = _same_quarter_template("same")
    bank = SOTemplateBank(
        (
            SOTemplateBankEntry(default, is_default=True),
            SOTemplateBankEntry(same),
        )
    )
    registry = SOTemplateSelectionRegistry(bank)
    scorer = LiveSOGroupScorer(registry)
    return (
        LiveSOEventRuntime(
            scorer,
            comparison_dimension=TemplateComparisonDimension.SYNC,
            event_engine=EventAlertEngine(),
        ),
        bank,
        registry,
    )


class LiveSOEventRuntimeTests(unittest.TestCase):
    def test_alternates_reuse_one_temporal_metric_snapshot(self) -> None:
        runtime, _, _ = _runtime()
        route = _route(period_s=100.0)
        constellation = _constellation()

        warmup = runtime.process_snapshot(
            "g1",
            constellation,
            _members(route, 0),
            reference_period_s=100.0,
            displayed_group_score=90.0,
            displayed_score_valid=True,
        )
        self.assertIsNone(warmup.live_scoring.scoring)

        scored = runtime.process_snapshot(
            "g1",
            constellation,
            _members(route, 5),
            reference_period_s=100.0,
            displayed_group_score=90.0,
            displayed_score_valid=True,
        )
        self.assertIn("default", scored.scoring_by_template)
        self.assertIn("same", scored.scoring_by_template)
        self.assertGreater(
            scored.comparison_scores["same"] - scored.comparison_scores["default"],
            30.0,
        )

        next_frame = runtime.process_snapshot(
            "g1",
            constellation,
            _members(route, 10),
            reference_period_s=100.0,
            displayed_group_score=90.0,
            displayed_score_valid=True,
        )
        for metric in next_frame.live_scoring.member_metrics:
            self.assertTrue(metric.ready)
            assert metric.observation is not None
            self.assertAlmostEqual(float(metric.observation.diagnostics["dt_s"]), 5.0)

    def test_observation_sink_captures_same_source_navigation_even_when_score_pending(self) -> None:
        runtime, _, _ = _runtime()
        captured = []
        runtime.observation_sink = captured.append
        route = _route(period_s=100.0)
        constellation = _constellation()
        warmup_members = _members(route, 0)

        warmup = runtime.process_snapshot(
            "g1",
            constellation,
            warmup_members,
            reference_period_s=100.0,
            displayed_group_score=90.0,
            displayed_score_valid=True,
        )
        self.assertEqual(len(captured), 1)
        first = captured[0]
        self.assertEqual(first.event_id, warmup.event.snapshot.event_id)
        self.assertEqual(first.pending_reason, "core_observations_incomplete")
        self.assertEqual([item.member_id for item in first.navigation], ["m1", "m2"])
        self.assertEqual([item.vehicle_identifier for item in first.navigation], [1, 2])
        for source, archived in zip(sorted(warmup_members, key=lambda item: item.member_id), first.navigation, strict=True):
            self.assertEqual(archived.latitude_deg, source.sample.latitude_deg)
            self.assertEqual(archived.longitude_deg, source.sample.longitude_deg)
            self.assertEqual(archived.altitude_m, source.sample.altitude_m)
            self.assertEqual(archived.velocity_north_mps, source.sample.velocity_north_mps)
            self.assertEqual(archived.velocity_east_mps, source.sample.velocity_east_mps)
            self.assertEqual(archived.active, source.sample.active)
            self.assertEqual(archived.reliability, source.sample.reliability)

        scored_members = _members(route, 5)
        scored = runtime.process_snapshot(
            "g1",
            constellation,
            scored_members,
            reference_period_s=100.0,
            displayed_group_score=90.0,
            displayed_score_valid=True,
        )
        self.assertEqual(len(captured), 2)
        second = captured[1]
        self.assertEqual(second.event_id, first.event_id)
        self.assertEqual(second.event_id, scored.event.snapshot.event_id)
        self.assertIsNone(second.pending_reason)
        self.assertEqual(second.sample_time_utc, scored_members[0].sample.sample_time_utc)
        self.assertEqual(second.navigation[0].latitude_deg, scored_members[0].sample.latitude_deg)
        self.assertEqual(second.navigation[1].longitude_deg, scored_members[1].sample.longitude_deg)

    def test_recommendation_opens_after_120_seconds_of_same_better_alternative(self) -> None:
        runtime, _, _ = _runtime()
        route = _route(period_s=100.0)
        constellation = _constellation()

        suggested = None
        for seconds in range(0, 130, 5):
            result = runtime.process_snapshot(
                "g1",
                constellation,
                _members(route, seconds),
                reference_period_s=100.0,
                displayed_group_score=90.0,
                displayed_score_valid=True,
            )
            changes = [
                change
                for change in result.event.changes
                if change.kind is ChangeKind.TEMPLATE_SUGGESTED
            ]
            if changes:
                suggested = changes[0]
                break

        self.assertIsNotNone(suggested)
        assert suggested is not None
        self.assertEqual(suggested.details["active_template_id"], "default")
        self.assertEqual(suggested.details["suggested_template_id"], "same")
        self.assertEqual(suggested.change_time_utc, START + timedelta(seconds=125))

    def test_context_key_is_stable_for_progress_but_changes_for_active_template(self) -> None:
        runtime, _, registry = _runtime()
        route = _route(period_s=100.0)
        constellation = _constellation()

        first_members = _members(route, 0)
        first_key = build_so_event_context_key(
            constellation,
            first_members,
            active_template_id="default",
        )
        progress_key = build_so_event_context_key(
            constellation,
            _members(route, 40),
            active_template_id="default",
        )
        changed_key = build_so_event_context_key(
            constellation,
            _members(route, 40),
            active_template_id="same",
        )
        self.assertEqual(first_key, progress_key)
        self.assertNotEqual(first_key, changed_key)

        runtime.process_snapshot(
            "g1",
            constellation,
            first_members,
            reference_period_s=100.0,
            displayed_group_score=90.0,
            displayed_score_valid=True,
        )
        registry.select_manual("g1", constellation, "same")
        changed = runtime.process_snapshot(
            "g1",
            constellation,
            _members(route, 5),
            reference_period_s=100.0,
            displayed_group_score=90.0,
            displayed_score_valid=True,
        )
        self.assertEqual(changed.live_scoring.selection.template_id, "same")
        self.assertIn(ChangeKind.EVENT_OPENED, [change.kind for change in changed.event.changes])

    def test_checkpoint_roundtrip_preserves_recommendation_evidence(self) -> None:
        runtime, bank, _ = _runtime()
        route = _route(period_s=100.0)
        constellation = _constellation()

        for seconds in range(0, 65, 5):
            runtime.process_snapshot(
                "g1",
                constellation,
                _members(route, seconds),
                reference_period_s=100.0,
                displayed_group_score=90.0,
                displayed_score_valid=True,
            )

        restored, invalidated = LiveSOEventRuntime.from_state(
            bank,
            runtime.export_state(),
        )
        self.assertEqual(invalidated, ())
        self.assertEqual(restored.comparison_dimension, TemplateComparisonDimension.SYNC)

        suggested = None
        for seconds in range(65, 130, 5):
            result = restored.process_snapshot(
                "g1",
                constellation,
                _members(route, seconds),
                reference_period_s=100.0,
                displayed_group_score=90.0,
                displayed_score_valid=True,
            )
            matches = [
                change
                for change in result.event.changes
                if change.kind is ChangeKind.TEMPLATE_SUGGESTED
            ]
            if matches:
                suggested = matches[0]
                break

        self.assertIsNotNone(suggested)
        assert suggested is not None
        self.assertEqual(suggested.change_time_utc, START + timedelta(seconds=125))

    def test_displayed_score_is_explicit_and_not_replaced_by_raw_group_score(self) -> None:
        runtime, _, _ = _runtime()
        route = _route(period_s=100.0)
        constellation = _constellation()

        runtime.process_snapshot(
            "g1",
            constellation,
            _members(route, 0),
            reference_period_s=100.0,
            displayed_group_score=None,
            displayed_score_valid=False,
        )
        result = runtime.process_snapshot(
            "g1",
            constellation,
            _members(route, 5),
            reference_period_s=100.0,
            displayed_group_score=None,
            displayed_score_valid=False,
        )
        # Raw active-template scoring exists, but the alert engine receives no
        # fabricated displayed score until the product smoothing layer supplies it.
        self.assertIsNotNone(result.live_scoring.scoring)
        self.assertFalse(result.event.snapshot.low_score_alert_active)


if __name__ == "__main__":
    unittest.main()
