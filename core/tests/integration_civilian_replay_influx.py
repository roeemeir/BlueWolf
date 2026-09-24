"""Civilian GPS REPLAY through an actual InfluxDB2 and the production adapter/join.

Only geographic fixes and original times are genuine historical public bird data.
The short synthetic playback clock, three server identities, vehicle aliases,
activity and velocities are expressly LAB-GENERATED. This is NOT a live Core,
route, synchronization, event, Web, customer feed, or production acceptance test.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
import math
import os
from urllib.request import Request, urlopen

from influxdb_client import InfluxDBClient

from bluewolf_ingest.influxdb2 import (
    InfluxDB2Adapter, InfluxDB2Connection, InfluxDB2MetricMapping, InfluxDB2StreamSchema,
)
from bluewolf_ingest.join import TemporalJoinConfig
from bluewolf_ingest.models import MetricName
from bluewolf_ingest.window_reader import InfluxDB2WindowReader
from integration_public_civil_influx import ORG, PUBLIC_BUCKET, SOURCE_URL, TEST_BUCKET, write_points


def source_tracks() -> dict[int, list[tuple[float, float, int]]]:
    with urlopen(Request(SOURCE_URL, headers={"User-Agent": "BlueWolf-civil-moving-join-test"}), timeout=40) as reply:
        raw = reply.read(3_000_000).decode("utf-8")
    by_bird: dict[str, dict[int, tuple[float, float, int]]] = {}
    for line in raw.splitlines():
        parts = line.split(" ")
        if len(parts) != 3 or not parts[0].startswith("migration,"):
            continue
        tags = dict(part.split("=", 1) for part in parts[0].split(",")[1:])
        fields = dict(part.split("=", 1) for part in parts[1].split(","))
        bird = tags.get("id")
        if not bird or "lat" not in fields or "lon" not in fields:
            continue
        lat, lon, source_ns = float(fields["lat"]), float(fields["lon"]), int(parts[2])
        if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
            raise AssertionError("public source contained invalid WGS84")
        by_bird.setdefault(bird, {})[source_ns] = (lat, lon, source_ns)
    suitable = [sorted(points.values(), key=lambda point: point[2])[:3] for points in by_bird.values() if len(points) >= 3]
    if len(suitable) < 2:
        raise AssertionError("public source has fewer than two independently observed multi-fix bird tracks")
    return {17: suitable[0], 18: suitable[1]}


def main() -> None:
    url = os.environ.get("BW_CIVIL_INFLUX_URL", "http://127.0.0.1:8086")
    token = os.environ["BW_CIVIL_INFLUX_TOKEN"]
    tracks = source_tracks()
    # This playback clock is GENERATED for a bounded join test, NOT the real
    # sampling cadence or speed of either bird. Original source times are kept
    # separately as an immutable public-source tag for auditability.
    epoch = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)
    playback_offsets = (0, 2, 20)  # 1-second interpolation, then a genuine QA gap.
    public_lines: list[str] = []
    test_lines: list[str] = []
    expected: dict[tuple[int, int, int], tuple[float, float]] = {}
    for server in (1, 2, 3):
        for vehicle, observations in tracks.items():
            for offset, (latitude, longitude, original_ns) in zip(playback_offsets, observations, strict=True):
                # Deliberately shift Influx's _time by one second to prove that
                # the configured sample_clock column, not _time, drives joining.
                source_time = epoch + timedelta(seconds=offset)
                influx_time_ns = int((source_time + timedelta(seconds=1)).timestamp()) * 1_000_000_000
                clock = source_time.isoformat().replace("+00:00", "Z")
                tags = f"site_key=civil-{server},slot_key={vehicle},sample_clock={clock},original_ns={original_ns}"
                public_lines.append(f"civil_moving,{tags} public_lat={latitude},public_lon={longitude} {influx_time_ns}")
                test_lines.append(
                    f'civil_moving_test,{tags} test_vehicle={vehicle}i,test_active="GREEN",'
                    f"test_north=0.0,test_east=0.0 {influx_time_ns}"
                )
                expected[(server, vehicle, offset)] = (latitude, longitude)

    with InfluxDBClient(url=url, token=token, org=ORG, timeout=25000) as client:
        if client.buckets_api().find_bucket_by_name(TEST_BUCKET) is None:
            client.buckets_api().create_bucket(bucket_name=TEST_BUCKET, org=ORG)
    write_points(url, token, PUBLIC_BUCKET, public_lines)
    write_points(url, token, TEST_BUCKET, test_lines)

    mappings = (
        InfluxDB2MetricMapping(MetricName.LATITUDE, PUBLIC_BUCKET, "civil_moving", "public_lat"),
        InfluxDB2MetricMapping(MetricName.LONGITUDE, PUBLIC_BUCKET, "civil_moving", "public_lon"),
        InfluxDB2MetricMapping(MetricName.VEHICLE_IDENTIFIER, TEST_BUCKET, "civil_moving_test", "test_vehicle"),
        InfluxDB2MetricMapping(MetricName.ACTIVE, TEST_BUCKET, "civil_moving_test", "test_active", value_map=(("GREEN", True),)),
        InfluxDB2MetricMapping(MetricName.VELOCITY_NORTH, TEST_BUCKET, "civil_moving_test", "test_north"),
        InfluxDB2MetricMapping(MetricName.VELOCITY_EAST, TEST_BUCKET, "civil_moving_test", "test_east"),
    )
    adapter = InfluxDB2Adapter(
        InfluxDB2Connection(url=url, organization=ORG, token=token),
        InfluxDB2StreamSchema(vehicle_number_column="slot_key", server_column="site_key", time_column="sample_clock"),
        mappings,
    )
    reader = InfluxDB2WindowReader(adapter, TemporalJoinConfig(logical_grid_seconds=1, tolerance_seconds=5))
    for server in (1, 2, 3):
        samples = reader.read_samples(
            server_id=server, server_tag_value=f"civil-{server}",
            start_time_utc=epoch, end_time_utc=epoch + timedelta(seconds=21),
        )
        by_key = {(sample.vehicle_number, int((sample.sample_time_utc - epoch).total_seconds())): sample for sample in samples}
        if len(by_key) != len(samples):
            raise AssertionError("duplicate joined samples for the same vehicle/time")
        for vehicle in tracks:
            for offset in playback_offsets:
                sample = by_key[(vehicle, offset)]
                assert sample.server_id == server and sample.vehicle_identifier == vehicle
                assert sample.active is True and sample.reliability == 1
                assert (sample.latitude_deg, sample.longitude_deg) == expected[(server, vehicle, offset)]
                assert sample.velocity_north_mps == 0 and sample.velocity_east_mps == 0
            # Only a synthetically re-clocked QA interpolation at t=1 is legal.
            halfway = by_key[(vehicle, 1)]
            first = expected[(server, vehicle, 0)]
            second = expected[(server, vehicle, 2)]
            assert abs(halfway.latitude_deg - (first[0] + second[0]) / 2) < 1e-9
            assert abs(halfway.longitude_deg - (first[1] + second[1]) / 2) < 1e-9
            # After t=2, no future original fix is within the 5s join tolerance.
            assert all((vehicle, offset) not in by_key for offset in range(3, 20))
        assert {vehicle for vehicle, _ in by_key} == {17, 18}
        assert {sample.server_id for sample in samples} == {server}
    assert not reader.read_samples(
        server_id=4, server_tag_value="absent", start_time_utc=epoch,
        end_time_utc=epoch + timedelta(seconds=21),
    )
    print(
        "PASS: real InfluxDB2/Flux and actual production temporal-window join: "
        "3 isolated test servers x 2 public historical bird tracks x 3 original GPS fixes, "
        "configurable sample_clock distinct from _time, bounded synthetic interpolation, "
        "and no made-up position across the >5s QA gap. Clock, vehicle/server IDs, "
        "active and velocities are SYNTHETIC LAB metadata, not civilian observations "
        "or proof of live Core, route, score, event, Web or PDF."
    )


if __name__ == "__main__":
    main()
