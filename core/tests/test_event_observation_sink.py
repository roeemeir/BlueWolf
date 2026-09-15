from __future__ import annotations

import unittest

from bluewolf_core.event_alert import EventAlertEngine
from bluewolf_core.live_so_event_runtime import LiveSOEventRuntime, TemplateComparisonDimension
from bluewolf_core.live_so_scoring import LiveSOGroupScorer
from bluewolf_core.so_template_bank import SOTemplateBank, SOTemplateBankEntry
from bluewolf_core.so_template_selection import SOTemplateSelectionRegistry

from test_live_so_event_runtime import _members
from test_live_so_scoring import _constellation, _route, _template


class EventObservationSinkTests(unittest.TestCase):
    def test_pending_and_scored_snapshots_keep_one_authoritative_event_range(self) -> None:
        bank = SOTemplateBank((SOTemplateBankEntry(_template("default"), is_default=True),))
        registry = SOTemplateSelectionRegistry(bank)
        scorer = LiveSOGroupScorer(registry)
        captured = []
        runtime = LiveSOEventRuntime(
            scorer,
            comparison_dimension=TemplateComparisonDimension.SYNC,
            event_engine=EventAlertEngine(),
            observation_sink=captured.append,
        )
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
        pending = captured[0]
        self.assertEqual(pending.event_id, warmup.event.snapshot.event_id)
        self.assertEqual(pending.sample_time_utc, warmup_members[0].sample.sample_time_utc)
        self.assertEqual(pending.pending_reason, "core_observations_incomplete")
        self.assertLess(len(pending.observations), len(warmup_members))

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
        frame = captured[1]
        self.assertEqual(frame.event_id, scored.event.snapshot.event_id)
        self.assertEqual(frame.event_id, pending.event_id)
        self.assertEqual(frame.group_id, "g1")
        self.assertEqual(frame.server_id, 1)
        self.assertEqual(frame.sample_time_utc, scored_members[0].sample.sample_time_utc)
        self.assertIsNone(frame.pending_reason)
        self.assertEqual({item.member_id for item in frame.observations}, {"m1", "m2"})
        self.assertTrue(all(item.diagnostics for item in frame.observations))


if __name__ == "__main__":
    unittest.main()
