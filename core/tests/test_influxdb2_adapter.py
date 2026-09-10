from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
import unittest

from bluewolf_ingest.influxdb2 import (
    InfluxDB2Adapter,
    InfluxDB2AdapterError,
    InfluxDB2Connection,
    InfluxDB2MetricMapping,
    InfluxDB2StreamSchema,
)
from bluewolf_ingest.models import MetricName


START = datetime(2026, 9, 9, 12, 0, tzinfo=UTC)


@dataclass
class FakeRecord:
    measurement: str
    field: str
    value: object
    when: datetime
    columns: dict[str, object]

    @property
    def values(self):
        return self.columns

    def get_time(self):
        return self.when

    def get_measurement(self):
        return self.measurement

    def get_field(self):
        return self.field

    def get_value(self):
        return self.value


@dataclass
class FakeTable:
    records: list[FakeRecord]


class FakeQueryAPI:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def query(self, *, org, query):
        self.calls.append((org, query))
        return self.responses.pop(0)


class FakeClient:
    def __init__(self, responses):
        self.api = FakeQueryAPI(responses)
        self.closed = False

    def query_api(self):
        return self.api

    def close(self):
        self.closed = True


def mapping(metric, measurement, field="value", *, bucket="navigation", value_map=()):
    return InfluxDB2MetricMapping(
        metric=metric,
        bucket=bucket,
        measurement=measurement,
        field=field,
        value_map=value_map,
    )


def adapter_with(responses, mappings, *, schema=None):
    client = FakeClient(responses)
    adapter = InfluxDB2Adapter(
        InfluxDB2Connection(
            url="http://influx.internal:8086",
            organization="blue-wolf",
            token="secret-token",
        ),
        schema or InfluxDB2StreamSchema(
            vehicle_number_column="vehicle-slot",
            server_column="server-tag",
        ),
        mappings,
        client_factory=lambda _: client,
    )
    return adapter, client


