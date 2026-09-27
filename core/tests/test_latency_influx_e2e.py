from __future__ import annotations

import asyncio
from datetime import timedelta
import json
import os
from time import perf_counter
import unittest

from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

from bluewolf_ingest.influxdb2 import (
    InfluxDB2Adapter,
    InfluxDB2Connection,
    InfluxDB2MetricMapping,
    InfluxDB2StreamSchema,
)
from bluewolf_ingest.join import TemporalJoinConfig
from bluewolf_ingest.models import MetricName
from bluewolf_ingest.polling import LivePollConfig, ServerPollCursor
from bluewolf_ingest.window_reader import InfluxDB2WindowReader
from bluewolf_runtime_adapter.ingest_coordinator import LiveCoreIngestCoordinator
from bluewolf_runtime_adapter.operational_pipeline import OperationalServerPipeline
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore, create_app

from test_latency_budget import (
    START,
    _producer,
    _request_runtime,
    _route,
    _samples,
    _session,
)


INFLUX_URL = os.environ.get("BLUEWOLF_LATENCY_INFLUX_URL", "").strip()
INFLUX_ORG = os.environ.get("BLUEWOLF_LATENCY_INFLUX_ORG", "").strip()
INFLUX_BUCKET = os.environ.get("BLUEWOLF_LATENCY_INFLUX_BUCKET", "").strip()
INFLUX_TOKEN = os.environ.get("BLUEWOLF_LATENCY_INFLUX_TOKEN", "").strip()
SERVER_TAG = "latency-test"


def _mapping(metric: MetricName, measurement: str) -> InfluxDB2MetricMapping:
    return InfluxDB2MetricMapping(
        metric=metric,
        bucket=INFLUX_BUCKET,
        measurement=measurement,
        field="value",
    )


def _reader() -> InfluxDB2WindowReader:
    adapter = InfluxDB2Adapter(
        InfluxDB2Connection(
            url=INFLUX_URL,
            organization=INFLUX_ORG,
            token=INFLUX_TOKEN,
            timeout_ms=5_000,
        ),
        InfluxDB2StreamSchema(
            vehicle_number_column="vehicle_number",
            server_column="server",
        ),
        (
            _mapping(MetricName.VEHICLE_IDENTIFIER, "vehicle_id"),
            _mapping(MetricName.ACTIVE, "active"),
            _mapping(MetricName.LATITUDE, "latitude"),
            _mapping(MetricName.LONGITUDE, "longitude"),
            _mapping(MetricName.VELOCITY_NORTH, "velocity_north"),
            _mapping(MetricName.VELOCITY_EAST, "velocity_east"),
        ),
    )
    return InfluxDB2WindowReader(
        adapter,
        TemporalJoinConfig(logical_grid_seconds=1, tolerance_seconds=5),
    )


def _point(measurement: str, value: object, *, vehicle_number: int, when) -> Point:
    return (
        Point(measurement)
        .tag("vehicle_number", str(vehicle_number))
        .tag("server", SERVER_TAG)
        .field("value", value)
        .time(when, WritePrecision.NS)
    )


def _seed_real_influx(route) -> None:
    records: list[Point] = []
    for when in (START, START + timedelta(seconds=3)):
        for sample in _samples(route, when):
            values = (
                ("vehicle_id", sample.vehicle_identifier),
                ("active", bool(sample.active)),
                ("latitude", float(sample.latitude_deg)),
                ("longitude", float(sample.longitude_deg)),
                ("velocity_north", float(sample.velocity_north_mps)),
                ("velocity_east", float(sample.velocity_east_mps)),
            )
            for measurement, value in values:
                records.append(
                    _point(
                        measurement,
                        value,
                        vehicle_number=sample.vehicle_number,
                        when=sample.sample_time_utc,
                    )
                )

    client = InfluxDBClient(
        url=INFLUX_URL,
        token=INFLUX_TOKEN,
        org=INFLUX_ORG,
        timeout=5_000,
    )
    try:
        client.write_api(write_options=SYNCHRONOUS).write(
            bucket=INFLUX_BUCKET,
            org=INFLUX_ORG,
            record=records,
        )
        # Read-after-write through Flux proves the container has indexed the
        # exact benchmark series before the measured runtime path begins.
        tables = client.query_api().query(
            org=INFLUX_ORG,
            query=(
                f'from(bucket: "{INFLUX_BUCKET}") '
                f'|> range(start: 2026-09-17T17:59:50Z, stop: 2026-09-17T18:00:10Z) '
                f'|> filter(fn: (r) => r["server"] == "{SERVER_TAG}") '
                '|> count()'
            ),
        )
        indexed = sum(
            int(record.get_value())
            for table in tables
            for record in table.records
        )
        if indexed < len(records):
            raise AssertionError(
                f"Influx seed is incomplete: indexed={indexed}, expected>={len(records)}"
            )
    finally:
        client.close()


