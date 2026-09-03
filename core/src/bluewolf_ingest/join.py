"""Deterministic temporal join for separately queried Influx metrics."""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Iterable

from bluewolf_core.models import FieldQuality, VehicleSample

from .models import MetricName, MetricValue, RawMetricPoint


class TemporalJoinError(ValueError):
    """The raw inputs cannot be joined without an ambiguous choice."""


@dataclass(frozen=True, slots=True)
class TemporalJoinConfig:
    logical_grid_seconds: int = 1
    tolerance_seconds: int = 5
    original_reliability: float = 1.0
    approximated_reliability: float = 0.75
    active_on_values: tuple[str, ...] = ("true", "1", "on", "green", "active")
    active_off_values: tuple[str, ...] = ("false", "0", "off", "red", "inactive")

    def __post_init__(self) -> None:
        if self.logical_grid_seconds <= 0 or self.tolerance_seconds <= 0:
            raise ValueError("grid and tolerance must be positive")
        for value in (self.original_reliability, self.approximated_reliability):
            if not 0 <= value <= 1:
                raise ValueError("reliability values must be in [0, 1]")


@dataclass(frozen=True, slots=True)
class _IndexedSeries:
    points: tuple[RawMetricPoint, ...]
    times: tuple[datetime, ...]


_EMPTY_SERIES = _IndexedSeries((), ())


def _ceil_grid(value: datetime, seconds: int) -> datetime:
    timestamp = value.astimezone(UTC).timestamp()
    return datetime.fromtimestamp(math.ceil(timestamp / seconds) * seconds, tz=UTC)


def _floor_grid(value: datetime, seconds: int) -> datetime:
    timestamp = value.astimezone(UTC).timestamp()
    return datetime.fromtimestamp(math.floor(timestamp / seconds) * seconds, tz=UTC)


def _deduplicate(points: list[RawMetricPoint]) -> _IndexedSeries:
    ordered = sorted(points, key=lambda point: point.source_time_utc)
    output: list[RawMetricPoint] = []
    for point in ordered:
        if output and point.source_time_utc == output[-1].source_time_utc:
            if point.value != output[-1].value:
                raise TemporalJoinError(
                    f"conflicting {point.metric} values at {point.source_time_utc.isoformat()}"
                )
            continue
        output.append(point)
    frozen = tuple(output)
    return _IndexedSeries(frozen, tuple(point.source_time_utc for point in frozen))


def _forward_value(
    series: _IndexedSeries,
    at: datetime,
    tolerance: timedelta,
) -> tuple[MetricValue | None, FieldQuality, float | None]:
    if not series.points:
        return None, FieldQuality.MISSING, None
    index = bisect_right(series.times, at) - 1
    if index < 0:
        return None, FieldQuality.MISSING, None
    point = series.points[index]
    age = at - point.source_time_utc
    if age > tolerance:
        return None, FieldQuality.MISSING, None
    quality = FieldQuality.ORIGINAL if age == timedelta(0) else FieldQuality.FORWARD_FILLED
    return point.value, quality, age.total_seconds()


def _numeric_value(
    series: _IndexedSeries,
    at: datetime,
    tolerance: timedelta,
) -> tuple[
    float | None,
    FieldQuality,
    tuple[datetime, datetime] | None,
    float | None,
]:
    if not series.points:
        return None, FieldQuality.MISSING, None, None
    index = bisect_left(series.times, at)
    if index < len(series.points) and series.times[index] == at:
        return _finite_float(series.points[index].value), FieldQuality.ORIGINAL, None, 0.0
    if index == 0 or index == len(series.points):
        return None, FieldQuality.MISSING, None, None
    before = series.points[index - 1]
    after = series.points[index]
    if at - before.source_time_utc > tolerance or after.source_time_utc - at > tolerance:
        return None, FieldQuality.MISSING, None, None
    before_value = _finite_float(before.value)
    after_value = _finite_float(after.value)
    span = (after.source_time_utc - before.source_time_utc).total_seconds()
    fraction = (at - before.source_time_utc).total_seconds() / span
    value = before_value + (after_value - before_value) * fraction
    approximation_distance = max(
        (at - before.source_time_utc).total_seconds(),
        (after.source_time_utc - at).total_seconds(),
    )
    return (
        value,
        FieldQuality.INTERPOLATED,
        (before.source_time_utc, after.source_time_utc),
        approximation_distance,
    )


