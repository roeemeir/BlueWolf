from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core.so_template_bank import SOConstellationRoute, SOConstellationSignature
from bluewolf_core.so_template_recommendation import (
    TemplateRecommendationEngine,
    TemplateRecommendationTransitionKind,
)
from bluewolf_core.so_templates import SORouteKind


START = datetime(2026, 9, 9, 0, 0, tzinfo=UTC)
SIGNATURE = SOConstellationSignature(
    (SOConstellationRoute(SORouteKind.SINGLE, ("A", "A")),)
)


class TemplateRecommendationTests(unittest.TestCase):
    def observe(
        self,
        engine: TemplateRecommendationEngine,
        seconds: int,
        *,
        active: float = 50.0,
        alt: float | None = 82.0,
        alt2: float | None = None,
        valid: bool = True,
        event_id: str = "event-1",
    ):
        scores = {"active": active, "alt": alt}
        if alt2 is not None:
            scores["alt2"] = alt2
        return engine.observe(
            time_utc=START + timedelta(seconds=seconds),
            event_id=event_id,
            group_id="group-1",
            constellation=SIGNATURE,
            active_template_id="active",
            template_scores=scores,
            evidence_valid=valid,
        )

    def test_suggestion_opens_only_after_30_point_advantage_for_120_seconds(self) -> None:
        engine = TemplateRecommendationEngine()
        first, changes = self.observe(engine, 0)
        self.assertEqual(first.pending_template_id, "alt")
        self.assertEqual(changes, ())

        before, changes = self.observe(engine, 119)
        self.assertIsNone(before.suggested_template_id)
        self.assertEqual(changes, ())

        opened, changes = self.observe(engine, 120)
        self.assertEqual(opened.suggested_template_id, "alt")
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0].kind, TemplateRecommendationTransitionKind.SUGGESTED)
        self.assertAlmostEqual(changes[0].advantage_points, 32.0)

    def test_continuous_open_evidence_resets_when_margin_drops_or_evidence_is_invalid(self) -> None:
        engine = TemplateRecommendationEngine()
        self.observe(engine, 0)
        snapshot, _ = self.observe(engine, 60, alt=78.0)
        self.assertIsNone(snapshot.pending_template_id)

        snapshot, _ = self.observe(engine, 70)
        self.assertEqual(snapshot.pending_template_id, "alt")
        snapshot, _ = self.observe(engine, 130, valid=False)
        self.assertIsNone(snapshot.pending_template_id)

        snapshot, _ = self.observe(engine, 140)
        self.assertEqual(snapshot.pending_template_id, "alt")
        snapshot, _ = self.observe(engine, 260)
        self.assertEqual(snapshot.suggested_template_id, "alt")

    def test_best_alternative_change_restarts_the_120_second_interval(self) -> None:
        engine = TemplateRecommendationEngine()
        snapshot, _ = self.observe(engine, 0, alt=81.0, alt2=80.0)
        self.assertEqual(snapshot.pending_template_id, "alt")
        snapshot, _ = self.observe(engine, 100, alt=81.0, alt2=90.0)
        self.assertEqual(snapshot.pending_template_id, "alt2")
        snapshot, changes = self.observe(engine, 119, alt=81.0, alt2=90.0)
        self.assertIsNone(snapshot.suggested_template_id)
        self.assertEqual(changes, ())
        snapshot, changes = self.observe(engine, 220, alt=81.0, alt2=90.0)
        self.assertEqual(snapshot.suggested_template_id, "alt2")
        self.assertEqual(changes[0].kind, TemplateRecommendationTransitionKind.SUGGESTED)

    def test_open_suggestion_closes_only_after_advantage_below_15_for_30_seconds(self) -> None:
        engine = TemplateRecommendationEngine()
        self.observe(engine, 0)
        self.observe(engine, 120)

        snapshot, changes = self.observe(engine, 130, alt=64.0)
        self.assertEqual(snapshot.suggested_template_id, "alt")
        self.assertEqual(changes, ())
        snapshot, changes = self.observe(engine, 159, alt=64.0)
        self.assertEqual(snapshot.suggested_template_id, "alt")
        self.assertEqual(changes, ())
        snapshot, changes = self.observe(engine, 160, alt=64.0)
        self.assertIsNone(snapshot.suggested_template_id)
        self.assertEqual(changes[0].kind, TemplateRecommendationTransitionKind.CLOSED)

    def test_close_timer_is_cancelled_when_advantage_recovers(self) -> None:
        engine = TemplateRecommendationEngine()
        self.observe(engine, 0)
        self.observe(engine, 120)
        self.observe(engine, 130, alt=64.0)
        snapshot, _ = self.observe(engine, 150, alt=70.0)
        self.assertIsNone(snapshot.close_since_utc)
        snapshot, changes = self.observe(engine, 170, alt=64.0)
        self.assertEqual(snapshot.suggested_template_id, "alt")
        self.assertEqual(changes, ())

    def test_rejected_template_is_suppressed_until_that_event_ends(self) -> None:
        engine = TemplateRecommendationEngine()
        self.observe(engine, 0)
        self.observe(engine, 120)
        transition = engine.reject(
            time_utc=START + timedelta(seconds=121),
            event_id="event-1",
            group_id="group-1",
            constellation=SIGNATURE,
        )
        self.assertEqual(transition.kind, TemplateRecommendationTransitionKind.REJECTED)

        snapshot, _ = self.observe(engine, 130)
        self.assertIn("alt", snapshot.suppressed_template_ids)
        self.assertIsNone(snapshot.pending_template_id)
        snapshot, _ = self.observe(engine, 400)
        self.assertIsNone(snapshot.suggested_template_id)

        other, _ = self.observe(engine, 0, event_id="event-2")
        self.assertEqual(other.pending_template_id, "alt")
        engine.end_event("event-1")
        self.assertIsNone(
            engine.snapshot(event_id="event-1", group_id="group-1", constellation=SIGNATURE)
        )

    def test_recommendation_never_changes_the_active_template(self) -> None:
        engine = TemplateRecommendationEngine()
        self.observe(engine, 0)
        snapshot, _ = self.observe(engine, 120)
        self.assertEqual(snapshot.active_template_id, "active")
        self.assertEqual(snapshot.suggested_template_id, "alt")

    def test_active_template_change_resets_old_recommendation_evidence(self) -> None:
        engine = TemplateRecommendationEngine()
        self.observe(engine, 0)
        snapshot, _ = engine.observe(
            time_utc=START + timedelta(seconds=100),
            event_id="event-1",
            group_id="group-1",
            constellation=SIGNATURE,
            active_template_id="alt",
            template_scores={"alt": 80.0, "active": 50.0},
        )
        self.assertEqual(snapshot.active_template_id, "alt")
        self.assertEqual(snapshot.pending_template_id, "active")
        self.assertIsNone(snapshot.suggested_template_id)

    def test_missing_evidence_does_not_close_visible_suggestion(self) -> None:
        engine = TemplateRecommendationEngine()
        self.observe(engine, 0)
        self.observe(engine, 120)
        snapshot, changes = self.observe(engine, 140, alt=None)
        self.assertEqual(snapshot.suggested_template_id, "alt")
        self.assertIsNone(snapshot.close_since_utc)
        self.assertEqual(changes, ())

    def test_export_restore_is_deterministic(self) -> None:
        engine = TemplateRecommendationEngine()
        self.observe(engine, 0)
        self.observe(engine, 120)
        engine.reject(
            time_utc=START + timedelta(seconds=121),
            event_id="event-1",
            group_id="group-1",
            constellation=SIGNATURE,
        )
        exported = engine.export_state()
        restored = TemplateRecommendationEngine.from_state(exported)
        self.assertEqual(restored.export_state(), exported)

    def test_time_must_be_monotonic_and_scores_bounded(self) -> None:
        engine = TemplateRecommendationEngine()
        self.observe(engine, 10)
        with self.assertRaises(ValueError):
            self.observe(engine, 10)
        with self.assertRaises(ValueError):
            engine.observe(
                time_utc=START + timedelta(seconds=20),
                event_id="event-x",
                group_id="group-1",
                constellation=SIGNATURE,
                active_template_id="active",
                template_scores={"active": 50.0, "alt": 101.0},
            )


if __name__ == "__main__":
    unittest.main()
