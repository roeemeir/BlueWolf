import math
import unittest

from bluewolf_core.wind import KNOTS_PER_MPS, apply_wind, estimate_wind_from_navigation, wind_vector


class WindEstimatorTests(unittest.TestCase):
    def test_zero_wind(self):
        estimate = estimate_wind_from_navigation(10.0, 0.0, 10.0, 0.0)
        self.assertAlmostEqual(estimate.speed_knots, 0.0, places=8)
        self.assertAlmostEqual(estimate.bearing_deg, 0.0, places=8)

    def test_known_east_wind_in_knots_and_bearing(self):
        measured_north, measured_east = apply_wind(12.0, 0.0, 10.0, 90.0)
        estimate = estimate_wind_from_navigation(12.0, 0.0, measured_north, measured_east)
        self.assertAlmostEqual(estimate.speed_knots, 10.0, places=6)
        self.assertAlmostEqual(estimate.bearing_deg, 90.0, places=6)

    def test_bearing_is_clockwise_from_north(self):
        north, east = wind_vector(7.0, 225.0)
        estimate = estimate_wind_from_navigation(0.0, 0.0, north, east)
        self.assertAlmostEqual(estimate.speed_knots, 7.0, places=6)
        self.assertAlmostEqual(estimate.bearing_deg, 225.0, places=6)

    def test_knots_conversion(self):
        estimate = estimate_wind_from_navigation(0.0, 0.0, 1.0, 0.0)
        self.assertAlmostEqual(estimate.speed_knots, KNOTS_PER_MPS, places=8)

    def test_injected_vector_round_trip(self):
        n, e = wind_vector(14.2, 318.0)
        estimate = estimate_wind_from_navigation(8.0, 135.0, 8.0 * math.cos(math.radians(135.0)) + n, 8.0 * math.sin(math.radians(135.0)) + e)
        self.assertAlmostEqual(estimate.speed_knots, 14.2, places=6)
        self.assertAlmostEqual(estimate.bearing_deg, 318.0, places=6)
        self.assertGreater(estimate.confidence, 0.35)


if __name__ == "__main__":
    unittest.main()
