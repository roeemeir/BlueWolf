from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core import ChangeKind, CoreSession, VehicleSample
from bluewolf_core.simulator import SimulatedVehicle, generate_si_circle_samples


START = datetime(2026, 1, 1, tzinfo=UTC)


def _confirmation(session: CoreSession, samples: tuple[VehicleSample, ...]):
    result = session.process_batch(samples)
    return next(
        (
            change
            for change in result.changes
            if change.kind is ChangeKind.ROUTE_CONFIRMED
        ),
        None,
    )


class AdaptiveAcquisitionSimulationTests(unittest.TestCase):
    def test_confirmation_latency_scales_with_route_period(self) -> None:
        """The detector should follow route evidence rather than a fixed timer."""
        confirmation_times: dict[int, float] = {}
        for period_seconds in (60, 120, 300, 600):
            duration = int(period_seconds * 1.8)
            generated = generate_si_circle_samples(
                start_time_utc=START,
                duration_seconds=duration,
                vehicles=(SimulatedVehicle(1, 101, 0),),
                radius_m=100,
                period_seconds=period_seconds,
                position_noise_std_m=1.0,
                seed=period_seconds,
            )
            # Five-second navigation is enough for this acquisition sweep and
            # keeps the long-period regression computationally bounded.
            samples = tuple(generated[::5])
            confirmed = _confirmation(CoreSession(), samples)
            self.assertIsNotNone(confirmed, f"period={period_seconds}")
            assert confirmed is not None
            elapsed = (confirmed.change_time_utc - START).total_seconds()
            confirmation_times[period_seconds] = elapsed
            self.assertGreaterEqual(elapsed, period_seconds * 0.80)
            self.assertLess(elapsed, period_seconds * 1.80)

        # Explicitly prove that 300 seconds is neither a minimum nor a maximum.
        self.assertLess(confirmation_times[60], 300)
        self.assertLess(confirmation_times[120], 300)
        self.assertGreater(confirmation_times[600], 300)
        self.assertGreater(
            confirmation_times[600],
            confirmation_times[120] * 2.0,
        )

    def test_free_approach_is_excluded_by_shortest_sufficient_suffix(self) -> None:
        """Old approach movement in the 40-minute buffer must not bend the route."""
        route = generate_si_circle_samples(
            start_time_utc=START,
            duration_seconds=210,
            vehicles=(SimulatedVehicle(1, 101, 0),),
            radius_m=100,
            period_seconds=120,
            position_noise_std_m=0.5,
            seed=7,
        )
        first = route[0]
        assert first.latitude_deg is not None
        assert first.longitude_deg is not None

        approach: list[VehicleSample] = []
        approach_seconds = 180
        for index in range(approach_seconds):
            remaining = approach_seconds - index
            longitude = float(first.longitude_deg) - 0.004 * remaining / approach_seconds
            approach.append(
                VehicleSample(
                    sample_time_utc=START - timedelta(seconds=remaining),
                    server_id=first.server_id,
                    vehicle_number=first.vehicle_number,
                    vehicle_identifier=first.vehicle_identifier,
                    active=True,
                    latitude_deg=float(first.latitude_deg),
                    longitude_deg=longitude,
                    velocity_north_mps=0.0,
                    velocity_east_mps=2.0,
                    reliability=1.0,
                )
            )

        combined = tuple(approach) + tuple(route)
        confirmed = _confirmation(CoreSession(), combined)
        self.assertIsNotNone(confirmed)
        assert confirmed is not None

        evidence_start = datetime.fromisoformat(
            str(confirmed.details["evidence_window_start_utc"]).replace("Z", "+00:00")
        )
        self.assertGreaterEqual(evidence_start, START - timedelta(seconds=20))
        self.assertLess(
            float(confirmed.details["evidence_window_seconds"]),
            300.0,
        )
        self.assertEqual(confirmed.details["history_ceiling_seconds"], 2400)
        self.assertGreaterEqual(float(confirmed.details["coverage_fraction"]), 0.82)
        self.assertTrue(bool(confirmed.details["closure_ok"]))


if __name__ == "__main__":
    unittest.main()
