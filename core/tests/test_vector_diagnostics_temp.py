from __future__ import annotations

import unittest

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
from bluewolf_core.vector_trajectory import VectorTrack, estimate_period, extract_periodic_evidence


class TemporaryVectorDiagnostics(unittest.TestCase):
    def test_print_calibration_matrix(self) -> None:
        cases = [
            ("circle", RouteShape.SI_CIRCLE, 101, None, 0.15, 1),
            ("octagon", RouteShape.SI_OCTAGON, 102, None, 0.15, 1),
            ("free_si", RouteShape.SI_FREE_CLOSED, 103, None, 0.15, 1),
            ("hippo", RouteShape.SO_HIPPODROME, 210, None, 0.35, 1),
            ("figure8", RouteShape.SO_FIGURE_EIGHT, 310, None, 0.25, 1),
            ("double10", RouteShape.SO_DOUBLE_HIPPODROME, 401, 10.0, 0.25, 1),
            ("double20", RouteShape.SO_DOUBLE_HIPPODROME, 402, 20.0, 0.25, 1),
            ("double30", RouteShape.SO_DOUBLE_HIPPODROME, 403, 30.0, 0.25, 1),
            ("double40", RouteShape.SO_DOUBLE_HIPPODROME, 404, 40.0, 0.25, 1),
            ("double55", RouteShape.SO_DOUBLE_HIPPODROME, 510, 55.0, 0.25, 1),
        ]
        print("\n=== VECTOR CALIBRATION MATRIX ===")
        for name, shape, seed, opening, turn_loss, bursts in cases:
            route = make_route(
                shape,
                point_count=1024,
                rotation_deg=23.0,
                variant=0.35,
                double_opening_deg=opening,
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
                        turn_burst_count=bursts,
                        turn_burst_half_width_fraction=0.02,
                    ),
                ),
            )
            track = VectorTrack(trace.time_s, trace.observed_xy_m, trace.observed_mask)
            period = estimate_period(track)
            print(
                f"CASE {name}: observed={track.observed_mask.sum()}/{len(track.observed_mask)} "
                f"period={None if period is None else round(period.period_s, 2)} "
                f"period_mse={None if period is None else round(period.recurrence_mse_m2, 2)} "
                f"period_pairs={None if period is None else period.support_pairs}"
            )
            evidence = extract_periodic_evidence(track)
            if evidence is None:
                print(f"CASE {name}: EVIDENCE=None")
                continue
            result = classify_route(track, evidence)
            print(
                f"CASE {name}: axis_ratio={evidence.axis_ratio:.3f} "
                f"support={evidence.canonical_support_fraction:.3f} "
                f"classified={result.family.value}/{result.subtype.value} "
                f"diag={dict(result.diagnostics)}"
            )
        print("=== END VECTOR CALIBRATION MATRIX ===\n")
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
