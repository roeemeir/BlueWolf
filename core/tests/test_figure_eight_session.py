from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core import ChangeKind, CoreSession
from bluewolf_core.simulator import SimulatedVehicle, generate_figure_eight_samples


START = datetime(2026, 1, 1, tzinfo=UTC)


def figure_eight_scenario(duration_seconds: int = 200):
    return generate_figure_eight_samples(
        start_time_utc=START,
        duration_seconds=duration_seconds,
        vehicles=(SimulatedVehicle(7, 707, 0),),
        long_extent_m=100,
        short_extent_m=50,
        period_seconds=180,
        orientation_deg=31,
    )


class FigureEightSessionTests(unittest.TestCase):
    def test_session_confirms_figure_eight_without_transient_simple_route(self) -> None:
        session = CoreSession()
        result = session.process_batch(figure_eight_scenario())
        confirmations = [
            item for item in result.changes if item.kind is ChangeKind.ROUTE_CONFIRMED
        ]

        self.assertEqual(len(confirmations), 1)
        confirmed = confirmations[0]
        self.assertEqual(confirmed.details["family"], "so")
        self.assertEqual(confirmed.details["subtype"], "figure_eight")
        self.assertAlmostEqual(
            float(confirmed.details["estimated_period_s"]),
            180.0,
            delta=5.0,
        )
        confirm_second = (confirmed.change_time_utc - START).total_seconds()
        self.assertGreater(confirm_second, 90.0)
        self.assertLessEqual(confirm_second, 200.0)

    def test_checkpoint_mid_figure_eight_matches_uninterrupted_lifecycle(self) -> None:
        samples = figure_eight_scenario()
        split_time = START + timedelta(seconds=100)
        first = tuple(sample for sample in samples if sample.sample_time_utc <= split_time)
        second = tuple(sample for sample in samples if sample.sample_time_utc > split_time)

        uninterrupted = CoreSession()
        first_result = uninterrupted.process_batch(first)
        self.assertFalse(
            any(item.kind is ChangeKind.ROUTE_CONFIRMED for item in first_result.changes)
        )
        expected_tail = uninterrupted.process_batch(second)

        before_restart = CoreSession()
        before_restart.process_batch(first)
        restored = CoreSession.from_checkpoint(before_restart.export_checkpoint())
        actual_tail = restored.process_batch(second)

        self.assertEqual(actual_tail, expected_tail)
        confirmations = [
            item for item in actual_tail.changes if item.kind is ChangeKind.ROUTE_CONFIRMED
        ]
        self.assertEqual(len(confirmations), 1)
        self.assertEqual(confirmations[0].details["subtype"], "figure_eight")
        self.assertEqual(restored.debug_state(), uninterrupted.debug_state())
        self.assertEqual(restored.export_checkpoint(), uninterrupted.export_checkpoint())


if __name__ == "__main__":
    unittest.main()
