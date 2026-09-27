from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

import numpy as np

from bluewolf_core.geometry import local_m_to_wgs84
from bluewolf_core.models import CanonicalPoint, VehicleSample
from bluewolf_core.vector_sample_adapter import build_vector_track


class VectorSampleAdapterTests(unittest.TestCase):
    def _sample(
        self,
        second: int,
        east_m: float,
        north_m: float,
        *,
        vehicle_identifier: int = 7,
    ) -> VehicleSample:
        latitude, longitude = local_m_to_wgs84(
            CanonicalPoint(east_m, north_m),
            center_latitude_deg=32.0,
            center_longitude_deg=34.8,
        )
        return VehicleSample(
            sample_time_utc=datetime(2026, 9, 8, 8, 0, tzinfo=UTC) + timedelta(seconds=second),
            server_id=1,
            vehicle_number=3,
            vehicle_identifier=vehicle_identifier,
            active=True,
            latitude_deg=latitude,
            longitude_deg=longitude,
            velocity_east_mps=2.0,
            velocity_north_mps=0.0,
        )

    def test_missing_network_times_become_masked_slots_not_interpolated_positions(self) -> None:
        samples = [
            self._sample(0, 0.0, 0.0),
            self._sample(2, 4.0, 0.0),
            self._sample(4, 8.0, 0.0),
            # 6,8,10,12 are intentionally absent: communication outage.
            self._sample(14, 28.0, 0.0),
            self._sample(16, 32.0, 0.0),
        ]
        prepared = build_vector_track(samples, grid_seconds=2.0)
        self.assertIsNotNone(prepared)
        assert prepared is not None
        self.assertEqual(prepared.grid_seconds, 2.0)
        np.testing.assert_array_equal(
            prepared.track.observed_mask,
            np.array([True, True, True, False, False, False, False, True, True]),
        )
        # Placeholder values at missing slots are explicitly NOT observations.
        np.testing.assert_allclose(prepared.track.xy_m[3:7], 0.0)
        self.assertEqual(prepared.observed_grid_count, 5)

    def test_cadence_inference_uses_dense_sampling_not_large_outage(self) -> None:
        samples = [
            self._sample(0, 0.0, 0.0),
            self._sample(2, 2.0, 0.0),
            self._sample(4, 4.0, 0.0),
            self._sample(6, 6.0, 0.0),
            self._sample(30, 30.0, 0.0),
            self._sample(32, 32.0, 0.0),
        ]
        prepared = build_vector_track(samples)
        self.assertIsNotNone(prepared)
        assert prepared is not None
        self.assertAlmostEqual(prepared.grid_seconds, 2.0)
        self.assertLess(prepared.observed_grid_count, len(prepared.track.time_s))

    def test_wgs84_conversion_is_vectorized_and_metric_scale_is_preserved(self) -> None:
        samples = [
            self._sample(0, -10.0, 5.0),
            self._sample(2, 0.0, 5.0),
            self._sample(4, 10.0, 5.0),
        ]
        prepared = build_vector_track(samples, grid_seconds=2.0)
        self.assertIsNotNone(prepared)
        assert prepared is not None
        observed = prepared.track.xy_m[prepared.track.observed_mask]
        self.assertAlmostEqual(float(np.linalg.norm(observed[2] - observed[0])), 20.0, delta=0.05)

    def test_mixed_vehicle_streams_are_rejected(self) -> None:
        samples = [
            self._sample(0, 0.0, 0.0),
            self._sample(2, 2.0, 0.0),
            self._sample(4, 4.0, 0.0, vehicle_identifier=8),
        ]
        with self.assertRaises(ValueError):
            build_vector_track(samples, grid_seconds=2.0)


if __name__ == "__main__":
    unittest.main()
