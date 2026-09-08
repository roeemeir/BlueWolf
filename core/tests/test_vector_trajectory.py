from __future__ import annotations

import unittest

import numpy as np

from bluewolf_core.trajectory_simulator import (
    NetworkLossConfig,
    NoiseConfig,
    RouteShape,
    SimulationConfig,
    WindConfig,
    make_route,
    simulate,
)
from bluewolf_core.vector_trajectory import VectorTrack, extract_periodic_evidence, estimate_period


class VectorTrajectoryTests(unittest.TestCase):
    def _track(self, shape: RouteShape, *, seed: int = 1, severe_turn_loss: bool = False) -> VectorTrack:
        route = make_route(shape, point_count=1024, rotation_deg=17.0)
        trace = simulate(
            route,
            SimulationConfig(
                seed=seed,
                sample_interval_s=2.0,
                period_s=240.0,
                route_cycles=1.7,
                approach_duration_s=70.0,
                exit_duration_s=50.0,
                wind=WindConfig(max_speed_mps=7.0, response_gain_s=0.8),
                noise=NoiseConfig(gps_std_m=1.5, spike_probability=0.005),
                network=NetworkLossConfig(
                    base_dropout_probability=0.01,
                    turn_dropout_probability=0.90 if severe_turn_loss else 0.30,
                    turn_burst_count=3 if severe_turn_loss else 1,
                    turn_burst_half_width_fraction=0.025,
                ),
            ),
        )
        return VectorTrack(
            time_s=trace.time_s,
            xy_m=trace.observed_xy_m,
            observed_mask=trace.observed_mask,
        )

    def test_fft_period_estimator_uses_recurrence_not_elapsed_timer(self) -> None:
        track = self._track(RouteShape.SI_CIRCLE, seed=12)
        period = estimate_period(track)
        self.assertIsNotNone(period)
        assert period is not None
        self.assertLess(abs(period.period_s - 240.0), 12.0)
        self.assertGreater(period.support_pairs, 20)

    def test_period_survives_turn_biased_hippodrome_data_loss(self) -> None:
        track = self._track(RouteShape.SO_HIPPODROME, seed=22, severe_turn_loss=True)
        period = estimate_period(track)
        self.assertIsNotNone(period)
        assert period is not None
        self.assertLess(abs(period.period_s - 240.0), 18.0)

    def test_periodic_support_excludes_most_approach_and_exit(self) -> None:
        route = make_route(RouteShape.SO_HIPPODROME, point_count=1024)
        config = SimulationConfig(
            seed=33,
            sample_interval_s=2.0,
            period_s=240.0,
            route_cycles=1.8,
            approach_duration_s=90.0,
            exit_duration_s=70.0,
            network=NetworkLossConfig(turn_dropout_probability=0.4, turn_burst_count=1),
        )
        trace = simulate(route, config)
        track = VectorTrack(trace.time_s, trace.observed_xy_m, trace.observed_mask)
        evidence = extract_periodic_evidence(track)
        self.assertIsNotNone(evidence)
        assert evidence is not None
        route_segment = trace.segment == "route"
        non_route_segment = ~route_segment
        route_support = np.mean(evidence.periodic_mask[route_segment])
        non_route_support = np.mean(evidence.periodic_mask[non_route_segment])
        self.assertGreater(route_support, non_route_support + 0.25)

    def test_folded_axes_keep_compact_si_separate_from_single_hippodrome(self) -> None:
        si = extract_periodic_evidence(self._track(RouteShape.SI_FREE_CLOSED, seed=44))
        so = extract_periodic_evidence(self._track(RouteShape.SO_HIPPODROME, seed=45))
        self.assertIsNotNone(si)
        self.assertIsNotNone(so)
        assert si is not None and so is not None
        self.assertLessEqual(si.axis_ratio, 1.5)
        self.assertGreater(so.axis_ratio, 1.5)


if __name__ == "__main__":
    unittest.main()
