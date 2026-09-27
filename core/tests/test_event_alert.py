from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core.event_alert import EventAlertEngine, EventObservation
from bluewolf_core.models import ChangeKind


BASE = datetime(2026, 9, 9, 10, 0, tzinfo=UTC)


def _obs(
    seconds: int,
    *,
    group_score: float | None = 90.0,
    valid: bool = True,
    context: str = "ctx-a",
    active_template: str | None = "A",
    template_scores: dict[str, float] | None = None,
) -> EventObservation:
    if template_scores is None:
        template_scores = {"A": 70.0, "B": 70.0}
    return EventObservation(
        sample_time_utc=BASE + timedelta(seconds=seconds),
        server_id=1,
        group_id="group-1",
        context_key=context,
        group_score=group_score,
        score_valid=valid,
        active_template_id=active_template,
        template_scores=template_scores,
    )


class EventAlertEngineTests(unittest.TestCase):
    def test_first_observation_opens_event_without_alert(self) -> None:
        engine = EventAlertEngine()
        result = engine.observe(_obs(0))
        self.assertEqual([c.kind for c in result.changes], [ChangeKind.EVENT_OPENED])
        self.assertFalse(result.snapshot.low_score_alert_active)
        self.assertIsNone(result.snapshot.suggested_template_id)

    def test_low_score_alert_opens_after_ten_continuous_seconds(self) -> None:
        engine = EventAlertEngine()
        engine.observe(_obs(0, group_score=40.0))
        before = engine.observe(_obs(9, group_score=40.0))
        opened = engine.observe(_obs(10, group_score=40.0))
        self.assertNotIn(ChangeKind.ALERT_OPENED, [c.kind for c in before.changes])
        alerts = [c for c in opened.changes if c.kind is ChangeKind.ALERT_OPENED]
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0].details["onset_time_utc"], "2026-09-09T10:00:00Z")
        self.assertTrue(opened.snapshot.low_score_alert_active)

    def test_invalid_score_breaks_low_score_opening_streak(self) -> None:
        engine = EventAlertEngine()
        engine.observe(_obs(0, group_score=40.0))
        engine.observe(_obs(8, group_score=None, valid=False, template_scores={}))
        result = engine.observe(_obs(10, group_score=40.0))
        self.assertNotIn(ChangeKind.ALERT_OPENED, [c.kind for c in result.changes])
        result = engine.observe(_obs(20, group_score=40.0))
        self.assertIn(ChangeKind.ALERT_OPENED, [c.kind for c in result.changes])

    def test_alert_recovers_after_twenty_seconds_at_sixty_or_above(self) -> None:
        engine = EventAlertEngine()
        engine.observe(_obs(0, group_score=40.0))
        engine.observe(_obs(10, group_score=40.0))
        engine.observe(_obs(11, group_score=65.0))
        before = engine.observe(_obs(30, group_score=65.0))
        closed = engine.observe(_obs(31, group_score=65.0))
        self.assertNotIn(ChangeKind.ALERT_CLOSED, [c.kind for c in before.changes])
        self.assertIn(ChangeKind.ALERT_CLOSED, [c.kind for c in closed.changes])
        self.assertFalse(closed.snapshot.low_score_alert_active)

    def test_template_suggestion_needs_thirty_point_advantage_for_120_seconds(self) -> None:
        engine = EventAlertEngine()
        scores = {"A": 50.0, "B": 80.0, "C": 75.0}
        engine.observe(_obs(0, template_scores=scores))
        before = engine.observe(_obs(119, template_scores=scores))
        suggested = engine.observe(_obs(120, template_scores=scores))
        self.assertNotIn(ChangeKind.TEMPLATE_SUGGESTED, [c.kind for c in before.changes])
        recommendation = [c for c in suggested.changes if c.kind is ChangeKind.TEMPLATE_SUGGESTED]
        self.assertEqual(len(recommendation), 1)
        self.assertEqual(recommendation[0].details["suggested_template_id"], "B")
        self.assertEqual(suggested.snapshot.active_template_id, "A")
        self.assertEqual(suggested.snapshot.suggested_template_id, "B")

    def test_recommendation_candidate_switch_restarts_evidence_window(self) -> None:
        engine = EventAlertEngine()
        engine.observe(_obs(0, template_scores={"A": 40.0, "B": 80.0, "C": 75.0}))
        engine.observe(_obs(100, template_scores={"A": 40.0, "B": 70.0, "C": 85.0}))
        before = engine.observe(_obs(219, template_scores={"A": 40.0, "B": 70.0, "C": 85.0}))
        suggested = engine.observe(_obs(220, template_scores={"A": 40.0, "B": 70.0, "C": 85.0}))
        self.assertIsNone(before.snapshot.suggested_template_id)
        self.assertEqual(suggested.snapshot.suggested_template_id, "C")

    def test_suggestion_closes_after_advantage_below_fifteen_for_thirty_seconds(self) -> None:
        engine = EventAlertEngine()
        good = {"A": 50.0, "B": 85.0}
        weak = {"A": 70.0, "B": 80.0}
        engine.observe(_obs(0, template_scores=good))
        engine.observe(_obs(120, template_scores=good))
        engine.observe(_obs(121, template_scores=weak))
        before = engine.observe(_obs(150, template_scores=weak))
        closed = engine.observe(_obs(151, template_scores=weak))
        self.assertEqual(before.snapshot.suggested_template_id, "B")
        self.assertIsNone(closed.snapshot.suggested_template_id)
        self.assertEqual(closed.snapshot.active_template_id, "A")

    def test_rejection_hides_that_template_until_event_ends(self) -> None:
        engine = EventAlertEngine()
        scores = {"A": 40.0, "B": 80.0}
        engine.observe(_obs(0, template_scores=scores))
        engine.observe(_obs(120, template_scores=scores))
        rejected = engine.reject_suggestion("group-1", BASE + timedelta(seconds=120))
        self.assertEqual(rejected.rejected_template_ids, ("B",))
        still_hidden = engine.observe(_obs(300, template_scores=scores))
        self.assertIsNone(still_hidden.snapshot.suggested_template_id)
        new_event = engine.observe(_obs(301, context="ctx-b", template_scores=scores))
        self.assertEqual(new_event.snapshot.rejected_template_ids, ())
        engine.observe(_obs(421, context="ctx-b", template_scores=scores))
        self.assertEqual(engine.snapshot("group-1").suggested_template_id, "B")

    def test_context_change_opens_new_event_and_old_event_finalizes_after_120_seconds(self) -> None:
        engine = EventAlertEngine()
        first = engine.observe(_obs(0))
        old_event_id = first.snapshot.event_id
        changed = engine.observe(_obs(10, context="ctx-b"))
        new_event_id = changed.snapshot.event_id
        self.assertNotEqual(old_event_id, new_event_id)
        self.assertIn(ChangeKind.EVENT_OPENED, [c.kind for c in changed.changes])
        self.assertNotIn(ChangeKind.EVENT_CLOSED, [c.kind for c in changed.changes])
        self.assertEqual(engine.advance(BASE + timedelta(seconds=129)), ())
        finalized = engine.advance(BASE + timedelta(seconds=130))
        closes = [c for c in finalized if c.kind is ChangeKind.EVENT_CLOSED]
        self.assertEqual(len(closes), 1)
        self.assertEqual(closes[0].event_id, old_event_id)
        self.assertEqual(closes[0].change_time_utc, BASE + timedelta(seconds=10))

    def test_checkpoint_roundtrip_preserves_low_score_and_recommendation_streaks(self) -> None:
        engine = EventAlertEngine()
        scores = {"A": 45.0, "B": 80.0}
        engine.observe(_obs(0, group_score=40.0, template_scores=scores))
        engine.observe(_obs(5, group_score=40.0, template_scores=scores))
        restored = EventAlertEngine.from_state(engine.export_state())
        opened = restored.observe(_obs(10, group_score=40.0, template_scores=scores))
        self.assertIn(ChangeKind.ALERT_OPENED, [c.kind for c in opened.changes])
        suggested = restored.observe(_obs(120, group_score=40.0, template_scores=scores))
        self.assertIn(ChangeKind.TEMPLATE_SUGGESTED, [c.kind for c in suggested.changes])

    def test_event_end_closes_active_alert_immediately_but_finalizes_event_later(self) -> None:
        engine = EventAlertEngine()
        engine.observe(_obs(0, group_score=40.0))
        engine.observe(_obs(10, group_score=40.0))
        changes = engine.end_group("group-1", BASE + timedelta(seconds=20))
        self.assertIn(ChangeKind.ALERT_CLOSED, [c.kind for c in changes])
        self.assertNotIn(ChangeKind.EVENT_CLOSED, [c.kind for c in changes])
        finalized = engine.advance(BASE + timedelta(seconds=140))
        self.assertIn(ChangeKind.EVENT_CLOSED, [c.kind for c in finalized])


if __name__ == "__main__":
    unittest.main()
