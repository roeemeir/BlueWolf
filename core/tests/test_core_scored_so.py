"""SO group display/event truth must come from the SAME selected Core scoring pass."""
from __future__ import annotations

from datetime import timedelta
import unittest
from unittest.mock import patch

from bluewolf_core.live_so_event_runtime import TemplateComparisonDimension
from bluewolf_core.live_so_scoring import LiveSOGroupScorer
from bluewolf_core.so_template_selection import SOTemplateSelectionRegistry
from bluewolf_core.models import ChangeKind
from bluewolf_runtime_adapter.core_scored_so import CoreScoredSOEventRuntime
from test_live_so_event_runtime import START, _members, _runtime, _constellation, _route


class CoreScoredSOTests(unittest.TestCase):
    def _runtime(self):
        legacy, bank, _ = _runtime()
        runtime = CoreScoredSOEventRuntime(
            LiveSOGroupScorer(SOTemplateSelectionRegistry(bank)),
            comparison_dimension=TemplateComparisonDimension.SYNC,
        )
        return runtime, bank

    def test_warmup_one_selected_core_pass_and_same_observation_event_score(self):
        runtime, _ = self._runtime()
        route = _route(period_s=100.0)
        constellation = _constellation()
        with patch.object(runtime.scorer, "score_snapshot", wraps=runtime.scorer.score_snapshot) as score_pass:
            warmup = runtime.process_snapshot(
                "so-one", constellation, _members(route, 0), reference_period_s=100.0,
                displayed_group_score=None, displayed_score_valid=False,
            )
            self.assertEqual(score_pass.call_count, 1)
            self.assertIsNone(warmup.live_scoring.scoring)
            self.assertEqual(runtime.latest_displayed("so-one", START).score, None)
            self.assertFalse(runtime.latest_displayed("so-one", START).valid)
            self.assertFalse(warmup.event.snapshot.low_score_alert_active)

            scored = runtime.process_snapshot(
                "so-one", constellation, _members(route, 5), reference_period_s=100.0,
                displayed_group_score=None, displayed_score_valid=False,
            )
            self.assertEqual(score_pass.call_count, 2)
            self.assertIsNotNone(scored.live_scoring.scoring)
            actual = scored.live_scoring.scoring.group_scores
            self.assertTrue(actual.valid)
            self.assertGreaterEqual(actual.valid_vehicle_count, 2)
            shown = runtime.latest_displayed("so-one", START + timedelta(seconds=5))
            self.assertTrue(shown.valid)
            self.assertAlmostEqual(shown.score, actual.total)
            self.assertEqual(scored.event.snapshot.context_key, scored.context_key)
            self.assertEqual(scored.event.snapshot.active_template_id, scored.live_scoring.selection.template_id)
            self.assertIn(scored.live_scoring.selection.template_id, scored.comparison_scores)
            self.assertIn("same", scored.comparison_scores)

            later = runtime.process_snapshot(
                "so-one", constellation, _members(route, 10), reference_period_s=100.0,
                displayed_group_score=None, displayed_score_valid=False,
            )
            self.assertEqual(score_pass.call_count, 3)
            self.assertEqual(later.event.snapshot.event_id, scored.event.snapshot.event_id)
            same_window = runtime.display_window.export_state()["groups"]
            self.assertEqual(len(same_window), 1)
            self.assertEqual(len(same_window[0]["samples"]), 2)
            self.assertAlmostEqual(
                runtime.latest_displayed("so-one", START + timedelta(seconds=10)).score,
                (actual.total + later.live_scoring.scoring.group_scores.total) / 2,
            )
        with self.assertRaisesRegex(ValueError, "same-observation"):
            runtime.latest_displayed("so-one", START + timedelta(seconds=5))

    def test_checkpoint_restores_temporal_metrics_events_and_display_window(self):
        runtime, bank = self._runtime()
        route = _route(period_s=100.0)
        constellation = _constellation()
        for when in (0, 5, 10):
            runtime.process_snapshot(
                "so-one", constellation, _members(route, when), reference_period_s=100.0,
                displayed_group_score=None, displayed_score_valid=False,
            )
        saved = runtime.export_state()
        restored, invalidated = CoreScoredSOEventRuntime.from_state(bank, saved)
        self.assertFalse(invalidated)
        self.assertEqual(restored.display_window.export_state(), runtime.display_window.export_state())
        self.assertEqual(restored.event_engine.snapshot("so-one").event_id, runtime.event_engine.snapshot("so-one").event_id)
        original_next = runtime.process_snapshot(
            "so-one", constellation, _members(route, 15), reference_period_s=100.0,
            displayed_group_score=None, displayed_score_valid=False,
        )
        resumed_next = restored.process_snapshot(
            "so-one", constellation, _members(route, 15), reference_period_s=100.0,
            displayed_group_score=None, displayed_score_valid=False,
        )
        self.assertEqual(resumed_next.event.snapshot.event_id, original_next.event.snapshot.event_id)
        self.assertAlmostEqual(
            restored.latest_displayed("so-one", START + timedelta(seconds=15)).score,
            runtime.latest_displayed("so-one", START + timedelta(seconds=15)).score,
        )
        runtime.end_group("so-one", START + timedelta(seconds=16))
        self.assertEqual(runtime.display_window.export_state()["groups"], [])
        with self.assertRaisesRegex(ValueError, "displayed-score window"):
            CoreScoredSOEventRuntime.from_state(bank, {key: value for key, value in saved.items() if key != "coreDisplayedScoreWindow"})

    def test_external_score_is_rejected_without_advancing_core(self):
        runtime, _ = self._runtime()
        with patch.object(runtime.scorer, "score_snapshot", wraps=runtime.scorer.score_snapshot) as score_pass:
            with self.assertRaisesRegex(ValueError, "externally supplied"):
                runtime.process_snapshot(
                    "so-one", _constellation(), _members(_route(period_s=100.0), 0),
                    reference_period_s=100.0, displayed_group_score=75.0,
                    displayed_score_valid=True,
                )
            score_pass.assert_not_called()


if __name__ == "__main__":
    unittest.main()