@unittest.skipUnless(
    INFLUX_URL and INFLUX_ORG and INFLUX_BUCKET and INFLUX_TOKEN,
    "real InfluxDB2 latency benchmark environment is not configured",
)
class RealInfluxEndToEndLatencyTests(unittest.TestCase):
    def test_bw_data_010_real_influx_to_http_fits_ten_second_budget(self) -> None:
        """Measure the real InfluxDB2 -> join -> Core -> snapshot -> HTTP path."""

        poll_config = LivePollConfig()
        self.assertEqual(poll_config.join_tolerance_seconds, 5)
        self.assertEqual(poll_config.active_poll_seconds, 3)

        route = _route()
        _seed_real_influx(route)

        session = _session(route)
        store = RuntimeSnapshotStore()
        reader = _reader()
        cursor = ServerPollCursor(poll_config)
        coordinator = LiveCoreIngestCoordinator(
            server_id=1,
            server_tag_value=SERVER_TAG,
            reader=reader,
            session=session,
            cursor=cursor,
            awake_resolver=lambda samples, _core, _window: bool(samples),
        )
        producer = _producer(session, route, store)
        pipeline = OperationalServerPipeline(coordinator, producer)

        # Warm the Influx connection, Flux planner, grouping and SI temporal
        # metrics before measuring the steady active-update path.
        warm_wall_time = START + timedelta(seconds=poll_config.join_tolerance_seconds)
        warm = pipeline.poll_once(warm_wall_time)
        self.assertIsNotNone(warm.poll)
        self.assertIsNotNone(warm.publication)
        self.assertTrue(cursor.awake)

        measured_wall_time = warm_wall_time + timedelta(
            seconds=poll_config.active_poll_seconds
        )
        expected_observed_at = measured_wall_time - timedelta(
            seconds=poll_config.join_tolerance_seconds
        )

        started = perf_counter()
        result = pipeline.poll_once(measured_wall_time)
        self.assertIsNotNone(result.poll)
        self.assertIsNotNone(result.publication)
        self.assertIsNotNone(result.publication.snapshot if result.publication else None)

        app = create_app(store, clock=lambda: measured_wall_time)
        status, payload = asyncio.run(_request_runtime(app))
        measured_seconds = perf_counter() - started

        self.assertEqual(status, 200)
        self.assertEqual(
            payload["observedAt"],
            expected_observed_at.isoformat().replace("+00:00", "Z"),
        )
        self.assertTrue(payload["groups"])
        group = next(iter(payload["groups"].values()))
        self.assertTrue(group["scoreValid"])

        scheduling_seconds = (
            poll_config.join_tolerance_seconds + poll_config.active_poll_seconds
        )
        end_to_end_upper_bound = scheduling_seconds + measured_seconds
        evidence = {
            "source": "real-influxdb2",
            "schedulingSeconds": scheduling_seconds,
            "influxJoinCoreHttpSeconds": measured_seconds,
            "endToEndUpperBoundSeconds": end_to_end_upper_bound,
            "budgetSeconds": 10.0,
        }
        print(
            "BW-DATA-010 REAL INFLUX E2E LATENCY EVIDENCE "
            + json.dumps(evidence, sort_keys=True)
        )

        # The deterministic product envelope consumes 8 s. The complete real
        # Influx->HTTP software path must therefore remain below the remaining
        # 2 s budget on the CI runner.
        self.assertLess(
            measured_seconds,
            2.0,
            f"real Influx->HTTP processing exceeded 2 s: {measured_seconds:.3f} s",
        )
        self.assertLess(
            end_to_end_upper_bound,
            10.0,
            f"real active update budget exceeded 10 s: {end_to_end_upper_bound:.3f} s",
        )


if __name__ == "__main__":
    unittest.main()
