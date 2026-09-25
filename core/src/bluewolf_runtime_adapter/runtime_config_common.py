"""Family-neutral operational deployment/configuration helpers.

This module owns only infrastructure shared by every runtime family: validated
JSON primitives, Influx ingest, polling, archive placement, displayed-score
policy, configuration fingerprinting and the optional Web workspace bridge.
It intentionally imports no SI/SO scoring or template implementation.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from contextlib import closing
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
from typing import Any

from bluewolf_ingest import (
    InfluxDB2Adapter,
    InfluxDB2Connection,
    InfluxDB2MetricMapping,
    InfluxDB2StreamSchema,
    InfluxDB2WindowReader,
    LivePollConfig,
    MetricName,
    TemporalJoinConfig,
)

from .producer import DisplayedScoreValue
from .sample_archive import JoinedSampleArchive


_REQUIRED_METRICS = {
    MetricName.VEHICLE_IDENTIFIER,
    MetricName.ACTIVE,
    MetricName.LATITUDE,
    MetricName.LONGITUDE,
    MetricName.VELOCITY_NORTH,
    MetricName.VELOCITY_EAST,
}


def _object(value: object, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    return value


def _list(value: object, name: str) -> Sequence[object]:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be a list")
    return value


def _text(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value.strip()


def _integer(value: object, name: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")
    return value


def _number(value: object, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    if positive and result <= 0.0:
        raise ValueError(f"{name} must be positive")
    return result


def _optional_text(value: object, name: str) -> str | None:
    if value is None:
        return None
    return _text(value, name)


def _config_fingerprint(config: Mapping[str, Any]) -> str:
    try:
        canonical = json.dumps(
            config,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("operational config must be finite JSON data") from exc
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _metric_mappings(influx: Mapping[str, Any]) -> tuple[InfluxDB2MetricMapping, ...]:
    rows: list[InfluxDB2MetricMapping] = []
    for index, raw in enumerate(_list(influx.get("metrics"), "influx.metrics")):
        value = _object(raw, f"influx.metrics[{index}]")
        try:
            metric = MetricName(_text(value.get("metric"), f"influx.metrics[{index}].metric"))
        except ValueError as exc:
            raise ValueError(f"influx.metrics[{index}].metric is unsupported") from exc
        raw_value_map = value.get("valueMap", {})
        value_map_object = _object(raw_value_map, f"influx.metrics[{index}].valueMap")
        value_map = tuple(
            (str(source), replacement)
            for source, replacement in sorted(value_map_object.items(), key=lambda item: str(item[0]))
            if isinstance(replacement, (str, bool, int, float))
        )
        if len(value_map) != len(value_map_object):
            raise ValueError(f"influx.metrics[{index}].valueMap has unsupported values")
        rows.append(
            InfluxDB2MetricMapping(
                metric=metric,
                bucket=_text(value.get("bucket"), f"influx.metrics[{index}].bucket"),
                measurement=_text(value.get("measurement"), f"influx.metrics[{index}].measurement"),
                field=_text(value.get("field"), f"influx.metrics[{index}].field"),
                value_map=value_map,
            )
        )
    mapped = {row.metric for row in rows}
    missing = sorted(metric.value for metric in _REQUIRED_METRICS - mapped)
    if missing:
        raise ValueError(f"influx.metrics is missing required metrics: {', '.join(missing)}")
    return tuple(rows)


def _connection_and_reader(config: Mapping[str, Any]) -> tuple[InfluxDB2WindowReader, InfluxDB2StreamSchema]:
    influx = _object(config.get("influx"), "influx")
    token_env = _text(influx.get("tokenEnv", "BLUEWOLF_INFLUX_TOKEN"), "influx.tokenEnv")
    token = os.environ.get(token_env, "")
    if not token:
        raise ValueError(f"Influx token environment variable is missing: {token_env}")
    stream = _object(influx.get("stream"), "influx.stream")
    schema = InfluxDB2StreamSchema(
        vehicle_number_column=_text(stream.get("vehicleNumberColumn"), "influx.stream.vehicleNumberColumn"),
        server_column=_optional_text(stream.get("serverColumn"), "influx.stream.serverColumn"),
        time_column=_text(stream.get("timeColumn", "_time"), "influx.stream.timeColumn"),
    )
    connection = InfluxDB2Connection(
        url=_text(influx.get("url"), "influx.url"),
        organization=_text(influx.get("organization"), "influx.organization"),
        token=token,
        timeout_ms=_integer(influx.get("timeoutMs", 10_000), "influx.timeoutMs", minimum=1),
    )
    join = _object(config.get("join", {}), "join")
    join_config = TemporalJoinConfig(
        logical_grid_seconds=_integer(join.get("logicalGridSeconds", 1), "join.logicalGridSeconds", minimum=1),
        tolerance_seconds=_integer(join.get("toleranceSeconds", 5), "join.toleranceSeconds", minimum=1),
        original_reliability=_number(join.get("originalReliability", 1.0), "join.originalReliability"),
        approximated_reliability=_number(join.get("approximatedReliability", 0.75), "join.approximatedReliability"),
    )
    adapter = InfluxDB2Adapter(connection, schema, _metric_mappings(influx))
    return InfluxDB2WindowReader(adapter, join_config), schema


def _poll_config(config: Mapping[str, Any], join_tolerance_seconds: int) -> LivePollConfig:
    polling = _object(config.get("polling", {}), "polling")
    configured_tolerance = _integer(
        polling.get("joinToleranceSeconds", join_tolerance_seconds),
        "polling.joinToleranceSeconds",
        minimum=1,
    )
    if configured_tolerance != join_tolerance_seconds:
        raise ValueError("polling.joinToleranceSeconds must equal join.toleranceSeconds")
    return LivePollConfig(
        logical_grid_seconds=_integer(polling.get("logicalGridSeconds", 1), "polling.logicalGridSeconds", minimum=1),
        active_poll_seconds=_integer(polling.get("activePollSeconds", 5), "polling.activePollSeconds", minimum=1),
        idle_probe_seconds=_integer(polling.get("idleProbeSeconds", 300), "polling.idleProbeSeconds", minimum=1),
        join_tolerance_seconds=configured_tolerance,
        bootstrap_history_seconds=_integer(polling.get("bootstrapHistorySeconds", 2400), "polling.bootstrapHistorySeconds", minimum=1),
    )


def _sample_archive(config: Mapping[str, Any]) -> JoinedSampleArchive | None:
    deployment_path = os.environ.get("BLUEWOLF_SAMPLE_ARCHIVE_PATH", "").strip()
    raw = config.get("archive")
    if raw is None:
        return None if not deployment_path else JoinedSampleArchive(deployment_path)
    archive = _object(raw, "archive")
    configured_path = _optional_text(archive.get("path"), "archive.path")
    path = deployment_path or configured_path
    if not path:
        raise ValueError("archive.path or BLUEWOLF_SAMPLE_ARCHIVE_PATH is required when archive is enabled")
    return JoinedSampleArchive(path)


def _displayed_score_resolver(config: Mapping[str, Any]):
    displayed = _object(config.get("displayedScore", {"mode": "invalid"}), "displayedScore")
    mode = _text(displayed.get("mode", "invalid"), "displayedScore.mode")
    if mode != "invalid":
        raise ValueError("unsupported displayedScore.mode; only 'invalid' is allowed until smoothing is specified")

    def resolve(group_id, observed_at):
        del group_id, observed_at
        return DisplayedScoreValue(None, False)

    return resolve


def _server_awake_at_latest_snapshot(samples, core_result, window) -> bool:
    del core_result, window
    if not samples:
        return False
    latest = max(sample.sample_time_utc for sample in samples)
    return any(sample.sample_time_utc == latest and sample.active is True for sample in samples)


def load_operational_config(path: str | os.PathLike[str]) -> Mapping[str, Any]:
    config_path = Path(path)
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"cannot read operational config: {config_path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"operational config is not valid JSON: {config_path}") from exc
    config = dict(_object(raw, "operational config"))

    # Optional local Web bridge: consume one committed installation revision at
    # startup only. This is deployment plumbing shared by SI and SO, never a
    # family scoring decision.
    workspace_path = os.environ.get("BLUEWOLF_WORKSPACE_DB", "").strip()
    if workspace_path:
        uri = Path(workspace_path).resolve().as_uri() + "?mode=ro"
        with closing(sqlite3.connect(uri, uri=True)) as connection:
            row = connection.execute("SELECT state FROM workspaces WHERE id='installation'").fetchone()
        if row is not None:
            workspace = _object(json.loads(row[0]), "workspace")
            web_influx = _object(workspace.get("influx", {}), "workspace.influx")
            web_stream = web_influx.get("stream")
            if web_stream is not None:
                influx = dict(_object(config.get("influx"), "influx"))
                influx["stream"] = dict(_object(web_stream, "workspace.influx.stream"))
                config["influx"] = influx
    return config


__all__ = [
    "_config_fingerprint",
    "_connection_and_reader",
    "_displayed_score_resolver",
    "_integer",
    "_list",
    "_number",
    "_object",
    "_optional_text",
    "_poll_config",
    "_sample_archive",
    "_server_awake_at_latest_snapshot",
    "_text",
    "load_operational_config",
]
