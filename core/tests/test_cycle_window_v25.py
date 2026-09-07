from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core import ChangeKind, CoreSession
from bluewolf_core.cycle_window_v25 import latest_cycle_vehicle_samples
from bluewolf_core.simulator import SimulatedVehicle, SimulatedWind, generate_si_circle_samples


START = datetime(2026, 9, 7, 0, 0, tzinfo=UTC)


def noisy_windy_samples(duration: int = 360):
    return generate_si_circle_samples(
        start_time_utc=START,
        duration_seconds=duration,
        vehicles=(SimulatedVehicle(1, 101, 0.0),),
        radius_m=100.0,
        period_seconds=120.0,
        position_noise_std_m=0.45,
        wind=SimulatedWind(
            steady_north_mps=0.35,
            steady_east_mps=-0.20,
            gust_amplitude_mps=0.30,
            gust_period_seconds=37.0,
            gust_bearing_deg=115.0,
            position_response_seconds=1.5,
            velocity_coupling=0.30,
        ),
        seed=91,
    )


class LatestCycleV25Tests(unittest.TestCase):
    def test_latest_cycle_is_period_window_plus_one_boundary_sample(self) -> None:
        samples = generate_si_circle_samples(
            start_time_utc=START,
            duration_seconds=600,
            vehicles=(SimulatedVehicle(1, 101, 0.0),),
            period_seconds=120.0,
        )
        cycle = latest_cycle_vehicle_samples(samples, 120.0)
        self.assertEqual(cycle[-1].sample_time_utc, START + timedelta(seconds=600))
        self.assertEqual(cycle[0].sample_time_utc, START + timedelta(seconds=479))
        self.assertEqual(len(cycle), 122)

    def test_route_confirms_before_legacy_five_minute_gate_with_wind_and_noise(self) -> None:
        session = CoreSession()
        result = session.process_batch(noisy_windy_samples(360))
        confirmed = [change for change in result.changes if change.kind is ChangeKind.ROUTE_CONFIRMED]
        self.assertEqual(len(confirmed), 1)
        elapsed = (confirmed[0].change_time_utc - START).total_seconds()
        # Confirmation is driven by a completed closed cycle + the existing
        # candidate stability interval, not the legacy fixed 300-second wait.
        self.assertLess(elapsed, 300.0)
        self.assertGreaterEqual(elapsed, 120.0)
        self.assertEqual(confirmed[0].details["family"], "si")

    def test_wind_noise_one_batch_and_five_second_batches_are_deterministic(self) -> None:
        samples = noisy_windy_samples(360)
        one = CoreSession()
        one.process_batch(samples)

        incremental = CoreSession()
        for start_second in range(0, 361, 5):
            end_second = start_second + 5
            part = tuple(
                sample
                for sample in samples
                if start_second <= (sample.sample_time_utc - START).total_seconds() < end_second
            )
            incremental.process_batch(part)

        self.assertEqual(incremental.debug_state(), one.debug_state())
        self.assertEqual(incremental.export_checkpoint(), one.export_checkpoint())

    def test_40_minute_history_is_memory_not_active_fit_requirement(self) -> None:
        session = CoreSession()
        result = session.process_batch(noisy_windy_samples(240))
        confirmed = [change for change in result.changes if change.kind is ChangeKind.ROUTE_CONFIRMED]
        self.assertTrue(confirmed)
        route = session.debug_state()["routes"][0]
        # The route can already be confirmed while much less than 40 minutes of
        # NAV exist. Forty minutes is retained later for evidence/refinement.
        self.assertLess((confirmed[0].change_time_utc - START).total_seconds(), 40 * 60)
        self.assertLess(route["history_count"], 40 * 60 + 2)


if __name__ == "__main__":
    unittest.main()
