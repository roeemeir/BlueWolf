"""Public civilian data -> real disposable InfluxDB2 -> Blue Wolf adapter/join.

This is a SOURCE/SCHEMA integration test, NOT live vehicle/Core scoring evidence.
Original bird latitude, longitude, and nanosecond observation times come from
InfluxData's public Movebank-derived bird-migration sample. Numeric "vehicle"
IDs and three server labels are disposable TEST aliases; active state and both
velocity components are TEST-GENERATED metadata, NOT observed bird telemetry.
No private/operational Influx credentials or customer data are used here.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
import hashlib
import math
import os
from urllib.parse import quote
from urllib.request import Request, urlopen

from influxdb_client import InfluxDBClient

from bluewolf_ingest.influxdb2 import (
    InfluxDB2Adapter,
    InfluxDB2Connection,
    InfluxDB2MetricMapping,
    InfluxDB2StreamSchema,
)
from bluewolf_ingest.join import TemporalJoinConfig, join_metric_points
from bluewolf_ingest.models import MetricName

SOURCE_URL = (
    "https://raw.githubusercontent.com/influxdata/influxdb2-sample-data/"
    "master/bird-migration-data/bird-migration.line"
)
PUBLIC_BUCKET = "civil-public-coordinates"
TEST_BUCKET = "civil-test-enrichment"
ORG = "civil-join-qa"


def civilian_observations() -> tuple[list[tuple[str, float, float, int]], str]:
    with urlopen(Request(SOURCE_URL, headers={"User-Agent": "BlueWolf-civil-source-join-test"}), timeout=40) as response:
        source = response.read(3_000_000)
    if not 1000 < len(source) < 3_000_000:
        raise AssertionError("public civilian source missing or unexpectedly sized")
    source_hash = hashlib.sha256(source).hexdigest()
    first_per_animal: dict[str, tuple[str, float, float, int]] = {}
    for line in source.decode("utf-8").splitlines():
        sections = line.split(" ")
        if len(sections) != 3 or not sections[0].startswith("migration,"):
            continue
        tags = dict(part.split("=", 1) for part in sections[0].split(",")[1:])
        fields = dict(part.split("=", 1) for part in sections[1].split(","))
        animal_id = tags.get("id")
        if not animal_id or animal_id in first_per_animal or "lat" not in fields or "lon" not in fields:
            continue
        latitude, longitude, timestamp_ns = float(fields["lat"]), float(fields["lon"]), int(sections[2])
        if not (math.isfinite(latitude) and math.isfinite(longitude) and -90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise AssertionError("invalid source WGS84 coordinate")
        first_per_animal[animal_id] = (animal_id, latitude, longitude, timestamp_ns)
        if len(first_per_animal) == 2:
            break
    if len(first_per_animal) != 2:
        raise AssertionError("expected two distinct real civilian source tracks")
    return list(first_per_animal.values()), source_hash


def write_points(url: str, token: str, bucket: str, lines: list[str]) -> None:
    endpoint = f"{url.rstrip('/')}/api/v2/write?org={quote(ORG)}&bucket={quote(bucket)}&precision=ns"
    request = Request(
        endpoint,
        data=("\n".join(lines) + "\n").encode("utf-8"),
        headers={"Authorization": "Token " + token, "Content-Type": "text/plain; charset=utf-8"},
        method="POST",
    )
    with urlopen(request, timeout=25) as response:
        if response.status != 204:
            raise AssertionError(f"real InfluxDB2 write failed: {response.status}")


def main() -> None:
    url = os.environ.get("BW_CIVIL_INFLUX_URL", "http://127.0.0.1:8086")
    token = os.environ["BW_CIVIL_INFLUX_TOKEN"]
    observations, source_hash = civilian_observations()
    public_lines: list[str] = []
    test_lines: list[str] = []
    expected: dict[tuple[int, int], tuple[float, float, datetime]] = {}
    for server in range(1, 4):
        for index, (_animal_id, latitude, longitude, timestamp_ns) in enumerate(observations):
            # Numeric IDs/servers are declared TEST ALIASES; original GPS and
            # timestamps remain exactly those in the public civilian dataset.
            vehicle = 17 + index
            tags = f"site_key=civil-{server},slot_key={vehicle}"
            public_lines.append(
                f"track_public,{tags} public_lat={latitude},public_lon={longitude} {timestamp_ns}"
            )
            # These fields are explicitly GENERATED for an adapter/join test:
            # bird migration data does not contain operational vehicle status,
            # vehicle numbers, or observed north/east velocity components.
            test_lines.append(
                f'test_enrichment,{tags} test_vehicle={vehicle}i,test_state="GREEN",'
                f"test_velocity_n=0.0,test_velocity_e=0.0 {timestamp_ns}"
            )
            expected[(server, vehicle)] = (
                latitude,
                longitude,
                datetime.fromtimestamp(timestamp_ns / 1_000_000_000, UTC),
            )

    with InfluxDBClient(url=url, token=token, org=ORG, timeout=25000) as client:
        buckets = client.buckets_api()
        existing = buckets.find_bucket_by_name(TEST_BUCKET)
        if existing is None:
            buckets.create_bucket(bucket_name=TEST_BUCKET, org=ORG)
    write_points(url, token, PUBLIC_BUCKET, public_lines)
    write_points(url, token, TEST_BUCKET, test_lines)

    mappings = (
        InfluxDB2MetricMapping(MetricName.LATITUDE, PUBLIC_BUCKET, "track_public", "public_lat"),
        InfluxDB2MetricMapping(MetricName.LONGITUDE, PUBLIC_BUCKET, "track_public", "public_lon"),
        InfluxDB2MetricMapping(MetricName.VEHICLE_IDENTIFIER, TEST_BUCKET, "test_enrichment", "test_vehicle"),
        InfluxDB2MetricMapping(
            MetricName.ACTIVE, TEST_BUCKET, "test_enrichment", "test_state", value_map=(("green", True),)
        ),
        InfluxDB2MetricMapping(MetricName.VELOCITY_NORTH, TEST_BUCKET, "test_enrichment", "test_velocity_n"),
        InfluxDB2MetricMapping(MetricName.VELOCITY_EAST, TEST_BUCKET, "test_enrichment", "test_velocity_e"),
    )
    adapter = InfluxDB2Adapter(
        InfluxDB2Connection(url=url, organization=ORG, token=token),
        InfluxDB2StreamSchema(vehicle_number_column="slot_key", server_column="site_key", time_column="_time"),
        mappings,
    )
    earliest = min(item[2] for item in expected.values()) - timedelta(seconds=1)
    latest = max(item[2] for item in expected.values()) + timedelta(seconds=1)
    for server in range(1, 4):
        points = adapter.query_points(
            server_id=server,
            server_tag_value=f"civil-{server}",
            start_time_utc=earliest,
            stop_time_utc=latest,
        )
        assert len(points) == 12, (server, len(points))  # 2 independent observations x 6 metrics
        assert {p.vehicle_number for p in points} == {17, 18}
        assert {p.server_id for p in points} == {server}
        samples = join_metric_points(points, config=TemporalJoinConfig(logical_grid_seconds=1, tolerance_seconds=5))
        assert len(samples) == 2, (server, len(samples))
        for sample in samples:
            lat, lon, when = expected[(server, sample.vehicle_number)]
            assert sample.sample_time_utc == when
            assert sample.vehicle_identifier == sample.vehicle_number
            assert sample.active is True
            assert sample.latitude_deg == lat and sample.longitude_deg == lon
            assert sample.velocity_north_mps == 0 and sample.velocity_east_mps == 0
            assert sample.reliability == 1
    assert not adapter.query_points(
        server_id=4, server_tag_value="absent-server", start_time_utc=earliest, stop_time_utc=latest
    )
    print(
        "PASS: actual InfluxDB2 Flux query, six configured physical fields, two buckets, "
        "custom server/vehicle/time join, six isolated historical civilian WGS84 observations; "
        f"source SHA-256={source_hash}; TEST aliases and non-GPS metrics are synthetic. "
        "NOT evidence of live vehicles, routes, scoring, or full operational E2E."
    )


if __name__ == "__main__":
    main()
