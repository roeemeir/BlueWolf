from __future__ import annotations

import time
import unittest

from bluewolf_core.models import RouteFamily, RouteSubtype
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


class RouteClassifierRobustnessSweepTests(unittest.TestCase):
    """Small deterministic QA sweep derived only from approved requirements.

    This intentionally varies acquisition conditions, not product geometry laws.
    Double-Hippodrome angles outside the priority QA range remain legal.
    """

    def _run_case(
        self,
        *,
        shape: RouteShape,
        expected_family: RouteFamily,
        expected_subtype: RouteSubtype,
        seed: int,
        dt_s: float,
        rotation_deg: float,
        period_s: float = 240.0,
        route_cycles: float = 1.8,
        opening_deg: float | None = None,
        wind_mps: float = 7.0,
        wind_gain_s: float = 0.8,
        gps_std_m: float = 1.5,
        spike_probability: float = 0.005,
        turn_dropout: float = 0.35,
        turn_bursts: int = 1,
    ) -> float:
        route = make_route(
            shape,
            point_count=1024,
            rotation_deg=rotation_deg,
            variant=0.45,
            double_opening_deg=opening_deg,
        )
        trace = simulate(
            route,
            SimulationConfig(
                seed=seed,
                sample_interval_s=dt_s,
                period_s=period_s,
                route_cycles=route_cycles,
                approach_duration_s=70.0,
                exit_duration_s=55.0,
                wind=WindConfig(
                    max_speed_mps=wind_mps,
                    response_gain_s=wind_gain_s,
                    knot_seconds=37.0,
                ),
                noise=NoiseConfig(
                    gps_std_m=gps_std_m,
                    spike_probability=spike_probability,
                    spike_std_m=22.0,
                ),
                network=NetworkLossConfig(
                    base_dropout_probability=0.01,
                    turn_dropout_probability=turn_dropout,
                    turn_burst_count=turn_bursts,
                    turn_burst_half_width_fraction=0.03,
                ),
            ),
        )
        track = VectorTrack(trace.time_s, trace.observed_xy_m, trace.observed_mask)
        started = time.perf_counter()
        evidence = extract_periodic_evidence(track)
        self.assertIsNotNone(evidence)
        assert evidence is not None
        result = classify_route(track, evidence)
        elapsed = time.perf_counter() - started
        diagnostics = dict(result.diagnostics)
        message = (
            f"shape={shape.value} opening={opening_deg} dt={dt_s} seed={seed} "
            f"got={result.family.value}/{result.subtype.value} diagnostics={diagnostics}"
        )
        self.assertEqual(result.family, expected_family, msg=message)
        self.assertEqual(result.subtype, expected_subtype, msg=message)
        self.assertLess(
            abs(result.period_s - period_s),
            max(18.0, 0.08 * period_s),
            msg=message,
        )
        return elapsed

    def test_sample_interval_rotation_wind_and_noise_sweep(self) -> None:
        cases = (
            (RouteShape.SI_CIRCLE, RouteFamily.SI, RouteSubtype.COMPACT, 1.0, 0.0, 101),
            (RouteShape.SI_OCTAGON, RouteFamily.SI, RouteSubtype.COMPACT, 2.0, 31.0, 102),
            (RouteShape.SI_FREE_CLOSED, RouteFamily.SI, RouteSubtype.COMPACT, 5.0, -22.0, 103),
            (RouteShape.SO_HIPPODROME, RouteFamily.SO, RouteSubtype.HIPPODROME, 1.0, 47.0, 104),
            (RouteShape.SO_HIPPODROME, RouteFamily.SO, RouteSubtype.HIPPODROME, 5.0, -35.0, 105),
            (RouteShape.SO_FIGURE_EIGHT, RouteFamily.SO, RouteSubtype.FIGURE_EIGHT, 2.0, 18.0, 106),
        )
        elapsed = 0.0
        for shape, family, subtype, dt_s, rotation, seed in cases:
            with self.subTest(shape=shape, dt_s=dt_s, rotation=rotation):
                elapsed += self._run_case(
                    shape=shape,
                    expected_family=family,
                    expected_subtype=subtype,
                    seed=seed,
                    dt_s=dt_s,
                    rotation_deg=rotation,
                    wind_mps=9.0,
                    wind_gain_s=1.0,
                    gps_std_m=2.0,
                    spike_probability=0.01,
                )
        # Generous regression budget for shared CI runners. This is not a product
        # latency requirement; it only catches accidental algorithmic explosions.
        self.assertLess(elapsed, 20.0)

    def test_double_priority_and_outside_priority_openings(self) -> None:
        for index, angle in enumerate((10.0, 25.0, 40.0, 55.0), start=1):
            with self.subTest(opening_deg=angle):
                self._run_case(
                    shape=RouteShape.SO_DOUBLE_HIPPODROME,
                    expected_family=RouteFamily.SO,
                    expected_subtype=RouteSubtype.DOUBLE_HIPPODROME,
                    seed=200 + index,
                    dt_s=2.0 if index < 4 else 5.0,
                    rotation_deg=-30.0 + 17.0 * index,
                    opening_deg=angle,
                    wind_mps=8.0,
                    gps_std_m=1.8,
                    turn_dropout=0.30,
                )

    def test_hippodrome_can_survive_nearly_missing_turns(self) -> None:
        # Operational requirement: vehicles can disconnect specifically in turns,
        # leaving the server mostly two recurrent legs with large gaps between them.
        self._run_case(
            shape=RouteShape.SO_HIPPODROME,
            expected_family=RouteFamily.SO,
            expected_subtype=RouteSubtype.HIPPODROME,
            seed=333,
            dt_s=2.0,
            rotation_deg=26.0,
            route_cycles=2.2,
            wind_mps=6.0,
            wind_gain_s=0.7,
            gps_std_m=1.5,
            spike_probability=0.003,
            turn_dropout=0.98,
            turn_bursts=4,
        )


if __name__ == "__main__":
    unittest.main()
