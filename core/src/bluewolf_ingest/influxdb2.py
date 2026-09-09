"""InfluxDB 2 Flux adapter that emits raw points for the deterministic join layer.

This module deliberately stops at ``RawMetricPoint``. It does not interpolate,
forward-fill, detect routes, group vehicles or calculate scores. Those concerns
already have validated implementations elsewhere.

The physical Influx schema is configurable. In particular, Blue Wolf V1
requires joining by ``(server_id, vehicle_number)`` but does not prescribe the
Influx tag/column names that carry those identities. The adapter therefore
never hard-codes a TTAG, ``server_id`` tag or ``vehicle_number`` tag.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
import json
import math
from typing import Any, Callable, Iterable, Mapping, Protocol

from .models import MetricName, MetricValue, RawMetricPoint


class InfluxDB2AdapterError(RuntimeError):
    """Influx query output cannot be converted into an unambiguous raw stream."""


@dataclass(frozen=True, slots=True)
class InfluxDB2Connection:
    url: str
    organization: str
    token: str
    timeout_ms: int = 10_000

    def __post_init__(self) -> None:
        if not self.url.strip():
            raise ValueError("InfluxDB2 url is required")
        if not self.organization.strip():
            raise ValueError("InfluxDB2 organization is required")
        if not self.token:
            raise ValueError("InfluxDB2 token is required")
        if self.timeout_ms <= 0:
            raise ValueError("InfluxDB2 timeout_ms must be positive")


@dataclass(frozen=True, slots=True)
class InfluxDB2StreamSchema:
    """Columns/tags that identify one Blue Wolf source stream in query results."""

    vehicle_number_column: str
    server_column: str | None = None

    def __post_init__(self) -> None:
        if not self.vehicle_number_column.strip():
            raise ValueError("vehicle_number_column is required")
        if self.server_column is not None and not self.server_column.strip():
            raise ValueError("server_column must be non-empty when supplied")


@dataclass(frozen=True, slots=True)
class InfluxDB2MetricMapping:
    """Map one Influx measurement+field pair into a normalized metric."""

    metric: MetricName
    bucket: str
    measurement: str
    field: str
    value_map: tuple[tuple[str, MetricValue], ...] = ()

    def __post_init__(self) -> None:
        if not self.bucket.strip():
            raise ValueError("bucket is required")
        if not self.measurement.strip():
            raise ValueError("measurement is required")
        if not self.field.strip():
            raise ValueError("field is required")
        normalized_keys: set[str] = set()
        for source, _ in self.value_map:
            key = str(source).strip().lower()
            if not key:
                raise ValueError("value_map source values must be non-empty")
            if key in normalized_keys:
                raise ValueError(f"duplicate value_map source: {source!r}")
            normalized_keys.add(key)


class _FluxRecord(Protocol):
    values: Mapping[str, Any]

    def get_time(self) -> datetime: ...

    def get_measurement(self) -> str: ...

    def get_field(self) -> str: ...

    def get_value(self) -> Any: ...


class _FluxTable(Protocol):
    records: Iterable[_FluxRecord]


class _QueryAPI(Protocol):
    def query(self, *, org: str, query: str) -> Iterable[_FluxTable]: ...


class _InfluxClient(Protocol):
    def query_api(self) -> _QueryAPI: ...

    def close(self) -> None: ...


ClientFactory = Callable[[InfluxDB2Connection], _InfluxClient]


def _default_client_factory(connection: InfluxDB2Connection) -> _InfluxClient:
    try:
        from influxdb_client import InfluxDBClient
    except ImportError as exc:  # pragma: no cover - deployment-only guard.
        raise InfluxDB2AdapterError(
            "InfluxDB2 client is not installed; install the 'influx' extra"
        ) from exc
    return InfluxDBClient(
        url=connection.url,
        token=connection.token,
        org=connection.organization,
        timeout=connection.timeout_ms,
    )


def _utc(value: datetime, *, name: str) -> datetime:
    if value.tzinfo is None:
        raise ValueError(f"{name} must be timezone-aware")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _query_bounds(start_time_utc: datetime, stop_time_utc: datetime) -> tuple[datetime, datetime]:
    start = _utc(start_time_utc, name="start_time_utc")
    stop = _utc(stop_time_utc, name="stop_time_utc")
    if stop <= start:
        raise ValueError("stop_time_utc must be after start_time_utc")
    return start, stop


def _flux_string(value: object) -> str:
    """Return one escaped Flux string literal using JSON-compatible quoting."""

    return json.dumps(str(value), ensure_ascii=False)


def _record_column(record: _FluxRecord, column: str) -> Any:
    try:
        return record.values[column]
    except KeyError as exc:
        raise InfluxDB2AdapterError(
            f"Influx record is missing stream identity column {column!r}"
        ) from exc


def _vehicle_number(value: Any) -> int:
    if isinstance(value, bool):
        raise InfluxDB2AdapterError("vehicle number cannot be boolean")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise InfluxDB2AdapterError(f"invalid vehicle number {value!r}") from exc
    if not math.isfinite(number) or number < 0 or not number.is_integer():
        raise InfluxDB2AdapterError(f"invalid vehicle number {value!r}")
    return int(number)


def _mapped_value(mapping: InfluxDB2MetricMapping, value: Any) -> MetricValue:
    normalized = str(value).strip().lower()
    for source, replacement in mapping.value_map:
        if normalized == str(source).strip().lower():
            return replacement
    if isinstance(value, (str, bool, int, float)):
        return value
    raise InfluxDB2AdapterError(
        f"unsupported value type for {mapping.metric.value}: {type(value).__name__}"
    )


def _mapping_index(
    mappings: Iterable[InfluxDB2MetricMapping],
) -> dict[tuple[str, str, str], InfluxDB2MetricMapping]:
    index: dict[tuple[str, str, str], InfluxDB2MetricMapping] = {}
    seen_metrics: set[MetricName] = set()
    for mapping in mappings:
        key = (mapping.bucket, mapping.measurement, mapping.field)
        if key in index:
            raise ValueError(f"duplicate Influx series mapping: {key!r}")
        if mapping.metric in seen_metrics:
            raise ValueError(f"metric mapped more than once: {mapping.metric.value}")
        index[key] = mapping
        seen_metrics.add(mapping.metric)
    if not index:
        raise ValueError("at least one Influx metric mapping is required")
    return index


def _by_bucket(
    mappings: Iterable[InfluxDB2MetricMapping],
) -> tuple[tuple[str, tuple[InfluxDB2MetricMapping, ...]], ...]:
    grouped: dict[str, list[InfluxDB2MetricMapping]] = defaultdict(list)
    for mapping in mappings:
        grouped[mapping.bucket].append(mapping)
    return tuple(
        (
            bucket,
            tuple(sorted(bucket_mappings, key=lambda item: (item.measurement, item.field))),
        )
        for bucket, bucket_mappings in sorted(grouped.items())
    )


def _build_bucket_query(
    bucket: str,
    mappings: Iterable[InfluxDB2MetricMapping],
    *,
    schema: InfluxDB2StreamSchema,
    server_tag_value: str | None,
    start_time_utc: datetime,
    stop_time_utc: datetime,
) -> str:
    clauses = [
        f'(r._measurement == {_flux_string(mapping.measurement)} '
        f'and r._field == {_flux_string(mapping.field)})'
        for mapping in mappings
    ]
    series_filter = " or ".join(clauses)
    lines = [
        f"from(bucket: {_flux_string(bucket)})",
        f"  |> range(start: time(v: {_flux_string(_iso(start_time_utc))}), "
        f"stop: time(v: {_flux_string(_iso(stop_time_utc))}))",
        f"  |> filter(fn: (r) => {series_filter})",
    ]
    if schema.server_column is not None:
        if server_tag_value is None:
            raise ValueError("server_tag_value is required when server_column is configured")
        lines.append(
            "  |> filter(fn: (r) => "
            f'r[{_flux_string(schema.server_column)}] == {_flux_string(server_tag_value)})'
        )
    lines.append('  |> sort(columns: ["_time"])')
    return "\n".join(lines)


class InfluxDB2Adapter:
    """Query mapped InfluxDB2 series and return original, unjoined raw points."""

    def __init__(
        self,
        connection: InfluxDB2Connection,
        schema: InfluxDB2StreamSchema,
        mappings: Iterable[InfluxDB2MetricMapping],
        *,
        client_factory: ClientFactory = _default_client_factory,
    ) -> None:
        self.connection = connection
        self.schema = schema
        self._mapping_by_series = _mapping_index(tuple(mappings))
        self.client_factory = client_factory

    @property
    def mappings(self) -> tuple[InfluxDB2MetricMapping, ...]:
        return tuple(self._mapping_by_series.values())

    def flux_queries(
        self,
        *,
        server_tag_value: str | None,
        start_time_utc: datetime,
        stop_time_utc: datetime,
    ) -> tuple[str, ...]:
        start, stop = _query_bounds(start_time_utc, stop_time_utc)
        return tuple(
            _build_bucket_query(
                bucket,
                bucket_mappings,
                schema=self.schema,
                server_tag_value=server_tag_value,
                start_time_utc=start,
                stop_time_utc=stop,
            )
            for bucket, bucket_mappings in _by_bucket(self.mappings)
        )

    def query_points(
        self,
        *,
        server_id: int,
        server_tag_value: str | None,
        start_time_utc: datetime,
        stop_time_utc: datetime,
    ) -> tuple[RawMetricPoint, ...]:
        if isinstance(server_id, bool) or not isinstance(server_id, int) or server_id < 0:
            raise ValueError("server_id must be a non-negative integer")
        start, stop = _query_bounds(start_time_utc, stop_time_utc)

        client = self.client_factory(self.connection)
        points: list[RawMetricPoint] = []
        try:
            query_api = client.query_api()
            for bucket, bucket_mappings in _by_bucket(self.mappings):
                query = _build_bucket_query(
                    bucket,
                    bucket_mappings,
                    schema=self.schema,
                    server_tag_value=server_tag_value,
                    start_time_utc=start,
                    stop_time_utc=stop,
                )
                tables = query_api.query(org=self.connection.organization, query=query)
                for table in tables:
                    for record in table.records:
                        measurement = str(record.get_measurement())
                        field = str(record.get_field())
                        matching = [
                            mapping
                            for mapping in bucket_mappings
                            if mapping.measurement == measurement and mapping.field == field
                        ]
                        if len(matching) != 1:
                            raise InfluxDB2AdapterError(
                                "Influx record does not match exactly one configured metric: "
                                f"bucket={bucket!r}, measurement={measurement!r}, field={field!r}"
                            )
                        mapping = matching[0]
                        record_time = record.get_time()
                        if record_time.tzinfo is None:
                            raise InfluxDB2AdapterError("Influx _time must be timezone-aware")
                        points.append(
                            RawMetricPoint(
                                source_time_utc=record_time,
                                server_id=server_id,
                                vehicle_number=_vehicle_number(
                                    _record_column(record, self.schema.vehicle_number_column)
                                ),
                                metric=mapping.metric,
                                value=_mapped_value(mapping, record.get_value()),
                            )
                        )
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()

        points.sort(
            key=lambda item: (
                item.source_time_utc,
                item.vehicle_number,
                item.metric.value,
            )
        )
        return tuple(points)


__all__ = [
    "InfluxDB2Adapter",
    "InfluxDB2AdapterError",
    "InfluxDB2Connection",
    "InfluxDB2MetricMapping",
    "InfluxDB2StreamSchema",
]
