from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta

import numpy as np

from bluewolf_core.geometry import local_m_to_wgs84
from bluewolf_core.models import CanonicalPoint, VehicleSample
from bluewolf_core.partial_route_candidate import extract_partial_route_evidence
from bluewolf_core.trajectory_simulator import RouteShape, make_route


START = datetime(2026, 9, 8, 8, 0, tzinfo=UTC)


def _samples(points: np.ndarray, *, missing: set[int] | None = None) -> list[VehicleSample]:
    output: list[VehicleSample] = []
    missing = missing or set()
    for index, point in enumerate(np.asarray(points, dtype=float)):
        if index in missing:
            continue
        latitude, longitude = local_m_to_wgs84(
            CanonicalPoint(float(point[0]), float(point[1])),
            32.0,
            34.8,
        )
        output.append(
            VehicleSample(
                sample_time_utc=START + timedelta(seconds=2 * index),
                server_id=1,
                vehicle_number=4,
                vehicle_identifier=17,
                active=True,
                latitude_deg=latitude,
                longitude_deg=longitude,
                reliability=1.0,
            )
        )
    return output


def _route_arc(
    shape: RouteShape,
    *,
    start_fraction: float,
    route_fraction: float,
    opening_deg: float | None = None,
    sample_count: int = 90,
) -> np.ndarray:
    route = make_route(
        shape,
        point_count=2048,
        rotation_deg=23.0,
        variant=0.35,
        double_opening_deg=opening_deg,
    )
    n = len(route.xy_m)
    start = int(round(start_fraction * n)) % n
    span = max(3, int(round(route_fraction * n)))
    indices = (start + np.linspace(0, span, sample_count, endpoint=True).astype(int)) % n
    return route.xy_m[indices]


def _diag(evidence) -> dict[str, float]:
    return {
        "turn_fraction": float(evidence.turn_fraction),
        "smooth_heading_fraction": float(evidence.smooth_heading_fraction),
        "turn_sign_persistence": float(evidence.turn_sign_persistence),
        "path_efficiency": float(evidence.path_efficiency),
        "contiguous_observation_fraction": float(evidence.contiguous_observation_fraction),
    }


