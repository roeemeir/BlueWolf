from __future__ import annotations

from datetime import UTC, datetime, timedelta
import math
import os
import unittest
from unittest.mock import patch

from bluewolf_core.semantic_session import CoreSession
from bluewolf_ingest import InfluxDB2WindowReader
from bluewolf_ingest.models import MetricName
from bluewolf_ingest.navigation_simulation import (
    SimulatedNavigationMetricAdapter,
    SyntheticNavigationVehicle,
)
from bluewolf_runtime_adapter.navigation_input_factory import (
    SimulatedNavigationPublicationStore,
    navigation_reader_and_schema,
)

START = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)


def _vehicle(server_id: int = 1, vehicle_number: int = 101, **options):
    return SyntheticNavigationVehicle(
        server_id=server_id,
        vehicle_number=vehicle_number,
        center_latitude_deg=32.08,
        center_longitude_deg=34.79,
        radius_m=150.0,
        period_s=90.0,
        **options,
    )


def _config():
    return {
        "navigationSource": {
            "mode": "simulation",
            "startedAtUtc": START.isoformat(),
            "sampleSeconds": 1,
            "vehicles": [
                {
                    "serverId": 1,
                    "vehicleNumber": 101,
                    "centerLatitude": 32.08,
                    "centerLongitude": 34.79,
                    "radiusMeters": 150.0,
                    "periodSeconds": 90.0,
                },
                {
                    "serverId": 2,
                    "vehicleNumber": 202,
                    "centerLatitude": 32.08,
                    "centerLongitude": 34.79,
                    "radiusMeters": 150.0,
                    "periodSeconds": 90.0,
                    "shape": "hippodrome",
                    "straightLengthMeters": 300.0,
                },
            ],
        }
    }


class SimulationNavigationTests(unittest.TestCase):
    def test_only_explicit_test_mode_can_replace_influx(self):
        with patch.dict(os.environ, {"BLUEWOLF_TEST_MODE": "0"}):
            with self.assertRaisesRegex(ValueError, "BLUEWOLF_TEST_MODE"):
                navigation_reader_and_schema(_config())
        with patch.dict(os.environ, {"BLUEWOLF_TEST_MODE": "1"}):
            reader, schema = navigation_reader_and_schema(_config())
        self.assertIsInstance(reader, InfluxDB2WindowReader)
        self.assertIsNone(schema.server_column)
        self.assertIsInstance(reader.adapter, SimulatedNavigationMetricAdapter)

    def test_simulated_points_flow_through_the_production_join_and_real_core(self):
        with patch.dict(os.environ, {"BLUEWOLF_TEST_MODE": "1"}):
            reader, _ = navigation_reader_and_schema(_config())
        adapter = reader.adapter
        adapter.clock = lambda: START + timedelta(seconds=5)
        points = adapter.query_points(
            server_id=1,
            server_tag_value=None,
            start_time_utc=START,
            stop_time_utc=START + timedelta(seconds=4),
        )
        self.assertEqual(len(points), 4 * 7)
        self.assertEqual({point.metric for point in points}, set(MetricName))
        self.assertEqual({point.server_id for point in points}, {1})
        self.assertFalse(any(hasattr(point, "group_score") for point in points))
        samples = reader.read_samples(
            server_id=1,
            server_tag_value=None,
            start_time_utc=START,
            end_time_utc=START + timedelta(seconds=3),
        )
        self.assertEqual(len(samples), 4)
        self.assertEqual({item.vehicle_identifier for item in samples}, {101})
        self.assertTrue(all(item.active is True for item in samples))
        self.assertTrue(all(item.latitude_deg is not None and item.longitude_deg is not None for item in samples))
        self.assertTrue(all(item.reliability == 1.0 for item in samples))
        # Real semantic Python Core; no synthetic route/group/score result is fed.
        result = CoreSession().process_batch(
            samples,
            observed_until_utc=START + timedelta(seconds=3),
        )
        self.assertEqual(result.processed_until_utc, START + timedelta(seconds=3))
        self.assertFalse(hasattr(adapter, "score_group"))

    def test_isolation_and_no_future_fixes(self):
        adapter = SimulatedNavigationMetricAdapter(
            (_vehicle(1, 101), _vehicle(2, 202)),
            START,
            clock=lambda: START + timedelta(seconds=2),
        )
        server_2 = adapter.query_points(
            server_id=2,
            server_tag_value="qa-2",
            start_time_utc=START,
            stop_time_utc=START + timedelta(seconds=9),
        )
        self.assertEqual({point.vehicle_number for point in server_2}, {202})
        self.assertEqual({point.server_id for point in server_2}, {2})
        self.assertEqual({point.source_time_utc for point in server_2}, {
            START, START + timedelta(seconds=1), START + timedelta(seconds=2)
        })
        future = adapter.query_points(
            server_id=3,
            server_tag_value=None,
            start_time_utc=START,
            stop_time_utc=START + timedelta(seconds=3),
        )
        self.assertEqual(future, ())

    def test_hippodrome_is_continuous_and_velocity_is_tangent(self):
        vehicle = _vehicle(route_shape="hippodrome", straight_length_m=300.0)
        perimeter = 600.0 + 2.0 * math.pi * 150.0
        speed = perimeter / vehicle.period_s
        for fraction in (0.0, 0.12, 0.35, 0.5, 0.72, 0.99):
            frame = vehicle.navigation_at(vehicle.period_s * fraction)
            velocity = math.hypot(
                frame["velocity_east_mps"], frame["velocity_north_mps"]
            )
            self.assertAlmostEqual(velocity, speed, places=8)
        before = vehicle.navigation_at(vehicle.period_s - 0.001)
        after = vehicle.navigation_at(vehicle.period_s + 0.001)
        self.assertLess(abs(before["latitude_deg"] - after["latitude_deg"]), 0.00001)
        self.assertLess(abs(before["longitude_deg"] - after["longitude_deg"]), 0.00001)

    def test_provenance_wrapper_marks_core_output_and_rejects_demo(self):
        class Store:
            def __init__(self):
                self.recorded = None

            def publish(self, value):
                self.recorded = value

        underlying = Store()
        wrapper = SimulatedNavigationPublicationStore(underlying)
        with self.assertRaisesRegex(ValueError, "real Python Core"):
            wrapper.publish({"source": {"kind": "demo"}})
        wrapper.publish({
            "source": {"kind": "python-core", "health": "healthy"},
            "status": "1 group",
            "groupList": [],
        })
        self.assertEqual(underlying.recorded["source"]["navigationOrigin"], "simulation")
        self.assertIs(underlying.recorded["source"]["syntheticNavigation"], True)
        self.assertEqual(underlying.recorded["groupList"], [])


if __name__ == "__main__":
    unittest.main()
