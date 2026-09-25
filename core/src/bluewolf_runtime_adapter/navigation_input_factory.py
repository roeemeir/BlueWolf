"""Select ONE navigation source before the real join -> Core -> archive pipeline.

The test simulator substitutes only raw navigation metrics for InfluxDB2. Every
route, group, score, event and report remains the responsibility of the actual
Python Core and the ordinary operational services. Synthetic navigation can
never be silently selected by production configuration or secret failure.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime
import os
from typing import Any

from bluewolf_ingest.influxdb2 import InfluxDB2StreamSchema
from bluewolf_ingest.join import TemporalJoinConfig
from bluewolf_ingest.navigation_simulation import (
    SimulatedNavigationMetricAdapter,
    SyntheticNavigationVehicle,
)
from bluewolf_ingest.window_reader import InfluxDB2WindowReader

from .runtime_config_common import _connection_and_reader, _integer, _number, _object
from .simulation_storage_guard import assert_simulation_storage_isolated


def navigation_source_mode(config: Mapping[str, Any]) -> str:
    source = _object(config.get("navigationSource", {"mode": "influxdb2"}), "navigationSource")
    mode = source.get("mode", "influxdb2")
    if mode not in {"influxdb2", "influxdb2-test", "simulation"}:
        raise ValueError("navigationSource.mode must be influxdb2, influxdb2-test or simulation")
    return str(mode)


def _simulation_vehicle(raw: object, index: int) -> SyntheticNavigationVehicle:
    item = _object(raw, f"navigationSource.vehicles[{index}]")
    prefix = f"navigationSource.vehicles[{index}]"
    required = (
        "serverId", "vehicleNumber", "centerLatitude", "centerLongitude",
        "radiusMeters", "periodSeconds",
    )
    missing = [key for key in required if key not in item]
    if missing:
        raise ValueError(f"{prefix} is missing {', '.join(missing)}")
    vehicle_id_raw = item.get("vehicleIdentifier")
    vehicle_id = None if vehicle_id_raw is None else _integer(vehicle_id_raw, f"{prefix}.vehicleIdentifier")
    shape = item.get("shape", "circle")
    direction = item.get("direction", "counterclockwise")
    if not isinstance(shape, str) or not isinstance(direction, str):
        raise ValueError(f"{prefix} shape and direction must be strings")
    return SyntheticNavigationVehicle(
        server_id=_integer(item["serverId"], f"{prefix}.serverId"),
        vehicle_number=_integer(item["vehicleNumber"], f"{prefix}.vehicleNumber"),
        vehicle_identifier=vehicle_id,
        center_latitude_deg=_number(item["centerLatitude"], f"{prefix}.centerLatitude"),
        center_longitude_deg=_number(item["centerLongitude"], f"{prefix}.centerLongitude"),
        radius_m=_number(item["radiusMeters"], f"{prefix}.radiusMeters"),
        period_s=_number(item["periodSeconds"], f"{prefix}.periodSeconds"),
        route_shape=shape,
        straight_length_m=_number(item.get("straightLengthMeters", 0), f"{prefix}.straightLengthMeters"),
        phase_fraction=_number(item.get("phaseFraction", 0), f"{prefix}.phaseFraction"),
        heading_deg=_number(item.get("headingDegrees", 0), f"{prefix}.headingDegrees"),
        direction=direction,
        altitude_m=_number(item.get("altitudeMeters", 0), f"{prefix}.altitudeMeters"),
    )


def navigation_reader_and_schema(
    config: Mapping[str, Any],
) -> tuple[InfluxDB2WindowReader, InfluxDB2StreamSchema]:
    mode = navigation_source_mode(config)
    if mode == "influxdb2":
        # No fallback on missing/invalid Influx credentials or failed reads.
        return _connection_and_reader(config)
    if os.environ.get("BLUEWOLF_TEST_MODE") != "1":
        raise ValueError("TEST navigation requires BLUEWOLF_TEST_MODE=1")
    # TEST navigation may come either from the in-process raw simulator or from
    # an actual disposable InfluxDB2. Both must use isolated persistence and
    # both retain explicit TEST provenance after the real join/Core pipeline.
    assert_simulation_storage_isolated(config)
    if mode == "influxdb2-test":
        return _connection_and_reader(config)
    source = _object(config.get("navigationSource"), "navigationSource")
    started_raw = source.get("startedAtUtc")
    if not isinstance(started_raw, str) or not started_raw:
        raise ValueError("navigationSource.startedAtUtc must be an explicit UTC timestamp")
    try:
        started = datetime.fromisoformat(started_raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("navigationSource.startedAtUtc must be ISO-8601") from exc
    if started.tzinfo is None or started.utcoffset().total_seconds() != 0:
        raise ValueError("navigationSource.startedAtUtc must specify UTC")
    raw_vehicles = source.get("vehicles")
    if not isinstance(raw_vehicles, list) or not raw_vehicles:
        raise ValueError("navigationSource.vehicles must be a non-empty list")
    adapter = SimulatedNavigationMetricAdapter(
        vehicles=tuple(_simulation_vehicle(raw, index) for index, raw in enumerate(raw_vehicles)),
        started_at_utc=started,
        sample_seconds=_integer(source.get("sampleSeconds", 1), "navigationSource.sampleSeconds", minimum=1),
    )
    join = _object(config.get("join", {}), "join")
    join_config = TemporalJoinConfig(
        logical_grid_seconds=_integer(join.get("logicalGridSeconds", 1), "join.logicalGridSeconds", minimum=1),
        tolerance_seconds=_integer(join.get("toleranceSeconds", 5), "join.toleranceSeconds", minimum=1),
        original_reliability=_number(join.get("originalReliability", 1.0), "join.originalReliability"),
        approximated_reliability=_number(join.get("approximatedReliability", 0.75), "join.approximatedReliability"),
    )
    # Reuse the *same* production temporal join, cursor, CoreSession and archive.
    reader = InfluxDB2WindowReader(adapter, join_config)  # type: ignore[arg-type]
    # The physical Influx schema does not exist in test mode; only the server
    # routing requirement of the neutral operational factory uses this object.
    schema = InfluxDB2StreamSchema(vehicle_number_column="vehicle_number")
    return reader, schema


class SimulatedNavigationPublicationStore:
    """Mark and preserve TEST source provenance through publication AND restart."""

    def __init__(self, store: Any) -> None:
        self.store = store

    @staticmethod
    def _valid_test_source(source: object) -> bool:
        return (
            isinstance(source, Mapping)
            and source.get("kind") == "python-core"
            and source.get("navigationOrigin") == "simulation"
            and source.get("syntheticNavigation") is True
        )

    def publish(self, snapshot: Mapping[str, object]) -> None:
        source = snapshot.get("source")
        if not isinstance(source, Mapping) or source.get("kind") != "python-core":
            raise ValueError("synthetic navigation may only publish a real Python Core result")
        has_marker = "navigationOrigin" in source or "syntheticNavigation" in source
        if has_marker and not self._valid_test_source(source):
            raise ValueError("synthetic navigation checkpoint has conflicting source provenance")
        if has_marker:
            # Replaying a checkpoint must not repeatedly prepend TEST labels.
            self.store.publish(snapshot)
            return
        marked_source = {
            **dict(source),
            "navigationOrigin": "simulation",
            "syntheticNavigation": True,
            "detail": f"TEST NAVIGATION · {source.get('detail', '')}",
        }
        self.store.publish({
            **dict(snapshot),
            "source": marked_source,
            "status": f"בדיקות ניווט סינתטי · {snapshot.get('status', '')}",
        })

    def get(self, server_id: str) -> dict[str, Any] | None:
        return self.store.get(server_id)

    def history(self, server_id: str, *, limit: int | None = None) -> list[dict[str, Any]]:
        return self.store.history(server_id, limit=limit)

    def restore_history(self, server_id: str, rows: Sequence[Mapping[str, Any]]) -> None:
        # Restored TEST history cannot shed its navigation-origin marker and
        # masquerade as true Influx data. Validate before mutating the store.
        if any(not self._valid_test_source(row.get("source")) for row in rows):
            raise ValueError("restored synthetic-navigation history must retain TEST source provenance")
        self.store.restore_history(server_id, rows)

    def clear(self, server_id: str | None = None) -> None:
        self.store.clear(server_id)


__all__ = [
    "SimulatedNavigationPublicationStore",
    "navigation_reader_and_schema",
    "navigation_source_mode",
]
