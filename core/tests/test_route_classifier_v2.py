from __future__ import annotations

import unittest

from bluewolf_core.models import RouteFamily, RouteSubtype, RouteTopology
from bluewolf_core.route_classifier_v2 import classify_route
from bluewolf_core.trajectory_simulator import (
    NetworkLossConfig,
    NoiseConfig,
    RouteShape,
    SimulationConfig,
    WindConfig,
    make_route,
    simulate,
)
from bluewolf_core.vector_trajectory import VectorTrack, extract_periodic_evidence


class RouteClassifierV2Tests(unittest.TestCase):
    def _classify(
        self,
        shape: RouteShape,
        *,
        seed: int,
        double_opening_deg: float | None = None,
        turn_loss: float = 0.35,
        turn_bursts: int = 1,
    ):
        route = make_route(
            shape,
            point_count=1024,
            rotation_deg=23.0,
            variant=0.35,
            double_opening_deg=double_opening_deg,
        )
        trace = simulate(
            route,
            SimulationConfig(
                seed=seed,
                sample_interval_s=2.0,
                period_s=240.0,
                route_cycles=1.8,
                approach_duration_s=70.0,
                exit_duration_s=50.0,
                wind=WindConfig(max_speed_mps=5.0, response_gain_s=0.6),
                noise=NoiseConfig(gps_std_m=1.0, spike_probability=0.003),
                network=NetworkLossConfig(
                    base_dropout_probability=0.005,
                    turn_dropout_probability=turn_loss,
                    turn_burst_count=turn_bursts,
                    turn_burst_half_width_fraction=0.02,
                ),
            ),
        )
        track = VectorTrack(trace.time_s, trace.observed_xy_m, trace.observed_mask)
        evidence = extract_periodic_evidence(track)
        self.assertIsNotNone(evidence)
        assert evidence is not None
        return classify_route(track, evidence)

    def test_si_circle_octagon_and_free_closed_remain_compact_si(self) -> None:
        for index, shape in enumerate(
            (RouteShape.SI_CIRCLE, RouteShape.SI_OCTAGON, RouteShape.SI_FREE_CLOSED),
            start=1,
        ):
            with self.subTest(shape=shape):
                result = self._classify(shape, seed=100 + index, turn_loss=0.15)
                self.assertEqual(result.family, RouteFamily.SI)
                self.assertEqual(result.subtype, RouteSubtype.COMPACT)
                self.assertEqual(result.topology, RouteTopology.SIMPLE)

    def test_single_hippodrome_is_not_accepted_merely_for_being_elongated(self) -> None:
        result = self._classify(RouteShape.SO_HIPPODROME, seed=210)
        self.assertEqual(result.family, RouteFamily.SO)
        self.assertEqual(result.subtype, RouteSubtype.HIPPODROME)
        self.assertEqual(result.topology, RouteTopology.SIMPLE)

    def test_soft_figure_eight_uses_supported_self_crossing(self) -> None:
        result = self._classify(RouteShape.SO_FIGURE_EIGHT, seed=310, turn_loss=0.25)
        self.assertEqual(result.family, RouteFamily.SO)
        self.assertEqual(result.subtype, RouteSubtype.FIGURE_EIGHT)
        self.assertEqual(result.topology, RouteTopology.SELF_CROSSING)
        self.assertGreaterEqual(int(result.diagnostics["supported_crossings"]), 1)

    def test_double_hippodrome_priority_angles_are_model_evidence_not_gates(self) -> None:
        for index, angle in enumerate((10.0, 20.0, 30.0, 40.0), start=1):
            with self.subTest(opening_deg=angle):
                result = self._classify(
                    RouteShape.SO_DOUBLE_HIPPODROME,
                    seed=400 + index,
                    double_opening_deg=angle,
                    turn_loss=0.25,
                )
                self.assertEqual(result.family, RouteFamily.SO)
                self.assertEqual(result.subtype, RouteSubtype.DOUBLE_HIPPODROME)
                self.assertEqual(result.topology, RouteTopology.DOUBLE)

    def test_double_hippodrome_outside_priority_sweep_is_not_rejected_by_angle(self) -> None:
        result = self._classify(
            RouteShape.SO_DOUBLE_HIPPODROME,
            seed=510,
            double_opening_deg=55.0,
            turn_loss=0.25,
        )
        self.assertEqual(result.subtype, RouteSubtype.DOUBLE_HIPPODROME)
        fitted_angle = float(result.diagnostics["opening_deg"])
        self.assertGreaterEqual(fitted_angle, 0.0)
        self.assertLess(fitted_angle, 180.0)


if __name__ == "__main__":
    unittest.main()
