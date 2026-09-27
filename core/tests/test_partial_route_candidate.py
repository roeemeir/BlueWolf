from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta

import numpy as np

from bluewolf_core.geometry import local_m_to_wgs84
from bluewolf_core.models import CanonicalPoint, VehicleSample
from bluewolf_core.partial_route_candidate import (
    extract_partial_route_evidence,
    partial_candidate_ready,
)
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

        self.assertTrue(partial_candidate_ready(evidence))
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

        self.assertFalse(partial_candidate_ready(evidence))
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
        self.assertTrue(partial_candidate_ready(evidence), msg=f"outage diagnostics: {_diag(evidence)}")

    def test_seeded_small_gps_zigzag_is_not_a_candidate(self) -> None:
        rng = np.random.default_rng(44)
        points = np.cumsum(rng.normal(0.0, 1.0, size=(90, 2)), axis=0)
        evidence = extract_partial_route_evidence(_samples(points), grid_seconds=2.0)
        self.assertIsNotNone(evidence)
        assert evidence is not None

        self.assertFalse(
            partial_candidate_ready(evidence),
            msg=f"random-walk diagnostics: {_diag(evidence)}",
        )

    def test_candidate_features_scale_with_observed_route_fraction_not_elapsed_time(self) -> None:
        """Evidence becomes sufficient from geometry, not a wall-clock delay."""

        ready_by_fraction: dict[float, bool] = {}
        measured: list[tuple[float, float, float, float]] = []
        for route_fraction in (0.20, 0.30, 0.40, 0.50, 0.65):
            angle = np.linspace(0.0, 2.0 * math.pi * route_fraction, 80)
            points = np.column_stack((100.0 * np.cos(angle), 100.0 * np.sin(angle)))
            evidence = extract_partial_route_evidence(_samples(points), grid_seconds=2.0)
            self.assertIsNotNone(evidence)
            assert evidence is not None
            ready_by_fraction[route_fraction] = partial_candidate_ready(evidence)
            measured.append(
                (
                    route_fraction,
                    evidence.turn_fraction,
                    evidence.path_efficiency,
                    evidence.turn_sign_persistence,
                )
            )

        turn = [item[1] for item in measured]
        efficiency = [item[2] for item in measured]
        self.assertTrue(all(next_value > value for value, next_value in zip(turn, turn[1:])))
        self.assertTrue(all(next_value < value for value, next_value in zip(efficiency, efficiency[1:])))
        self.assertFalse(ready_by_fraction[0.20])
        self.assertTrue(ready_by_fraction[0.40])

    def test_partial_candidate_rejects_non_route_motion_bank(self) -> None:
        x = np.linspace(0.0, 420.0, 100)
        straight = np.column_stack((x, 0.02 * x))
        straight_evidence = extract_partial_route_evidence(_samples(straight), grid_seconds=2.0)
        self.assertIsNotNone(straight_evidence)
        assert straight_evidence is not None
        self.assertFalse(partial_candidate_ready(straight_evidence))

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
        self.assertFalse(
            partial_candidate_ready(drift_evidence),
            msg=f"noisy-drift diagnostics: {_diag(drift_evidence)}",
        )

        # A single smooth road bend is coherent motion but is deliberately kept
        # below candidate strength; no recurrence or timer is used to promote it.
        angle = np.linspace(0.0, math.radians(115.0), 90)
        road_bend = np.column_stack((180.0 * np.cos(angle), 180.0 * np.sin(angle)))
        bend_evidence = extract_partial_route_evidence(_samples(road_bend), grid_seconds=2.0)
        self.assertIsNotNone(bend_evidence)
        assert bend_evidence is not None
        self.assertFalse(
            partial_candidate_ready(bend_evidence),
            msg=f"road-bend diagnostics: {_diag(bend_evidence)}",
        )

    def test_every_approved_family_reaches_candidate_by_observed_geometry(self) -> None:
        """No family has a hidden elapsed-time requirement for candidate state."""

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
                with self.subTest(shape=shape, opening=opening, start=start_fraction):
                    observations: list[tuple[float, bool, dict[str, float]]] = []
                    for route_fraction in (0.35, 0.45, 0.55):
                        points = _route_arc(
                            shape,
                            start_fraction=start_fraction,
                            route_fraction=route_fraction,
                            opening_deg=opening,
                        )
                        evidence = extract_partial_route_evidence(_samples(points), grid_seconds=2.0)
                        self.assertIsNotNone(evidence)
                        assert evidence is not None
                        observations.append(
                            (route_fraction, partial_candidate_ready(evidence), _diag(evidence))
                        )
                    self.assertTrue(
                        any(ready for _, ready, _ in observations),
                        msg=f"candidate never formed: {shape.value} {opening} {start_fraction}: {observations}",
                    )


if __name__ == "__main__":
    unittest.main()
