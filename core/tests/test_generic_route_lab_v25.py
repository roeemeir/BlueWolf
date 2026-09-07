from __future__ import annotations

import unittest
from datetime import UTC, datetime

from bluewolf_core import ChangeKind, CoreSession
from bluewolf_core.simulator import SimulatedVehicle, SimulatedWind
from bluewolf_core.simulator_generic_v25 import generate_closed_polyline_samples


START = datetime(2026, 9, 7, tzinfo=UTC)

# Deliberately asymmetric: this is not presented to the Core as a named route
# family and is not an ideal circle/stadium. The simulator knows only this closed
# ordered polyline and arc-length motion along it.
IRREGULAR_LOOP = (
    (-95.0, -20.0),
    (-55.0, -78.0),
    (25.0, -92.0),
    (108.0, -35.0),
    (82.0, 42.0),
    (18.0, 96.0),
    (-72.0, 68.0),
)

WIND_CASES = (
    None,
    SimulatedWind(steady_north_mps=0.45, steady_east_mps=-0.15, velocity_coupling=0.25),
    SimulatedWind(
        steady_north_mps=-0.20,
        steady_east_mps=0.35,
        gust_amplitude_mps=0.35,
        gust_period_seconds=43.0,
        gust_bearing_deg=70.0,
        velocity_coupling=0.30,
    ),
)


def samples_for(wind, seed: int = 30):
    return generate_closed_polyline_samples(
        points_east_north_m=IRREGULAR_LOOP,
        start_time_utc=START,
        duration_seconds=480,
        period_seconds=150.0,
        vehicles=(SimulatedVehicle(1, 101, 0.0),),
        position_noise_std_m=0.35,
        wind=wind,
        seed=seed,
    )


class GenericClosedRouteLabV25Tests(unittest.TestCase):
    def test_irregular_closed_route_confirms_without_named_shape_assumption(self) -> None:
        for index, wind in enumerate(WIND_CASES):
            with self.subTest(wind=index):
                session = CoreSession()
                result = session.process_batch(samples_for(wind, 30 + index))
                confirmed = [change for change in result.changes if change.kind is ChangeKind.ROUTE_CONFIRMED]
                self.assertTrue(confirmed, "generic closed loop was not confirmed")
                self.assertLess((confirmed[0].change_time_utc - START).total_seconds(), 40 * 60)
                routed = [frame for frame in result.frames if frame.route_id]
                self.assertTrue(routed)
                self.assertIsNotNone(routed[-1].phase)

    def test_generic_route_is_batch_increment_deterministic_under_gusts(self) -> None:
        samples = samples_for(WIND_CASES[-1], 88)
        one = CoreSession()
        one.process_batch(samples)

        incremental = CoreSession()
        for second in range(0, 481, 5):
            part = tuple(
                sample
                for sample in samples
                if second <= (sample.sample_time_utc - START).total_seconds() < second + 5
            )
            incremental.process_batch(part)

        self.assertEqual(incremental.debug_state(), one.debug_state())
        self.assertEqual(incremental.export_checkpoint(), one.export_checkpoint())


if __name__ == "__main__":
    unittest.main()
