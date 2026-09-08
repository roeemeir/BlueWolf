from __future__ import annotations

import unittest

import numpy as np

from bluewolf_core.trajectory_simulator import (
    DOUBLE_HIPPODROME_PRIORITY_OPENINGS_DEG,
    NetworkLossConfig,
    NoiseConfig,
    RouteShape,
    SimulationConfig,
    WindConfig,
    double_hippodrome_sweep_angles,
    make_route,
    simulate,
)


# Conformance source: core/docs/ROUTE_GEOMETRY_SPEC_HE.md sections 6, 9-12.


class TrajectorySimulatorTests(unittest.TestCase):
    def test_double_opening_priority_sweep_is_qa_only(self) -> None:
        self.assertEqual(
            DOUBLE_HIPPODROME_PRIORITY_OPENINGS_DEG,
            (10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0),
        )
        full = double_hippodrome_sweep_angles()
        self.assertEqual(full[:7], DOUBLE_HIPPODROME_PRIORITY_OPENINGS_DEG)
        self.assertTrue(any(angle < 10.0 for angle in full))
        self.assertTrue(any(angle > 40.0 for angle in full))

    def test_double_opening_is_not_programmatically_limited_to_priority_range(self) -> None:
        for angle in (5.0, 25.0, 55.0):
            with self.subTest(opening_deg=angle):
                route = make_route(
                    RouteShape.SO_DOUBLE_HIPPODROME,
                    point_count=512,
                    double_opening_deg=angle,
                )
                self.assertIs(route.shape, RouteShape.SO_DOUBLE_HIPPODROME)
                self.assertEqual(route.metadata["opening_deg"], angle)
                self.assertEqual(route.xy_m.shape, (512, 2))
                self.assertTrue(np.all(np.isfinite(route.xy_m)))

    def test_simulator_is_seed_deterministic_with_wind_noise_and_turn_loss(self) -> None:
        route = make_route(
            RouteShape.SO_HIPPODROME,
            point_count=1024,
            rotation_deg=17.0,
        )
        config = SimulationConfig(
            seed=1234,
            sample_interval_s=2.0,
            period_s=260.0,
            route_cycles=1.4,
            wind=WindConfig(max_speed_mps=9.0, response_gain_s=1.2, knot_seconds=35.0),
            network=NetworkLossConfig(
                base_dropout_probability=0.01,
                turn_dropout_probability=0.8,
                turn_burst_count=2,
            ),
            noise=NoiseConfig(gps_std_m=2.0, spike_probability=0.02, spike_std_m=20.0),
        )
        first = simulate(route, config)
        second = simulate(route, config)
        np.testing.assert_allclose(first.truth_xy_m, second.truth_xy_m)
        np.testing.assert_allclose(first.observed_xy_m, second.observed_xy_m)
        np.testing.assert_array_equal(first.observed_mask, second.observed_mask)
        np.testing.assert_allclose(first.wind_xy_mps, second.wind_xy_mps)

    def test_turn_biased_loss_can_remove_turn_samples_without_inventing_points(self) -> None:
        route = make_route(RouteShape.SO_HIPPODROME, point_count=1024)
        trace = simulate(
            route,
            SimulationConfig(
                seed=77,
                sample_interval_s=2.0,
                period_s=240.0,
                route_cycles=1.3,
                network=NetworkLossConfig(
                    base_dropout_probability=0.0,
                    turn_dropout_probability=1.0,
                    turn_burst_count=3,
                    turn_burst_half_width_fraction=0.04,
                ),
            ),
        )
        route_mask = trace.segment == "route"
        observed_route = trace.observed_mask[route_mask]
        self.assertGreater(np.count_nonzero(~observed_route), 0)
        self.assertGreater(np.count_nonzero(observed_route), 0)
        self.assertEqual(trace.observed_xy_m.shape, trace.truth_xy_m.shape)


if __name__ == "__main__":
    unittest.main()
