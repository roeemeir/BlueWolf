from __future__ import annotations

from datetime import timedelta
import unittest

from bluewolf_ingest.influxdb2 import InfluxDB2StreamSchema
from bluewolf_ingest.models import MetricName

from test_influxdb2_adapter import START, FakeRecord, FakeTable, adapter_with, mapping


class InfluxCustomMappingAcceptanceTests(unittest.TestCase):
    def test_custom_join_columns_and_special_mapping_drive_real_adapter_sample(self) -> None:
        schema = InfluxDB2StreamSchema(
            vehicle_number_column="vehicle_join",
            server_column="srv_join",
            time_column="when_utc",
        )
        records = [
            FakeRecord(
                "active_state",
                "raw_value",
                "GREEN",
                START,
                {
                    "vehicle_join": "17",
                    "srv_join": "north-server",
                    "when_utc": "2026-09-09T15:00:02+03:00",
                },
            )
        ]
        adapter, client = adapter_with(
            [[FakeTable(records)]],
            [mapping(MetricName.ACTIVE, "active_state", field="raw_value", value_map=(("GREEN", True),))],
            schema=schema,
        )

        points = adapter.query_points(
            server_id=9,
            server_tag_value="north-server",
            start_time_utc=START,
            stop_time_utc=START + timedelta(seconds=5),
        )

        self.assertEqual(len(points), 1)
        point = points[0]
        self.assertEqual(point.server_id, 9)
        self.assertEqual(point.vehicle_number, 17)
        self.assertEqual(point.source_time_utc, START + timedelta(seconds=2))
        self.assertIs(point.value, True)
        self.assertEqual(point.metric, MetricName.ACTIVE)
        self.assertTrue(client.closed)
        query = client.api.calls[0][1]
        self.assertIn('r["srv_join"] == "north-server"', query)
        self.assertNotIn("server-tag", query)
        self.assertNotIn("vehicle-slot", query)


if __name__ == "__main__":
    unittest.main()
