from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from bluewolf_core.event_alert import EventAlertConfig, EventAlertEngine
from bluewolf_core.live_so_event_runtime import LiveSOEventRuntime, TemplateComparisonDimension
from bluewolf_core.live_so_scoring import LiveSOGroupScorer
from bluewolf_core.models import ChangeKind, StateChange
from bluewolf_core.so_template_bank import SOTemplateBank, SOTemplateBankEntry
from bluewolf_core.so_template_selection import SOTemplateSelectionRegistry
from bluewolf_runtime_adapter.event_lifecycle_archive import SOEventLifecycleArchive

from test_live_so_event_runtime import _members
from test_live_so_scoring import _constellation, _route, _template


BASE = datetime(2026, 9, 16, 10, 0, tzinfo=UTC)


class EventLifecycleArchiveTests(unittest.TestCase):
    def test_legacy_event_without_lifecycle_is_unknown_not_active(self) -> None:
        with TemporaryDirectory() as directory:
            archive = SOEventLifecycleArchive(Path(directory) / "events.sqlite")
            lifecycle = archive.event_lifecycle("legacy-event")
        self.assertEqual(lifecycle["status"], "unknown")
        self.assertEqual(lifecycle["changes"], [])

    def test_open_ending_closed_roundtrip_is_immutable_and_idempotent(self) -> None:
        with TemporaryDirectory() as directory:
            archive = SOEventLifecycleArchive(Path(directory) / "events.sqlite")
            opened = StateChange(
                BASE,
                ChangeKind.EVENT_OPENED,
                1,
                group_id="g1",
                event_id="e1",
                details={"reason": "group_became_active"},
            )
            ending = StateChange(
                BASE + timedelta(seconds=20),
                ChangeKind.EVENT_ENDING,
                1,
                group_id="g1",
                event_id="e1",
                details={"reason": "structural_group_ended", "finalize_at_utc": "2026-09-16T10:02:20Z"},
            )
            closed = StateChange(
                BASE + timedelta(seconds=20),
                ChangeKind.EVENT_CLOSED,
                1,
                group_id="g1",
                event_id="e1",
                details={"reason": "structural_group_ended", "finalized_time_utc": "2026-09-16T10:02:20Z"},
            )
            self.assertTrue(archive.record_change(opened))
            self.assertFalse(archive.record_change(opened))
            self.assertTrue(archive.record_change(ending))
            finalizing = archive.event_lifecycle("e1")
            self.assertEqual(finalizing["status"], "finalizing")
            self.assertEqual(finalizing["openingReason"], "group_became_active")
            self.assertEqual(finalizing["endingReason"], "structural_group_ended")
            self.assertEqual(finalizing["finalizeAt"], "2026-09-16T10:02:20Z")
            self.assertTrue(archive.record_change(closed))
            lifecycle = archive.event_lifecycle("e1")
        self.assertEqual(lifecycle["status"], "closed")
        self.assertEqual(lifecycle["closedAt"], "2026-09-16T10:00:20Z")
        self.assertEqual([item["kind"] for item in lifecycle["changes"]], [
            "event_opened", "event_closed", "event_ending"
        ])

    def test_live_runtime_emits_open_and_immediate_finalizing_reason(self) -> None:
        bank = SOTemplateBank((SOTemplateBankEntry(_template("default"), is_default=True),))
        registry = SOTemplateSelectionRegistry(bank)
        scorer = LiveSOGroupScorer(registry)
        lifecycle = []
        runtime = LiveSOEventRuntime(
            scorer,
            comparison_dimension=TemplateComparisonDimension.SYNC,
            event_engine=EventAlertEngine(EventAlertConfig(event_finalize_seconds=120.0)),
            lifecycle_sink=lifecycle.append,
        )
        route = _route(period_s=100.0)
        first_members = _members(route, 0)
        result = runtime.process_snapshot(
            "g1",
            _constellation(),
            first_members,
            reference_period_s=100.0,
            displayed_group_score=90.0,
            displayed_score_valid=True,
        )
        event_id = result.event.snapshot.event_id
        opened = [item for item in lifecycle if item.kind is ChangeKind.EVENT_OPENED]
        self.assertEqual(len(opened), 1)
        self.assertEqual(opened[0].details["reason"], "group_became_active")

        end_at = first_members[0].sample.sample_time_utc + timedelta(seconds=20)
        runtime.end_group("g1", end_at, reason="structural_group_ended")
        ending = [item for item in lifecycle if item.kind is ChangeKind.EVENT_ENDING and item.event_id == event_id]
        self.assertEqual(len(ending), 1)
        self.assertEqual(ending[0].details["reason"], "structural_group_ended")
        self.assertEqual(ending[0].details["finalize_at_utc"], (end_at + timedelta(seconds=120)).isoformat().replace("+00:00", "Z"))
        self.assertFalse(any(item.kind is ChangeKind.EVENT_CLOSED for item in lifecycle))

    def test_context_change_records_old_event_ending_and_new_open_reason(self) -> None:
        bank = SOTemplateBank((SOTemplateBankEntry(_template("default"), is_default=True),))
        registry = SOTemplateSelectionRegistry(bank)
        scorer = LiveSOGroupScorer(registry)
        lifecycle = []
        runtime = LiveSOEventRuntime(scorer, comparison_dimension=TemplateComparisonDimension.SYNC, lifecycle_sink=lifecycle.append)
        route = _route(period_s=100.0)
        first = runtime.process_snapshot(
            "g1", _constellation(), _members(route, 0), reference_period_s=100.0,
            displayed_group_score=90.0, displayed_score_valid=True,
        )
        old_event = first.event.snapshot.event_id
        changed_route = _route(period_s=120.0)
        second = runtime.process_snapshot(
            "g1", _constellation(), _members(changed_route, 5), reference_period_s=120.0,
            displayed_group_score=90.0, displayed_score_valid=True,
        )
        self.assertNotEqual(second.event.snapshot.event_id, old_event)
        old_ending = [item for item in lifecycle if item.kind is ChangeKind.EVENT_ENDING and item.event_id == old_event]
        self.assertEqual(len(old_ending), 1)
        self.assertEqual(old_ending[0].details["reason"], "context_changed")
        new_open = [item for item in lifecycle if item.kind is ChangeKind.EVENT_OPENED and item.event_id == second.event.snapshot.event_id]
        self.assertEqual(len(new_open), 1)
        self.assertEqual(new_open[0].details["reason"], "context_changed")


if __name__ == "__main__":
    unittest.main()