def _finite_float(value: MetricValue) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise TemporalJoinError(f"numeric metric contains {value!r}") from error
    if not math.isfinite(number):
        raise TemporalJoinError("numeric metric must be finite")
    return number


def _vehicle_identifier(value: MetricValue | None) -> int | None:
    if value is None:
        return None
    number = _finite_float(value)
    if not number.is_integer() or number < 0:
        raise TemporalJoinError(f"invalid vehicle identifier {value!r}")
    return int(number)


def _active(value: MetricValue | None, config: TemporalJoinConfig) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {item.lower() for item in config.active_on_values}:
        return True
    if normalized in {item.lower() for item in config.active_off_values}:
        return False
    raise TemporalJoinError(f"active value {value!r} is not mapped")


def _interpolation_stays_in_identity(
    bracket: tuple[datetime, datetime] | None,
    identifier_points: _IndexedSeries,
    active_points: _IndexedSeries,
    target_identifier: int,
    tolerance: timedelta,
    config: TemporalJoinConfig,
) -> bool:
    if bracket is None:
        return True
    for timestamp in bracket:
        identifier_raw, _, _ = _forward_value(identifier_points, timestamp, tolerance)
        if _vehicle_identifier(identifier_raw) != target_identifier:
            return False
        active_raw, _, _ = _forward_value(active_points, timestamp, tolerance)
        if _active(active_raw, config) is False:
            return False
    return True


def _field_reliability(
    quality: FieldQuality,
    approximation_distance_seconds: float | None,
    config: TemporalJoinConfig,
) -> float | None:
    if quality is FieldQuality.MISSING:
        return None
    if quality is FieldQuality.ORIGINAL:
        return config.original_reliability
    if approximation_distance_seconds is None:
        raise AssertionError("approximated field requires a source distance")
    fraction = min(1.0, approximation_distance_seconds / config.tolerance_seconds)
    return config.original_reliability - (
        config.original_reliability - config.approximated_reliability
    ) * fraction


