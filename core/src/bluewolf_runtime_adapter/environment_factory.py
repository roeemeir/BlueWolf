"""Build the operational Blue Wolf runtime from one explicit JSON configuration.

Secrets stay in environment variables. The JSON file owns public deployment
configuration: Influx schema/mappings, polling cadence, developer-approved SO
templates, server tags and explicit vehicle/Route-Instance bindings.

No displayed-score smoothing law is invented here. The only currently approved
configuration mode is ``invalid``; it keeps event low-score semantics and the
operator total score fail-closed until a product smoothing policy is approved.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any, Callable

from bluewolf_core.live_so_event_runtime import LiveSOEventRuntime, TemplateComparisonDimension
from bluewolf_core.live_so_scoring import LiveSOGroupScorer
from bluewolf_core.semantic_session import CoreSession
from bluewolf_core.so_template_bank import (
    SOConstellationRoute,
    SOConstellationSignature,
    SOTemplateBank,
    SOTemplateBankEntry,
)
from bluewolf_core.so_template_selection import SOTemplateSelectionRegistry
from bluewolf_core.so_templates import Quarter, SORouteInstance, SORouteKind, SOTemplate, SOVehicleSlot
from bluewolf_ingest import (
    InfluxDB2Adapter,
    InfluxDB2Connection,
    InfluxDB2MetricMapping,
    InfluxDB2StreamSchema,
    InfluxDB2WindowReader,
    LivePollConfig,
    MetricName,
    ServerPollCursor,
    TemporalJoinConfig,
)

from .ingest_coordinator import LiveCoreIngestCoordinator
from .operational_pipeline import OperationalRuntimeLoop, OperationalServerPipeline
from .operational_state import AtomicOperationalStateStore, CheckpointedOperationalRuntimeLoop
from .position_enrichment import PositionEnrichedLiveRuntimeProducer
from .producer import (
    DisplayedScoreValue,
    SOOperationalGroupBinding,
    SOOperationalMemberBinding,
)
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


def _parse_template(raw: object, index: int) -> SOTemplateBankEntry:
    value = _object(raw, f"templates[{index}]")
    template_id = _text(value.get("id"), f"templates[{index}].id")
    name = _text(value.get("name"), f"templates[{index}].name")
    route_instances: list[SORouteInstance] = []
    for route_index, raw_route in enumerate(
        _list(value.get("routes"), f"templates[{index}].routes")
    ):
        route = _object(raw_route, f"templates[{index}].routes[{route_index}]")
        route_id = _text(
            route.get("id"),
            f"templates[{index}].routes[{route_index}].id",
        )
        try:
            route_kind = SORouteKind(
                _text(
                    route.get("kind"),
                    f"templates[{index}].routes[{route_index}].kind",
                )
            )
        except ValueError as exc:
            raise ValueError(
                f"templates[{index}].routes[{route_index}].kind is invalid"
            ) from exc
        slots: list[SOVehicleSlot] = []
        for slot_index, raw_slot in enumerate(
            _list(
                route.get("slots"),
                f"templates[{index}].routes[{route_index}].slots",
            )
        ):
            slot = _object(
                raw_slot,
                f"templates[{index}].routes[{route_index}].slots[{slot_index}]",
            )
            try:
                quarter = Quarter(
                    _text(
                        slot.get("quarter"),
                        f"templates[{index}].routes[{route_index}].slots[{slot_index}].quarter",
                    )
                )
            except ValueError as exc:
                raise ValueError("template slot quarter must be Q0, Q1, Q2 or Q3") from exc
            slots.append(
                SOVehicleSlot(
                    slot_id=_text(slot.get("id"), "template slot id"),
                    vehicle_type=_text(slot.get("vehicleType"), "template slot vehicleType"),
                    quarter=quarter,
                )
            )
        route_instances.append(
            SORouteInstance(
                route_instance_id=route_id,
                route_kind=route_kind,
                vehicle_slots=tuple(slots),
                geometry_profile_ref=_optional_text(
                    route.get("geometryProfileRef"),
                    "template geometryProfileRef",
                ),
            )
        )
    return SOTemplateBankEntry(
        SOTemplate(template_id, name, tuple(route_instances)),
        is_default=bool(value.get("default", False)),
    )


def _template_bank(config: Mapping[str, Any]) -> SOTemplateBank:
    raw_templates = _list(config.get("templates"), "templates")
    if not raw_templates:
        raise ValueError("templates cannot be empty")
    return SOTemplateBank(
        tuple(_parse_template(raw, index) for index, raw in enumerate(raw_templates))
    )


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
                measurement=_text(
                    value.get("measurement"),
                    f"influx.metrics[{index}].measurement",
                ),
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
        vehicle_number_column=_text(
            stream.get("vehicleNumberColumn"),
            "influx.stream.vehicleNumberColumn",
        ),
        server_column=_optional_text(stream.get("serverColumn"), "influx.stream.serverColumn"),
    )
    connection = InfluxDB2Connection(
        url=_text(influx.get("url"), "influx.url"),
        organization=_text(influx.get("organization"), "influx.organization"),
        token=token,
        timeout_ms=_integer(influx.get("timeoutMs", 10_000), "influx.timeoutMs", minimum=1),
    )
    join = _object(config.get("join", {}), "join")
    join_config = TemporalJoinConfig(
        logical_grid_seconds=_integer(
            join.get("logicalGridSeconds", 1),
            "join.logicalGridSeconds",
            minimum=1,
        ),
        tolerance_seconds=_integer(
            join.get("toleranceSeconds", 5),
            "join.toleranceSeconds",
            minimum=1,
        ),
        original_reliability=_number(
            join.get("originalReliability", 1.0),
            "join.originalReliability",
        ),
        approximated_reliability=_number(
            join.get("approximatedReliability", 0.75),
            "join.approximatedReliability",
        ),
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
        logical_grid_seconds=_integer(
            polling.get("logicalGridSeconds", 1),
            "polling.logicalGridSeconds",
            minimum=1,
        ),
        active_poll_seconds=_integer(
            polling.get("activePollSeconds", 5),
            "polling.activePollSeconds",
            minimum=1,
        ),
        idle_probe_seconds=_integer(
            polling.get("idleProbeSeconds", 300),
            "polling.idleProbeSeconds",
            minimum=1,
        ),
        join_tolerance_seconds=configured_tolerance,
        bootstrap_history_seconds=_integer(
            polling.get("bootstrapHistorySeconds", 2400),
            "polling.bootstrapHistorySeconds",
            minimum=1,
        ),
    )


def _sample_archive(config: Mapping[str, Any]) -> JoinedSampleArchive | None:
    raw = config.get("archive")
    if raw is None:
        return None
    archive = _object(raw, "archive")
    path = _text(archive.get("path"), "archive.path")
    return JoinedSampleArchive(path)


def _binding_from_config(raw: object, index: int) -> tuple[frozenset[int], Callable[[str], SOOperationalGroupBinding]]:
    value = _object(raw, f"server.groups[{index}]")
    arena = _text(value.get("arena"), f"server.groups[{index}].arena")
    color = _text(value.get("color"), f"server.groups[{index}].color")
    name = _optional_text(value.get("name"), f"server.groups[{index}].name")
    subtitle = _text(
        value.get("subtitle", "Python Core · SO"),
        f"server.groups[{index}].subtitle",
    )
    route_kinds: dict[str, SORouteKind] = {}
    route_order: list[str] = []
    for route_index, raw_route in enumerate(
        _list(value.get("routeInstances"), f"server.groups[{index}].routeInstances")
    ):
        route = _object(raw_route, f"server.groups[{index}].routeInstances[{route_index}]")
        route_id = _text(route.get("id"), "binding route instance id")
        if route_id in route_kinds:
            raise ValueError("binding route instance ids must be unique")
        try:
            route_kinds[route_id] = SORouteKind(_text(route.get("kind"), "binding route kind"))
        except ValueError as exc:
            raise ValueError("binding route kind must be single or double") from exc
        route_order.append(route_id)
    if not route_order:
        raise ValueError("binding routeInstances cannot be empty")

    members: list[SOOperationalMemberBinding] = []
    for member_index, raw_member in enumerate(
        _list(value.get("members"), f"server.groups[{index}].members")
    ):
        member = _object(raw_member, f"server.groups[{index}].members[{member_index}]")
        route_instance_id = _text(member.get("routeInstanceId"), "binding member routeInstanceId")
        if route_instance_id not in route_kinds:
            raise ValueError("binding member references an unknown routeInstanceId")
        members.append(
            SOOperationalMemberBinding(
                vehicle_identifier=_integer(
                    member.get("vehicleId"),
                    "binding member vehicleId",
                ),
                vehicle_type=_text(member.get("vehicleType"), "binding member vehicleType"),
                route_instance_id=route_instance_id,
                work_speed_mps=_number(
                    member.get("workSpeedMps"),
                    "binding member workSpeedMps",
                    positive=True,
                ),
                member_id=_optional_text(member.get("memberId"), "binding member memberId"),
            )
        )
    if not members:
        raise ValueError("binding members cannot be empty")

    types_by_route: dict[str, list[str]] = {route_id: [] for route_id in route_order}
    for member in members:
        types_by_route[member.route_instance_id].append(member.vehicle_type)
    constellation_routes: list[SOConstellationRoute] = []
    for route_id in route_order:
        vehicle_types = tuple(types_by_route[route_id])
        if not vehicle_types:
            raise ValueError("every binding route instance must have at least one member")
        constellation_routes.append(SOConstellationRoute(route_kinds[route_id], vehicle_types))
    constellation = SOConstellationSignature(tuple(constellation_routes))
    member_tuple = tuple(members)
    vehicle_set = frozenset(member.vehicle_identifier for member in member_tuple)

    def build(group_id: str) -> SOOperationalGroupBinding:
        return SOOperationalGroupBinding(
            group_id=group_id,
            constellation=constellation,
            members=member_tuple,
            arena=arena,
            group_name=name,
            subtitle=subtitle,
            color=color,
        )

    return vehicle_set, build


def _binding_resolver(server: Mapping[str, Any]):
    configured: dict[frozenset[int], Callable[[str], SOOperationalGroupBinding]] = {}
    for index, raw in enumerate(_list(server.get("groups"), "server.groups")):
        vehicle_set, builder = _binding_from_config(raw, index)
        if vehicle_set in configured:
            raise ValueError("server group bindings must have unique vehicle sets")
        configured[vehicle_set] = builder

    def resolve(group):
        vehicle_set = frozenset(key[1] for key in group.member_keys)
        builder = configured.get(vehicle_set)
        return None if builder is None else builder(group.group_id)

    return resolve


def _displayed_score_resolver(config: Mapping[str, Any]):
    displayed = _object(config.get("displayedScore", {"mode": "invalid"}), "displayedScore")
    mode = _text(displayed.get("mode", "invalid"), "displayedScore.mode")
    if mode != "invalid":
        raise ValueError(
            "unsupported displayedScore.mode; only 'invalid' is allowed until smoothing is specified"
        )

    def resolve(group_id, observed_at):
        del group_id, observed_at
        return DisplayedScoreValue(None, False)

    return resolve


def _server_awake_at_latest_snapshot(samples, core_result, window) -> bool:
    """Use only the newest joined logical snapshot, never the whole bootstrap history."""

    del core_result, window
    if not samples:
        return False
    latest = max(sample.sample_time_utc for sample in samples)
    return any(
        sample.sample_time_utc == latest and sample.active is True
        for sample in samples
    )


def build_operational_runtime(config: Mapping[str, Any], store: Any) -> OperationalRuntimeLoop:
    """Compose all configured servers without opening an Influx connection yet."""

    bank = _template_bank(config)
    reader, stream_schema = _connection_and_reader(config)
    poll_config = _poll_config(config, reader.join_config.tolerance_seconds)
    sample_archive = _sample_archive(config)
    comparison = TemplateComparisonDimension(
        _text(config.get("comparisonDimension", "sync"), "comparisonDimension")
    )
    displayed_score_resolver = _displayed_score_resolver(config)
    pipelines: list[OperationalServerPipeline] = []

    raw_servers = _list(config.get("servers"), "servers")
    if not raw_servers:
        raise ValueError("servers cannot be empty")
    seen_server_ids: set[int] = set()
    for index, raw_server in enumerate(raw_servers):
        server = _object(raw_server, f"servers[{index}]")
        server_id = _integer(server.get("id"), f"servers[{index}].id")
        if server_id in seen_server_ids:
            raise ValueError("server ids must be unique")
        seen_server_ids.add(server_id)
        server_tag = _optional_text(server.get("tag"), f"servers[{index}].tag")
        if stream_schema.server_column is not None and server_tag is None:
            raise ValueError("server tag is required when influx.stream.serverColumn is configured")
        awake_policy = _text(
            server.get("awakePolicy"),
            f"servers[{index}].awakePolicy",
        )
        if awake_policy != "any-active-latest-snapshot":
            raise ValueError(
                "only awakePolicy='any-active-latest-snapshot' is currently supported"
            )

        session = CoreSession()
        registry = SOTemplateSelectionRegistry(bank)
        scorer = LiveSOGroupScorer(registry)
        runtime = LiveSOEventRuntime(scorer, comparison_dimension=comparison)
        cursor = ServerPollCursor(poll_config)

        coordinator = LiveCoreIngestCoordinator(
            server_id=server_id,
            server_tag_value=server_tag,
            reader=reader,
            session=session,
            cursor=cursor,
            awake_resolver=_server_awake_at_latest_snapshot,
            sample_archive=sample_archive,
        )
        producer = PositionEnrichedLiveRuntimeProducer(
            server_id=server_id,
            session=session,
            runtime=runtime,
            store=store,
            binding_resolver=_binding_resolver(server),
            displayed_score_resolver=displayed_score_resolver,
        )
        pipelines.append(OperationalServerPipeline(coordinator, producer))

    frozen_pipelines = tuple(pipelines)
    persistence_raw = config.get("persistence")
    if persistence_raw is None:
        return OperationalRuntimeLoop(frozen_pipelines)
    persistence = _object(persistence_raw, "persistence")
    state_path = _text(persistence.get("path"), "persistence.path")
    return CheckpointedOperationalRuntimeLoop(
        frozen_pipelines,
        state_store=AtomicOperationalStateStore(state_path),
        config_fingerprint=_config_fingerprint(config),
    )


def load_operational_config(path: str | os.PathLike[str]) -> Mapping[str, Any]:
    config_path = Path(path)
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"cannot read operational config: {config_path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"operational config is not valid JSON: {config_path}") from exc
    return _object(raw, "operational config")


def build_operational_runtime_from_environment(store: Any) -> OperationalRuntimeLoop:
    path = os.environ.get("BLUEWOLF_OPERATIONAL_CONFIG", "").strip()
    if not path:
        raise ValueError("BLUEWOLF_OPERATIONAL_CONFIG is required")
    return build_operational_runtime(load_operational_config(path), store)


__all__ = [
    "build_operational_runtime",
    "build_operational_runtime_from_environment",
    "load_operational_config",
]
