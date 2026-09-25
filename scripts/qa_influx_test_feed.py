from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
import math
import os
from pathlib import Path
import sys
import time
from urllib.parse import quote
from urllib.request import Request, urlopen

from bluewolf_ingest.navigation_simulation import SyntheticNavigationVehicle

URL = os.environ.get("BLUEWOLF_QA_INFLUX_URL", "http://127.0.0.1:8086").rstrip("/")
ORG = os.environ.get("BLUEWOLF_QA_INFLUX_ORG", "bluewolf-qa")
BUCKET = os.environ.get("BLUEWOLF_QA_INFLUX_BUCKET", "qa-navigation")
TOKEN = os.environ["BLUEWOLF_INFLUX_TOKEN"]
CONFIG_PATH = Path(os.environ["BLUEWOLF_OPERATIONAL_CONFIG"])
READY_PATH = Path(os.environ.get("BLUEWOLF_QA_FEED_READY", "/tmp/bluewolf-qa-feed-ready"))
ARCHIVE_PATH = os.environ["BLUEWOLF_SAMPLE_ARCHIVE_PATH"]
STATE_PATH = os.environ["BLUEWOLF_OPERATIONAL_STATE_PATH"]

CIRCLE_RADIUS_M = 100.0
CIRCLE_PERIOD_S = 60.0
CIRCLE_SPEED_MPS = 2.0 * math.pi * CIRCLE_RADIUS_M / CIRCLE_PERIOD_S
HIPPO_RADIUS_M = 60.0
HIPPO_STRAIGHT_M = 220.0
HIPPO_PERIOD_S = 90.0
HIPPO_SPEED_MPS = (2.0 * HIPPO_STRAIGHT_M + 2.0 * math.pi * HIPPO_RADIUS_M) / HIPPO_PERIOD_S


def vehicle_specs() -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for server_id in (1, 2, 3):
        center = 32.08 + server_id * 0.01
        for vehicle_number, phase in ((server_id * 100 + 1, 0.0), (server_id * 100 + 2, 0.5)):
            result.append({
                "server_id": server_id,
                "vehicle_number": vehicle_number,
                "center_latitude_deg": center,
                "center_longitude_deg": 34.79,
                "radius_m": CIRCLE_RADIUS_M,
                "period_s": CIRCLE_PERIOD_S,
                "phase_fraction": phase,
                "route_shape": "circle",
                "straight_length_m": 0.0,
            })
        for vehicle_number, latitude, phase in (
            (server_id * 100 + 11, center + 0.0040, 0.0),
            (server_id * 100 + 12, center + 0.0055, 0.5),
        ):
            result.append({
                "server_id": server_id,
                "vehicle_number": vehicle_number,
                "center_latitude_deg": latitude,
                "center_longitude_deg": 34.79,
                "radius_m": HIPPO_RADIUS_M,
                "period_s": HIPPO_PERIOD_S,
                "phase_fraction": phase,
                "route_shape": "hippodrome",
                "straight_length_m": HIPPO_STRAIGHT_M,
            })
    return result


def vehicles() -> tuple[SyntheticNavigationVehicle, ...]:
    return tuple(SyntheticNavigationVehicle(**spec) for spec in vehicle_specs())


