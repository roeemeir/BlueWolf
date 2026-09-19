from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from bluewolf_core.geometry import local_m_to_wgs84
from bluewolf_core.models import CanonicalPoint, Direction, RouteFamily, RouteSubtype, RouteTopology, VehicleSample
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
from bluewolf_core.vector_route_detection import detect_closed_route_vector
from bluewolf_core.vector_sample_adapter import build_vector_track
from bluewolf_core.vector_trajectory import extract_periodic_evidence


class VectorRouteDetectionAdapterTests(unittest.TestCase):
    def _vehicle_samples(
        self,
        shape: RouteShape,
        *,
        seed: int,
        opening_deg: float | None = None,
        turn_dropout: float = 0.25,
        turn_bursts: int = 1,
        route_cycles: float = 1.9,
        dt_s: float = 2.0,
    ) -> list[VehicleSample]:
        route = make_route(
            shape,
            point_count=1024,
            rotation_deg=27.0,
            variant=0.40,
            double_opening_deg=opening_deg,
        )
        trace = simulate(
            route,
            SimulationConfig(
                seed=seed,
                sample_interval_s=dt_s,
                period_s=240.0,
                route_cycles=route_cycles,
                approach_duration_s=70.0,
                exit_duration_s=50.0,
                wind=WindConfig(max_speed_mps=6.0, response_gain_s=0.7, knot_seconds=39.0),
                noise=NoiseConfig(gps_std_m=1.2, spike_probability=0.004, spike_std_m=20.0),
                network=NetworkLossConfig(
                    base_dropout_probability=0.005,
                    turn_dropout_probability=turn_dropout,
                    turn_burst_count=turn_bursts,
                    turn_burst_half_width_fraction=0.03,
                ),
            ),
        )
        start = datetime(2026, 9, 8, 8, 0, tzinfo=UTC)
        samples: list[VehicleSample] = []
        for index, visible in enumerate(trace.observed_mask):
            if not visible:
                # Real network loss means no server sample exists at this time.
                continue
            point = trace.observed_xy_m[index]
            latitude, longitude = local_m_to_wgs84(
                CanonicalPoint(float(point[0]), float(point[1])),
                32.0,
                34.8,
            )
            samples.append(
                VehicleSample(
                    sample_time_utc=start + timedelta(seconds=float(trace.time_s[index])),
                    server_id=1,
                    vehicle_number=4,
                    vehicle_identifier=17,
                    active=True,
                    latitude_deg=latitude,
                    longitude_deg=longitude,
                    reliability=1.0,
                )
            )
        return samples

    def _classification_diagnostics(
        self,
        samples: list[VehicleSample],
        *,
        grid_seconds: float,
    ) -> dict[str, object]:
        prepared = build_vector_track(samples, grid_seconds=grid_seconds)
        if prepared is None:
            return {"prepared": False}
        evidence = extract_periodic_evidence(
            prepared.track,
            minimum_period_s=max(2.0 * prepared.grid_seconds, 20.0),
            canonical_bins=64,
        )
        if evidence is None:
            return {"prepared": True, "periodic_evidence": False}
        result = classify_route(prepared.track, evidence)
        return {
            "prepared": True,
            "periodic_evidence": True,
            "family": result.family.value,
            "subtype": result.subtype.value,
            "topology": result.topology.value,
            "axis_ratio": result.axis_ratio,
            "period_s": result.period_s,
            **dict(result.diagnostics),
        }

    def test_compact_free_si_preserves_generic_centerline_contract(self) -> None:
        detection = detect_closed_route_vector(
            self._vehicle_samples(RouteShape.SI_FREE_CLOSED, seed=701),
            grid_seconds=2.0,
        )
        self.assertIsNotNone(detection)
        assert detection is not None
        route = detection.effective
        self.assertEqual(route.family, RouteFamily.SI)
        self.assertEqual(route.subtype, RouteSubtype.COMPACT)
        self.assertLessEqual(route.long_axis_a_m / route.short_axis_b_m, 1.5)
        self.assertEqual(len(route.canonical_points), 64)
        self.assertEqual(detection.diagnostics["detector"], "vector_v2")

    def test_single_hippodrome_confirms_even_when_turn_samples_are_nearly_absent(self) -> None:
        samples = self._vehicle_samples(
            RouteShape.SO_HIPPODROME,
            seed=702,
            turn_dropout=0.98,
            turn_bursts=4,
            route_cycles=2.3,
        )
        detection = detect_closed_route_vector(samples, grid_seconds=2.0)
        classification = self._classification_diagnostics(samples, grid_seconds=2.0)
        self.assertIsNotNone(
            detection,
            msg=f"sparse-turn classification diagnostics: {classification}",
        )
        assert detection is not None
        self.assertEqual(detection.effective.family, RouteFamily.SO)
        self.assertEqual(
            detection.effective.subtype,
            RouteSubtype.HIPPODROME,
            msg=f"sparse-turn diagnostics: {dict(detection.diagnostics)}",
        )
        self.assertTrue(bool(detection.diagnostics["closure_ok"]))
        self.assertGreater(int(detection.diagnostics["period_support_pairs"]), 8)

    def test_double_opening_is_geometry_evidence_not_an_acceptance_range(self) -> None:
        for index, angle in enumerate((25.0, 55.0), start=1):
            with self.subTest(opening_deg=angle):
                samples = self._vehicle_samples(
                    RouteShape.SO_DOUBLE_HIPPODROME,
                    seed=710 + index,
                    opening_deg=angle,
                )
                detection = detect_closed_route_vector(samples, grid_seconds=2.0)
                classification = self._classification_diagnostics(samples, grid_seconds=2.0)
                self.assertIsNotNone(
                    detection,
                    msg=f"Double {angle} classification diagnostics: {classification}",
                )
                assert detection is not None
                self.assertEqual(
                    detection.effective.subtype,
                    RouteSubtype.DOUBLE_HIPPODROME,
                    msg=(
                        f"Double {angle} diagnostics: {dict(detection.diagnostics)}; "
                        f"classification={classification}"
                    ),
                )
                self.assertEqual(detection.effective.topology, RouteTopology.DOUBLE)

    def test_figure_eight_keeps_self_crossing_topology_without_inventing_global_rotation(self) -> None:
        detection = detect_closed_route_vector(
            self._vehicle_samples(RouteShape.SO_FIGURE_EIGHT, seed=720),
            grid_seconds=2.0,
        )
        self.assertIsNotNone(detection)
        assert detection is not None
        self.assertEqual(detection.effective.subtype, RouteSubtype.FIGURE_EIGHT)
        self.assertEqual(detection.effective.topology, RouteTopology.SELF_CROSSING)
        self.assertEqual(detection.effective.direction, Direction.UNKNOWN)


if __name__ == "__main__":
    unittest.main()
