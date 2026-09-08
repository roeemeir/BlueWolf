from __future__ import annotations

import math
import unittest
from datetime import UTC, datetime, timedelta

import numpy as np

from bluewolf_core.geometry import local_m_to_wgs84
from bluewolf_core.models import CanonicalPoint, VehicleSample
from bluewolf_core.partial_route_candidate import extract_partial_route_evidence


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


class PartialRouteEvidenceTests(unittest.TestCase):
    def test_partial_circle_has_turn_evidence_without_inventing_period_or_family(self) -> None:
        angle = np.linspace(0.0, 1.10 * math.pi, 72)
        points = np.column_stack((100.0 * np.cos(angle), 100.0 * np.sin(angle)))
        evidence = extract_partial_route_evidence(_samples(points), grid_seconds=2.0)
        self.assertIsNotNone(evidence)
        assert evidence is not None

        self.assertGreater(evidence.turn_fraction, 0.40)
        self.assertGreater(evidence.smooth_heading_fraction, 0.85)
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
        # The two runs contain only geometry inferred inside observed spans;
        # there is no synthetic run representing the missing interval.
        self.assertTrue(all(len(run) >= 2 for run in evidence.observed_runs))

    def test_seeded_small_gps_zigzag_does_not_look_like_smooth_route_turning(self) -> None:
        rng = np.random.default_rng(44)
        points = np.cumsum(rng.normal(0.0, 1.0, size=(90, 2)), axis=0)
        evidence = extract_partial_route_evidence(_samples(points), grid_seconds=2.0)
        self.assertIsNotNone(evidence)
        assert evidence is not None

        # Random walk can accumulate apparent angle, but it should not get the
        # smooth-heading evidence of a vehicle following a coherent route.
        self.assertLess(evidence.smooth_heading_fraction, 0.80)


if __name__ == "__main__":
    unittest.main()
