from __future__ import annotations

import math
import unittest
from types import SimpleNamespace

from bluewolf_core import application_analysis_v19 as v19


PROVENANCE = {"completenessPct": 100.0}


def _sample(x: float, y: float, heading_deg: float, speed: float = 10.0) -> dict[str, float]:
    angle = math.radians(heading_deg)
    return {
        "x": x,
        "y": y,
        "velocityEast": math.sin(angle) * speed,
        "velocityNorth": math.cos(angle) * speed,
    }


def _line(start: tuple[float, float], heading_deg: float, length: float, count: int) -> list[dict[str, float]]:
    angle = math.radians(heading_deg)
    return [
        _sample(
            start[0] + math.sin(angle) * length * index / max(1, count - 1),
            start[1] + math.cos(angle) * length * index / max(1, count - 1),
            heading_deg,
        )
        for index in range(count)
    ]


def _articulated_track(current_east_extra: float = 0.0):
    # Global point density is dominated by an east-west arm (bearing 90°), while
    # the current vehicle is on a 60° branch. The first 80% still contains a
    # previous traversal of that branch so local NAV tangent evidence exists.
    samples = [
        *_line((-120.0, 0.0), 90.0, 240.0, 45),
        *_line((0.0, 0.0), 60.0, 120.0, 22),
        *_line((-120.0, 6.0), 90.0, 240.0, 35),
        *_line((0.0, 0.0), 60.0, 120.0, 24),
    ]
    current = dict(samples[-1])
    current["velocityEast"] += current_east_extra
    samples[-1] = current
    fit = v19._base._pca(samples)
    return SimpleNamespace(
        vehicle_id=611,
        kind="double",
        samples=samples,
        current=current,
        fit=fit,
        direction=1,
        route_score=95.0,
    )


class WindEstimateV19Tests(unittest.TestCase):
    def test_local_tangent_removes_articulation_from_disturbance_residual(self) -> None:
        track = _articulated_track()
        legacy = v19._ORIGINAL_WIND_ESTIMATE(track, PROVENANCE)
        refined = v19._wind_estimate_v19(track, PROVENANCE)
        self.assertGreater(legacy["speedKnots"], 5.0)
        self.assertLess(refined["speedKnots"], 0.5)

    def test_small_measured_velocity_residual_stays_small_and_physical(self) -> None:
        track = _articulated_track(current_east_extra=1.0)
        refined = v19._wind_estimate_v19(track, PROVENANCE)
        self.assertAlmostEqual(refined["residualEast"], 1.0, delta=0.25)
        self.assertAlmostEqual(refined["residualNorth"], 0.0, delta=0.25)
        self.assertAlmostEqual(refined["speedKnots"], 1.9438444924406, delta=0.6)

    def test_local_heading_selects_current_branch_not_global_pca_axis(self) -> None:
        track = _articulated_track()
        heading = v19._local_route_heading(track)
        self.assertIsNotNone(heading)
        self.assertLess(abs(v19._base._wrap180(float(heading) - 60.0)), 6.0)


if __name__ == "__main__":
    unittest.main()