class PartialRouteEvidenceTests(unittest.TestCase):
    def test_partial_circle_has_turn_evidence_without_inventing_period_or_family(self) -> None:
        angle = np.linspace(0.0, 1.10 * math.pi, 72)
        points = np.column_stack((100.0 * np.cos(angle), 100.0 * np.sin(angle)))
        evidence = extract_partial_route_evidence(_samples(points), grid_seconds=2.0)
        self.assertIsNotNone(evidence)
        assert evidence is not None

        self.assertGreater(evidence.turn_fraction, 0.40)
        self.assertGreater(evidence.smooth_heading_fraction, 0.85)
        self.assertGreater(evidence.turn_sign_persistence, 0.85)
        self.assertLess(evidence.path_efficiency, 0.90)
        self.assertEqual(len(evidence.observed_runs), 1)
        self.assertFalse(hasattr(evidence, "period_s"))
        self.assertFalse(hasattr(evidence, "family"))
        self.assertFalse(hasattr(evidence, "topology"))

    def test_straight_approach_has_almost_no_turn_evidence(self) -> None:
        x = np.linspace(0.0, 320.0, 72)
        points = np.column_stack((x, np.zeros_like(x)))
        evidence = extract_partial_route_evidence(_samples(points), grid_seconds=2.0)
        self.assertIsNotNone(evidence)
        assert evidence is not None

        self.assertLess(evidence.turn_fraction, 0.03)
        self.assertGreater(evidence.smooth_heading_fraction, 0.95)
        self.assertGreater(evidence.path_efficiency, 0.80)

    def test_network_outage_stays_as_two_observed_runs(self) -> None:
        angle = np.linspace(0.0, 1.20 * math.pi, 80)
        points = np.column_stack((110.0 * np.cos(angle), 110.0 * np.sin(angle)))
        missing = set(range(30, 42))
        evidence = extract_partial_route_evidence(
            _samples(points, missing=missing),
            grid_seconds=2.0,
        )
        self.assertIsNotNone(evidence)
        assert evidence is not None

        self.assertEqual(len(evidence.observed_runs), 2)
        self.assertLess(evidence.contiguous_observation_fraction, 0.75)
        self.assertTrue(all(len(run) >= 2 for run in evidence.observed_runs))

    def test_seeded_small_gps_zigzag_does_not_look_like_smooth_route_turning(self) -> None:
        rng = np.random.default_rng(44)
        points = np.cumsum(rng.normal(0.0, 1.0, size=(90, 2)), axis=0)
        evidence = extract_partial_route_evidence(_samples(points), grid_seconds=2.0)
        self.assertIsNotNone(evidence)
        assert evidence is not None

        self.assertTrue(
            evidence.smooth_heading_fraction < 0.80
            or evidence.turn_sign_persistence < 0.75,
            msg=f"random-walk diagnostics: {_diag(evidence)}",
        )

    def test_candidate_features_scale_with_observed_route_fraction_not_elapsed_time(self) -> None:
        """Calibration bank for an evidence gate; this test encodes no timer."""

        measured: list[tuple[float, float, float, float]] = []
        for route_fraction in (0.20, 0.30, 0.40, 0.50, 0.65):
            angle = np.linspace(0.0, 2.0 * math.pi * route_fraction, 80)
            points = np.column_stack((100.0 * np.cos(angle), 100.0 * np.sin(angle)))
            evidence = extract_partial_route_evidence(_samples(points), grid_seconds=2.0)
            self.assertIsNotNone(evidence)
            assert evidence is not None
            measured.append(
                (
                    route_fraction,
                    evidence.turn_fraction,
                    evidence.path_efficiency,
                    evidence.turn_sign_persistence,
                )
            )
            self.assertGreater(evidence.smooth_heading_fraction, 0.85)
            if route_fraction >= 0.30:
                self.assertGreater(evidence.turn_sign_persistence, 0.80)

        turn = [item[1] for item in measured]
        efficiency = [item[2] for item in measured]
        self.assertTrue(all(next_value > value for value, next_value in zip(turn, turn[1:])))
        self.assertTrue(all(next_value < value for value, next_value in zip(efficiency, efficiency[1:])))
        forty = measured[2]
        self.assertGreater(forty[1], 0.30)
        self.assertLess(forty[2], 0.90)

    def test_partial_candidate_features_reject_non_route_motion_bank(self) -> None:
        """Keep obvious non-route motion separated before choosing a gate."""

        x = np.linspace(0.0, 420.0, 100)
        straight = np.column_stack((x, 0.02 * x))
        straight_evidence = extract_partial_route_evidence(_samples(straight), grid_seconds=2.0)
        self.assertIsNotNone(straight_evidence)
        assert straight_evidence is not None
        self.assertLess(straight_evidence.turn_fraction, 0.05)
        self.assertGreater(straight_evidence.path_efficiency, 0.80)

        rng = np.random.default_rng(712)
        noisy_drift = np.column_stack(
            (
                np.linspace(0.0, 180.0, 100),
                np.cumsum(rng.normal(0.0, 2.0, size=100)),
            )
        )
        drift_evidence = extract_partial_route_evidence(_samples(noisy_drift), grid_seconds=2.0)
        self.assertIsNotNone(drift_evidence)
        assert drift_evidence is not None
        self.assertTrue(
            drift_evidence.turn_fraction < 0.30
            or drift_evidence.smooth_heading_fraction < 0.85
            or drift_evidence.turn_sign_persistence < 0.75
            or drift_evidence.path_efficiency > 0.90,
            msg=f"noisy-drift diagnostics: {_diag(drift_evidence)}",
        )

    def test_partial_route_feature_ranges_across_approved_families(self) -> None:
        """Collect calibration evidence across shapes and phase origins.

        This test intentionally does not define the final candidate gate. It
        guarantees that the topology-neutral extractor produces finite evidence
        on partial arcs of every approved V2 family before that gate is chosen.
        """

        cases = (
            (RouteShape.SI_CIRCLE, None),
            (RouteShape.SI_FREE_CLOSED, None),
            (RouteShape.SO_HIPPODROME, None),
            (RouteShape.SO_DOUBLE_HIPPODROME, 25.0),
            (RouteShape.SO_DOUBLE_HIPPODROME, 55.0),
            (RouteShape.SO_FIGURE_EIGHT, None),
        )
        for shape, opening in cases:
            for start_fraction in (0.00, 0.17, 0.41, 0.73):
                for route_fraction in (0.35, 0.45, 0.55):
                    with self.subTest(
                        shape=shape,
                        opening=opening,
                        start=start_fraction,
                        fraction=route_fraction,
                    ):
                        points = _route_arc(
                            shape,
                            start_fraction=start_fraction,
                            route_fraction=route_fraction,
                            opening_deg=opening,
                        )
                        evidence = extract_partial_route_evidence(
                            _samples(points), grid_seconds=2.0
                        )
                        self.assertIsNotNone(evidence)
                        assert evidence is not None
                        values = _diag(evidence)
                        self.assertTrue(all(math.isfinite(value) for value in values.values()))
                        self.assertGreater(evidence.observed_travel_m, 0.0)
                        self.assertFalse(hasattr(evidence, "period_s"))
                        print(
                            "PARTIAL_ROUTE_DIAG",
                            shape.value,
                            opening,
                            start_fraction,
                            route_fraction,
                            values,
                        )


if __name__ == "__main__":
    unittest.main()