def build_config() -> dict[str, object]:
    metrics = [
        {"metric": "vehicle_identifier", "bucket": BUCKET, "measurement": "vehicle_id", "field": "value"},
        {"metric": "active", "bucket": BUCKET, "measurement": "active", "field": "value", "valueMap": {"green": True}},
        {"metric": "latitude_deg", "bucket": BUCKET, "measurement": "latitude", "field": "value"},
        {"metric": "longitude_deg", "bucket": BUCKET, "measurement": "longitude", "field": "value"},
        {"metric": "velocity_north_mps", "bucket": BUCKET, "measurement": "velocity_north", "field": "value"},
        {"metric": "velocity_east_mps", "bucket": BUCKET, "measurement": "velocity_east", "field": "value"},
    ]
    servers = []
    for server_id in (1, 2, 3):
        first_id, second_id = server_id * 100 + 11, server_id * 100 + 12
        servers.append({
            "id": server_id,
            "tag": f"server-{server_id}",
            "arena": "QA TEST",
            "awakePolicy": "any-active-latest-snapshot",
            "groups": [{
                "name": f"SO TEST server {server_id}",
                "arena": "QA TEST",
                "color": "#3366cc",
                "routeInstances": [{"id": "r1", "kind": "single"}, {"id": "r2", "kind": "single"}],
                "members": [
                    {"vehicleId": first_id, "vehicleType": "A", "routeInstanceId": "r1", "workSpeedMps": HIPPO_SPEED_MPS},
                    {"vehicleId": second_id, "vehicleType": "A", "routeInstanceId": "r2", "workSpeedMps": HIPPO_SPEED_MPS},
                ],
            }],
        })
    return {
        "navigationSource": {"mode": "influxdb2-test"},
        "influx": {
            "url": URL,
            "organization": ORG,
            "tokenEnv": "BLUEWOLF_INFLUX_TOKEN",
            "timeoutMs": 10000,
            "stream": {
                "vehicleNumberColumn": "vehicle",
                "serverColumn": "server",
                "timeColumn": "_time",
            },
            "metrics": metrics,
        },
        "join": {
            "logicalGridSeconds": 1,
            "toleranceSeconds": 5,
            "originalReliability": 1.0,
            "approximatedReliability": 0.75,
        },
        "polling": {
            "logicalGridSeconds": 1,
            "activePollSeconds": 5,
            "idleProbeSeconds": 5,
            "joinToleranceSeconds": 5,
            "bootstrapHistorySeconds": 360,
        },
        "archive": {"path": ARCHIVE_PATH},
        "persistence": {"path": STATE_PATH},
        "comparisonDimension": "sync",
        "displayedScore": {"mode": "core"},
        "siTemplates": [{
            "id": "qa-si-template",
            "name": "QA TEST SI opposite",
            "default": True,
            "slots": [
                {"id": "slot-0", "vehicleType": "A", "routeRole": "outer", "phaseOffset": 0.0},
                {"id": "slot-1", "vehicleType": "A", "routeRole": "outer", "phaseOffset": 0.5},
            ],
        }],
        "siVehicleTypes": [{
            "id": "A",
            "minId": 101,
            "maxId": 399,
            "workSpeedMps": CIRCLE_SPEED_MPS,
            "siRoles": ["outer"],
        }],
        "templates": [{
            "id": "qa-so-two-routes",
            "name": "QA TEST SO neighboring hippodromes",
            "default": True,
            "routes": [
                {"id": "r1", "kind": "single", "slots": [{"id": "first", "vehicleType": "A", "quarter": "Q0"}]},
                {"id": "r2", "kind": "single", "slots": [{"id": "second", "vehicleType": "A", "quarter": "Q2"}]},
            ],
        }],
        "servers": servers,
    }


def write_config() -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(build_config(), indent=2) + "\n", encoding="utf-8")


def line_rows(at: datetime, fleet: tuple[SyntheticNavigationVehicle, ...]) -> list[str]:
    timestamp_ns = int(at.timestamp() * 1_000_000_000)
    elapsed = at.timestamp()
    rows: list[str] = []
    for vehicle in fleet:
        frame = vehicle.navigation_at(elapsed)
        tags = f"server=server-{vehicle.server_id},vehicle={vehicle.vehicle_number}"
        rows.extend([
            f"vehicle_id,{tags} value={vehicle.vehicle_identifier}i {timestamp_ns}",
            f'active,{tags} value="green" {timestamp_ns}',
            f"latitude,{tags} value={frame['latitude_deg']:.10f} {timestamp_ns}",
            f"longitude,{tags} value={frame['longitude_deg']:.10f} {timestamp_ns}",
            f"velocity_north,{tags} value={frame['velocity_north_mps']:.8f} {timestamp_ns}",
            f"velocity_east,{tags} value={frame['velocity_east_mps']:.8f} {timestamp_ns}",
        ])
    return rows


def write_lines(lines: list[str]) -> None:
    endpoint = f"{URL}/api/v2/write?org={quote(ORG)}&bucket={quote(BUCKET)}&precision=ns"
    request = Request(
        endpoint,
        data=("\n".join(lines) + "\n").encode("utf-8"),
        headers={"Authorization": "Token " + TOKEN, "Content-Type": "text/plain; charset=utf-8"},
        method="POST",
    )
    with urlopen(request, timeout=30) as reply:
        if reply.status != 204:
            raise RuntimeError(f"InfluxDB2 write failed: HTTP {reply.status}")


def seed_history(fleet: tuple[SyntheticNavigationVehicle, ...]) -> None:
    end = datetime.now(UTC).replace(microsecond=0)
    start = end - timedelta(seconds=360)
    batch: list[str] = []
    current = start
    while current <= end:
        batch.extend(line_rows(current, fleet))
        if len(batch) >= 4000:
            write_lines(batch)
            batch.clear()
        current += timedelta(seconds=1)
    if batch:
        write_lines(batch)


def run() -> None:
    write_config()
    fleet = vehicles()
    seed_history(fleet)
    READY_PATH.write_text(datetime.now(UTC).isoformat(), encoding="utf-8")
    last_second = int(time.time())
    while True:
        now_second = int(time.time())
        if now_second > last_second:
            for second in range(last_second + 1, now_second + 1):
                write_lines(line_rows(datetime.fromtimestamp(second, UTC), fleet))
            last_second = now_second
        time.sleep(0.2)


if __name__ == "__main__":
    if len(sys.argv) != 1:
        raise SystemExit("usage: qa_influx_test_feed.py")
    run()
