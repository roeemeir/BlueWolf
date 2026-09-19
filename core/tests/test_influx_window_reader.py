from __future__ import annotations

from datetime import UTC, datetime, timedelta
import unittest

from bluewolf_ingest import MetricName, RawMetricPoint, TemporalJoinConfig
from bluewolf_ingest.window_reader import InfluxDB2WindowReader

START = datetime(2026, 9, 9, 12, 0, tzinfo=UTC)


def point(second: int, metric: MetricName, value):
    return RawMetricPoint(
        source_time_utc=START + timedelta(seconds=second),
        server_id=1,
        vehicle_number=7,
        metric=metric,
        value=value,
    )


class FakeAdapter:
    def __init__(self, points):
        self.points = tuple(points)
        self.calls = []

    def query_points(self, **kwargs):
        self.calls.append(kwargs)
        start = kwargs["start_time_utc"]
        stop = kwargs["stop_time_utc"]
        return tuple(p for p in self.points if start <= p.source_time_utc < stop)


class InfluxWindowReaderTests(unittest.TestCase):
    def test_expands_query_for_join_evidence_and_clips_output(self):
        adapter = FakeAdapter([
            point(-5, MetricName.VEHICLE_IDENTIFIER, 107),
            point(0, MetricName.VEHICLE_IDENTIFIER, 107),
            point(2, MetricName.VEHICLE_IDENTIFIER, 107),
            point(-5, MetricName.ACTIVE, True),
            point(0, MetricName.ACTIVE, True),
            point(2, MetricName.ACTIVE, True),
            # Both numeric originals are outside the requested [0, 2] window,
            # but each stays within the five-second join tolerance for every
            # requested logical second. Identity/active also remain provable at
            # both bracket endpoints, so interpolation is legal.
            point(-3, MetricName.LATITUDE, 30.0),
            point(4, MetricName.LATITUDE, 40.0),
            point(-3, MetricName.LONGITUDE, 34.0),
            point(4, MetricName.LONGITUDE, 35.0),
        ])
        reader = InfluxDB2WindowReader(adapter, TemporalJoinConfig(tolerance_seconds=5))
        samples = reader.read_samples(
            server_id=1,
            server_tag_value="srv-1",
            start_time_utc=START,
            end_time_utc=START + timedelta(seconds=2),
        )
        call = adapter.calls[0]
        self.assertEqual(call["start_time_utc"], START - timedelta(seconds=5))
        self.assertEqual(call["stop_time_utc"], START + timedelta(seconds=7, microseconds=1))
        self.assertEqual([s.sample_time_utc for s in samples], [
            START,
            START + timedelta(seconds=1),
            START + timedelta(seconds=2),
        ])
        self.assertAlmostEqual(samples[0].latitude_deg, 30.0 + 3.0 / 7.0 * 10.0)
        self.assertAlmostEqual(samples[2].longitude_deg, 34.0 + 5.0 / 7.0)

    def test_exact_plus_tolerance_point_survives_exclusive_flux_stop(self):
        target = START + timedelta(seconds=2)
        adapter = FakeAdapter([
            # Identity is known at both interpolation bracket endpoints. The
            # +7 numeric point is exactly +5 seconds from the requested target,
            # so the reader's exclusive Flux stop must still include it.
            point(-3, MetricName.VEHICLE_IDENTIFIER, 107),
            point(2, MetricName.VEHICLE_IDENTIFIER, 107),
            point(-3, MetricName.ACTIVE, True),
            point(2, MetricName.ACTIVE, True),
            point(-3, MetricName.LATITUDE, 30.0),
            point(7, MetricName.LATITUDE, 40.0),
            point(-3, MetricName.LONGITUDE, 34.0),
            point(7, MetricName.LONGITUDE, 35.0),
        ])
        samples = InfluxDB2WindowReader(adapter).read_samples(
            server_id=1,
            server_tag_value="1",
            start_time_utc=target,
            end_time_utc=target,
        )
        self.assertEqual(len(samples), 1)
        self.assertAlmostEqual(samples[0].latitude_deg, 35.0)

    def test_empty_source_returns_empty_window(self):
        samples = InfluxDB2WindowReader(FakeAdapter(())).read_samples(
            server_id=1,
            server_tag_value=None,
            start_time_utc=START,
            end_time_utc=START + timedelta(seconds=2),
        )
        self.assertEqual(samples, ())

    def test_invalid_bounds_fail_before_query(self):
        adapter = FakeAdapter(())
        reader = InfluxDB2WindowReader(adapter)
        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            reader.read_samples(
                server_id=1,
                server_tag_value="1",
                start_time_utc=datetime(2026, 1, 1),
                end_time_utc=START,
            )
        with self.assertRaisesRegex(ValueError, "must not precede"):
            reader.read_samples(
                server_id=1,
                server_tag_value="1",
                start_time_utc=START,
                end_time_utc=START - timedelta(seconds=1),
            )
        self.assertEqual(adapter.calls, [])


if __name__ == "__main__":
    unittest.main()