def join_metric_points(
    points: Iterable[RawMetricPoint],
    *,
    config: TemporalJoinConfig | None = None,
    start_time_utc: datetime | None = None,
    end_time_utc: datetime | None = None,
) -> tuple[VehicleSample, ...]:
    """Join raw series onto a stable UTC grid.

    Vehicle identifier and active are forward-filled for at most five seconds.
    Numeric navigation fields require two bracketing originals and are linearly
    interpolated.  An interpolation never crosses an identifier change or an
    inactive state.  Exact originals always win.
    """
    config = config or TemporalJoinConfig()
    grouped: dict[
        tuple[int, int], dict[MetricName, list[RawMetricPoint]]
    ] = defaultdict(lambda: defaultdict(list))
    all_points = tuple(points)
    for point in all_points:
        grouped[(point.server_id, point.vehicle_number)][point.metric].append(point)
    if not grouped:
        return ()

    if (start_time_utc and start_time_utc.tzinfo is None) or (
        end_time_utc and end_time_utc.tzinfo is None
    ):
        raise ValueError("join bounds must be timezone-aware")
    requested_start = start_time_utc.astimezone(UTC) if start_time_utc else None
    requested_end = end_time_utc.astimezone(UTC) if end_time_utc else None
    if requested_start and requested_end and requested_end < requested_start:
        raise ValueError("end_time_utc must not precede start_time_utc")

    tolerance = timedelta(seconds=config.tolerance_seconds)
    samples: list[VehicleSample] = []
    numeric_metrics = (
        MetricName.LATITUDE,
        MetricName.LONGITUDE,
        MetricName.ALTITUDE,
        MetricName.VELOCITY_NORTH,
        MetricName.VELOCITY_EAST,
    )

    for (server_id, vehicle_number), raw_series in sorted(grouped.items()):
        series = {metric: _deduplicate(values) for metric, values in raw_series.items()}
        stream_points = [point for value in series.values() for point in value.points]
        first_source_time = min(point.source_time_utc for point in stream_points)
        last_source_time = max(point.source_time_utc for point in stream_points)
        stream_start = max(requested_start, first_source_time) if requested_start else first_source_time
        last_possible_time = last_source_time + tolerance
        stream_end = min(requested_end, last_possible_time) if requested_end else last_source_time
        cursor = _ceil_grid(stream_start, config.logical_grid_seconds)
        end = _floor_grid(stream_end, config.logical_grid_seconds)
        identifier_points = series.get(MetricName.VEHICLE_IDENTIFIER, _EMPTY_SERIES)
        active_points = series.get(MetricName.ACTIVE, _EMPTY_SERIES)

        while cursor <= end:
            identifier_raw, identifier_quality, identifier_distance = _forward_value(
                identifier_points, cursor, tolerance
            )
            identifier = _vehicle_identifier(identifier_raw)
            if identifier is None:
                cursor += timedelta(seconds=config.logical_grid_seconds)
                continue
            active_raw, active_quality, active_distance = _forward_value(
                active_points, cursor, tolerance
            )
            active = _active(active_raw, config)

            values: dict[MetricName, float | None] = {}
            qualities: dict[str, FieldQuality] = {
                MetricName.VEHICLE_IDENTIFIER.value: identifier_quality,
                MetricName.ACTIVE.value: active_quality,
            }
            field_reliabilities = [
                _field_reliability(identifier_quality, identifier_distance, config),
                _field_reliability(active_quality, active_distance, config),
            ]
            for metric in numeric_metrics:
                value, quality, bracket, approximation_distance = _numeric_value(
                    series.get(metric, _EMPTY_SERIES), cursor, tolerance
                )
                if value is not None and not _interpolation_stays_in_identity(
                    bracket,
                    identifier_points,
                    active_points,
                    identifier,
                    tolerance,
                    config,
                ):
                    value, quality, approximation_distance = None, FieldQuality.MISSING, None
                values[metric] = value
                qualities[metric.value] = quality
                field_reliabilities.append(
                    _field_reliability(quality, approximation_distance, config)
                )

            latitude = values[MetricName.LATITUDE]
            longitude = values[MetricName.LONGITUDE]
            if (latitude is None) != (longitude is None):
                latitude = longitude = None
                qualities[MetricName.LATITUDE.value] = FieldQuality.MISSING
                qualities[MetricName.LONGITUDE.value] = FieldQuality.MISSING
            if latitude is None and active is not False:
                cursor += timedelta(seconds=config.logical_grid_seconds)
                continue

            present_reliabilities = [
                value for value in field_reliabilities if value is not None
            ]
            reliability = min(present_reliabilities) if present_reliabilities else 0.0
            samples.append(
                VehicleSample(
                    sample_time_utc=cursor,
                    server_id=server_id,
                    vehicle_number=vehicle_number,
                    vehicle_identifier=identifier,
                    active=active,
                    latitude_deg=latitude,
                    longitude_deg=longitude,
                    altitude_m=values[MetricName.ALTITUDE],
                    velocity_north_mps=values[MetricName.VELOCITY_NORTH],
                    velocity_east_mps=values[MetricName.VELOCITY_EAST],
                    reliability=reliability,
                    field_quality=qualities,
                )
            )
            cursor += timedelta(seconds=config.logical_grid_seconds)

    samples.sort(
        key=lambda sample: (
            sample.sample_time_utc,
            sample.server_id,
            sample.vehicle_identifier,
            sample.vehicle_number,
        )
    )
    return tuple(samples)