class InfluxDB2AdapterTests(unittest.TestCase):
    def test_one_flux_query_per_bucket_with_configurable_identity_columns(self) -> None:
        adapter, _ = adapter_with(
            [],
            [
                mapping(MetricName.LATITUDE, "latitude"),
                mapping(MetricName.LONGITUDE, "longitude"),
                mapping(MetricName.ACTIVE, "active", field="color"),
            ],
        )
        queries = adapter.flux_queries(
            server_tag_value='srv "north"',
            start_time_utc=START,
            stop_time_utc=START + timedelta(seconds=5),
        )
        self.assertEqual(len(queries), 1)
        query = queries[0]
        self.assertIn('from(bucket: "navigation")', query)
        self.assertIn('r["server-tag"] == "srv \\"north\\""', query)
        self.assertIn('r._measurement == "latitude"', query)
        self.assertIn('r._measurement == "longitude"', query)
        self.assertIn('r._measurement == "active"', query)
        self.assertIn('|> sort(columns: ["_time"])', query)
        self.assertNotIn("TTAG", query)
        self.assertNotIn("secret-token", query)

    def test_multiple_buckets_create_multiple_bounded_queries(self) -> None:
        adapter, _ = adapter_with(
            [],
            [
                mapping(MetricName.LATITUDE, "latitude", bucket="nav-a"),
                mapping(MetricName.LONGITUDE, "longitude", bucket="nav-b"),
            ],
        )
        queries = adapter.flux_queries(
            server_tag_value="1",
            start_time_utc=START,
            stop_time_utc=START + timedelta(seconds=5),
        )
        self.assertEqual(len(queries), 2)
        self.assertIn('from(bucket: "nav-a")', queries[0])
        self.assertIn('from(bucket: "nav-b")', queries[1])
        self.assertTrue(all("|> range(" in query for query in queries))

    def test_records_convert_to_sorted_raw_points_and_special_active_value(self) -> None:
        records = [
            FakeRecord("longitude", "value", 34.2, START + timedelta(seconds=2), {"vehicle-slot": "7"}),
            FakeRecord("active", "color", "GREEN", START, {"vehicle-slot": 7}),
            FakeRecord("vehicle_id", "value", 107, START, {"vehicle-slot": 7}),
            FakeRecord("latitude", "value", 31.8, START + timedelta(seconds=2), {"vehicle-slot": 7}),
        ]
        adapter, client = adapter_with(
            [[FakeTable(records)]],
            [
                mapping(MetricName.VEHICLE_IDENTIFIER, "vehicle_id"),
                mapping(MetricName.ACTIVE, "active", field="color", value_map=(("green", True),)),
                mapping(MetricName.LATITUDE, "latitude"),
                mapping(MetricName.LONGITUDE, "longitude"),
            ],
        )
        points = adapter.query_points(
            server_id=3,
            server_tag_value="3",
            start_time_utc=START,
            stop_time_utc=START + timedelta(seconds=5),
        )
        self.assertTrue(client.closed)
        self.assertEqual(len(client.api.calls), 1)
        self.assertEqual(client.api.calls[0][0], "blue-wolf")
        self.assertEqual({point.server_id for point in points}, {3})
        self.assertEqual({point.vehicle_number for point in points}, {7})
        active = next(point for point in points if point.metric is MetricName.ACTIVE)
        self.assertIs(active.value, True)
        self.assertEqual(
            [(point.source_time_utc, point.metric.value) for point in points],
            sorted((point.source_time_utc, point.metric.value) for point in points),
        )

    def test_configured_time_column_is_the_join_clock(self) -> None:
        physical_time = START + timedelta(seconds=3)
        influx_time = START + timedelta(minutes=10)
        record = FakeRecord(
            "latitude",
            "value",
            31.8,
            influx_time,
            {
                "vehicle-slot": 7,
                "event-time": physical_time.astimezone(timezone(timedelta(hours=2))).isoformat(),
            },
        )
        adapter, client = adapter_with(
            [[FakeTable([record])]],
            [mapping(MetricName.LATITUDE, "latitude")],
            schema=InfluxDB2StreamSchema(
                vehicle_number_column="vehicle-slot",
                server_column="server-tag",
                time_column="event-time",
            ),
        )
        points = adapter.query_points(
            server_id=3,
            server_tag_value="3",
            start_time_utc=START,
            stop_time_utc=START + timedelta(minutes=20),
        )
        self.assertEqual(points[0].source_time_utc, physical_time)
        self.assertNotEqual(points[0].source_time_utc, influx_time)
        self.assertIn('|> sort(columns: ["event-time"])', client.api.calls[0][1])

    def test_missing_configured_time_column_is_rejected_and_client_is_closed(self) -> None:
        adapter, client = adapter_with(
            [[FakeTable([FakeRecord("latitude", "value", 31.8, START, {"vehicle-slot": 7})])]],
            [mapping(MetricName.LATITUDE, "latitude")],
            schema=InfluxDB2StreamSchema(
                vehicle_number_column="vehicle-slot",
                time_column="event-time",
            ),
        )
        with self.assertRaisesRegex(InfluxDB2AdapterError, "event-time"):
            adapter.query_points(
                server_id=1,
                server_tag_value=None,
                start_time_utc=START,
                stop_time_utc=START + timedelta(seconds=5),
            )
        self.assertTrue(client.closed)

    def test_naive_configured_time_is_rejected(self) -> None:
        adapter, _ = adapter_with(
            [[FakeTable([FakeRecord(
                "latitude",
                "value",
                31.8,
                START,
                {"vehicle-slot": 7, "event-time": "2026-09-09T12:00:00"},
            )])]],
            [mapping(MetricName.LATITUDE, "latitude")],
            schema=InfluxDB2StreamSchema(
                vehicle_number_column="vehicle-slot",
                time_column="event-time",
            ),
        )
        with self.assertRaisesRegex(InfluxDB2AdapterError, "timezone-aware"):
            adapter.query_points(
                server_id=1,
                server_tag_value=None,
                start_time_utc=START,
                stop_time_utc=START + timedelta(seconds=5),
            )

    def test_missing_vehicle_identity_is_rejected_and_client_is_closed(self) -> None:
        adapter, client = adapter_with(
            [[FakeTable([FakeRecord("latitude", "value", 31.8, START, {})])]],
            [mapping(MetricName.LATITUDE, "latitude")],
        )
        with self.assertRaisesRegex(InfluxDB2AdapterError, "vehicle-slot"):
            adapter.query_points(
                server_id=1,
                server_tag_value="1",
                start_time_utc=START,
                stop_time_utc=START + timedelta(seconds=5),
            )
        self.assertTrue(client.closed)

    def test_naive_or_reversed_bounds_are_rejected_before_client_creation(self) -> None:
        adapter, _ = adapter_with([], [mapping(MetricName.LATITUDE, "latitude")])
        with self.assertRaises(ValueError):
            adapter.flux_queries(
                server_tag_value="1",
                start_time_utc=datetime(2026, 1, 1),
                stop_time_utc=START,
            )
        with self.assertRaisesRegex(ValueError, "after"):
            adapter.flux_queries(
                server_tag_value="1",
                start_time_utc=START,
                stop_time_utc=START,
            )

    def test_schema_can_omit_server_filter_for_per_server_bucket_layout(self) -> None:
        adapter, _ = adapter_with(
            [],
            [mapping(MetricName.LATITUDE, "latitude")],
            schema=InfluxDB2StreamSchema(vehicle_number_column="slot"),
        )
        query = adapter.flux_queries(
            server_tag_value=None,
            start_time_utc=START,
            stop_time_utc=START + timedelta(seconds=1),
        )[0]
        self.assertNotIn("server-tag", query)

    def test_empty_time_column_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "time_column"):
            InfluxDB2StreamSchema(vehicle_number_column="slot", time_column="  ")

    def test_duplicate_metric_mapping_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "mapped more than once"):
            adapter_with(
                [],
                [
                    mapping(MetricName.LATITUDE, "lat-a"),
                    mapping(MetricName.LATITUDE, "lat-b"),
                ],
            )


if __name__ == "__main__":
    unittest.main()
