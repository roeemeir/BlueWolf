from __future__ import annotations

import math
import unittest
from types import SimpleNamespace

from bluewolf_core import application_analysis_v20 as analysis


def _sample(index: int, east: float, north: float = 0.0) -> dict:
    return {
        "timestamp": f"2026-09-07T00:{index // 60:02d}:{index % 60:02d}.000Z",
        "x": float(index) * 10.0,
        "y": 0.0,
        "latitude": 31.8,
        "longitude": 34.8,
        "velocityEast": east,
        "velocityNorth": north,
    }


class DisturbanceEstimatorV20Tests(unittest.TestCase):
    def test_small_disturbance_keeps_vector_direction_on_local_leg(self) -> None:
        # Nominal vehicle motion is 10 m/s east. The final sample contains a
        # 0.5 m/s disturbance at bearing 259° (mostly west, slightly south).
        # Historical same-leg NAV must teach the nominal speed rather than
        # allowing the disturbance itself to contaminate the expected vector.
        training = [_sample(index, 10.0) for index in range(24)]
        disturbance_speed = 0.5
        disturbance_bearing = math.radians(259.0)
        disturbance_east = math.sin(disturbance_bearing) * disturbance_speed
        disturbance_north = math.cos(disturbance_bearing) * disturbance_speed
        current = _sample(24, 10.0 + disturbance_east, disturbance_north)
        samples = [*training, current]
        track = SimpleNamespace(
            kind="single",
            samples=samples,
            current=current,
            route_score=95.0,
            fit=SimpleNamespace(minor_span=40.0),
        )

        estimate = analysis._wind_estimate_v20(track, {"completenessPct": 100.0})
        bearing_error = abs(((estimate["bearingDeg"] - 259.0 + 180.0) % 360.0) - 180.0)

        self.assertAlmostEqual(estimate["speedKnots"], disturbance_speed * 1.9438444924406, delta=0.15)
        self.assertLess(bearing_error, 12.0)
        self.assertGreater(estimate["confidencePct"], 80.0)

    def test_estimator_source_has_no_simulator_ground_truth_dependency(self) -> None:
        import inspect

        source = inspect.getsource(analysis)
        self.assertNotIn("simulatorGroundTruth", source)
        self.assertNotIn("simulatorInjectedDisturbance", source)


if __name__ == "__main__":
    unittest.main()
