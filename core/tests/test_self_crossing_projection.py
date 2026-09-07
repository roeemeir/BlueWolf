from __future__ import annotations

import unittest

from bluewolf_core.geometry import circular_phase_distance
from bluewolf_core.models import CanonicalPoint
from bluewolf_core.self_crossing_projection import project_self_crossing_polyline


class SelfCrossingProjectionTests(unittest.TestCase):
    def test_heading_selects_the_correct_branch_at_same_position(self) -> None:
        points = (
            CanonicalPoint(-2.0, -2.0),
            CanonicalPoint(0.0, 0.0),
            CanonicalPoint(2.0, 2.0),
            CanonicalPoint(2.0, -2.0),
            CanonicalPoint(0.0, 0.0),
            CanonicalPoint(-2.0, 2.0),
        )
        query = CanonicalPoint(0.0, 0.0)

        rising = project_self_crossing_polyline(
            points,
            query,
            1.0,
            1.0,
            ambiguity_distance_m=0.1,
        )
        falling = project_self_crossing_polyline(
            points,
            query,
            -1.0,
            1.0,
            ambiguity_distance_m=0.1,
        )

        self.assertLess(abs(rising.tangent_east - 2**-0.5), 1e-9)
        self.assertLess(abs(falling.tangent_east + 2**-0.5), 1e-9)
        self.assertGreater(circular_phase_distance(rising.phase, falling.phase), 0.25)

    def test_zero_velocity_is_rejected(self) -> None:
        points = (
            CanonicalPoint(-1.0, 0.0),
            CanonicalPoint(0.0, 1.0),
            CanonicalPoint(1.0, 0.0),
            CanonicalPoint(0.0, -1.0),
        )
        with self.assertRaises(ValueError):
            project_self_crossing_polyline(
                points,
                CanonicalPoint(0.0, 0.0),
                0.0,
                0.0,
                ambiguity_distance_m=0.5,
            )


if __name__ == "__main__":
    unittest.main()
