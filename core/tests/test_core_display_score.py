from __future__ import annotations

from datetime import UTC, datetime, timedelta
import unittest

from bluewolf_core.core_display_score import CoreDisplayedScoreWindow
from bluewolf_core.models import GroupScores

START = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)


def group(total: float = 75.0, *, valid: bool = True, count: int = 2) -> GroupScores:
    return GroupScores(
        valid=valid,
        sync=total if valid else None,
        route=total if valid else None,
        total=total if valid else None,
        valid_vehicle_count=count,
        primary_reason=None,
    )


class CoreDisplayScoreTests(unittest.TestCase):
    def test_only_valid_core_results_contribute_and_ten_second_window_expires(self):
        policy = CoreDisplayedScoreWindow()
        self.assertEqual(policy.observe("g", "route-a", START, None), (None, False))
        self.assertEqual(policy.observe("g", "route-a", START, group(20.0)), (20.0, True))
        self.assertEqual(policy.observe("g", "route-a", START + timedelta(seconds=3), group(40.0)), (30.0, True))
        self.assertEqual(policy.observe("g", "route-a", START + timedelta(seconds=8), group(90.0)), (50.0, True))
        self.assertEqual(policy.observe("g", "route-a", START + timedelta(seconds=11), group(90.0)), (220.0 / 3.0, True))
        self.assertEqual(policy.observe("g", "route-a", START + timedelta(seconds=12), group(90.0, valid=False)), (None, False))
        self.assertEqual(policy.observe("g", "route-a", START + timedelta(seconds=13), group(50.0)), (50.0, True))

    def test_context_switch_group_end_gap_and_insufficient_vehicles_cannot_carry_scores(self):
        policy = CoreDisplayedScoreWindow()
        policy.observe("g", "route-a", START, group(10))
        self.assertEqual(policy.observe("g", "route-b", START + timedelta(seconds=1), group(90)), (90.0, True))
        self.assertEqual(policy.observe("g", "route-b", START + timedelta(seconds=2), group(30, count=1)), (None, False))
        self.assertEqual(policy.observe("g", "route-b", START + timedelta(seconds=3), group(80)), (80.0, True))
        self.assertEqual(policy.observe("g", "route-b", START + timedelta(seconds=10), group(40)), (40.0, True))
        policy.clear("g")
        self.assertEqual(policy.observe("g", "route-b", START + timedelta(seconds=11), group(60)), (60.0, True))
        with self.assertRaisesRegex(ValueError, "strictly increasing"):
            policy.observe("g", "route-b", START + timedelta(seconds=11), group(60))

    def test_state_restores_identical_display_result_and_rejects_corruption(self):
        original = CoreDisplayedScoreWindow()
        original.observe("g", "route-a", START, group(10))
        original.observe("g", "route-a", START + timedelta(seconds=3), group(50))
        state = original.export_state()
        restored = CoreDisplayedScoreWindow()
        restored.restore_state(state)
        self.assertEqual(restored.export_state(), state)
        new_sample = START + timedelta(seconds=5)
        self.assertEqual(
            original.observe("g", "route-a", new_sample, group(90)),
            restored.observe("g", "route-a", new_sample, group(90)),
        )
        with self.assertRaisesRegex(ValueError, "timing policy"):
            CoreDisplayedScoreWindow(duration_seconds=15).restore_state(state)
        corrupted = {**state, "groups": [{**state["groups"][0], "samples": [
            state["groups"][0]["samples"][0], state["groups"][0]["samples"][0],
        ]}]}
        with self.assertRaisesRegex(ValueError, "timestamps must increase"):
            CoreDisplayedScoreWindow().restore_state(corrupted)


if __name__ == "__main__":
    unittest.main()
