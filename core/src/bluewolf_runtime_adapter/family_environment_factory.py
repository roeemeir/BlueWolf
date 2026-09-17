"""Neutral operational factory for first-class SI and SO runtime families.

Shared ingest/session infrastructure is built once per server. Family producers
are then registered as siblings under ``FamilyRuntimeHost``. No family is used as
a base implementation for another family; SI-only, SO-only and SI+SO all use the
same composition path.
"""
from __future__ import annotations

from collections.abc import Mapping
import os
from pathlib import Path
from typing import Any

from bluewolf_core.live_so_event_runtime import LiveSOEventRuntime, TemplateComparisonDimension
from bluewolf_core.live_so_scoring import LiveSOGroupScorer
from bluewolf_core.semantic_session import CoreSession
from bluewolf_core.so_template_selection import SOTemplateSelectionRegistry
from bluewolf_ingest import ServerPollCursor

from .family_runtime import (
    FamilyRuntimeHost,
    SIFamilyRuntimeAdapter,
    SOFamilyRuntimeAdapter,
)
from .ingest_coordinator import LiveCoreIngestCoordinator
from .operational_pipeline import OperationalRuntimeLoop, OperationalServerPipeline
from .operational_state import AtomicOperationalStateStore, CheckpointedOperationalRuntimeLoop
from .producer import LiveRuntimeProducer
from .runtime_config_common import (
    _config_fingerprint,
    _connection_and_reader,
    _displayed_score_resolver,
    _integer,
    _list,
    _object,
    _optional_text,
    _poll_config,
    _sample_archive,
    _server_awake_at_latest_snapshot,
    _text,
    load_operational_config,
)
from .si_producer import LiveSIRuntimeProducer
from .si_template_config import (
    parse_si_templates,
    parse_si_vehicle_types,
    validate_si_runtime_configuration,
)
from .so_family_config import binding_resolver, template_bank


def _server_arena(raw_server: object) -> str:
    """Presentation metadata only; never participate in grouping/scoring."""
    if not isinstance(raw_server, Mapping):
        return "Operational"
    explicit = raw_server.get("arena")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    raw_groups = raw_server.get("groups")
    if isinstance(raw_groups, list):
        arenas = {
            str(group.get("arena")).strip()
            for group in raw_groups
            if isinstance(group, Mapping)
            and isinstance(group.get("arena"), str)
            and str(group.get("arena")).strip()
        }
        if len(arenas) == 1:
            return next(iter(arenas))
    return "Operational"


def build_operational_runtime(
    config: Mapping[str, Any],
    store: RuntimeSnapshotStore,
) -> OperationalRuntimeLoop:
    """Build every server through one family-neutral composition path."""
    raw_so_templates = _list(config.get("templates", []), "templates")
    so_bank = template_bank(config) if raw_so_templates else None

    si_templates = parse_si_templates(config.get("siTemplates"))
    si_vehicle_types = parse_si_vehicle_types(config.get("siVehicleTypes"))
    validate_si_runtime_configuration(si_templates, si_vehicle_types)
    if so_bank is None and not si_templates:
        raise ValueError("at least one SI or SO template family must be configured")

    reader, stream_schema = _connection_and_reader(config)
    poll_config = _poll_config(config, reader.join_config.tolerance_seconds)
    sample_archive = _sample_archive(config)
    displayed_score_resolver = _displayed_score_resolver(config)
    comparison = TemplateComparisonDimension(
        _text(config.get("comparisonDimension", "sync"), "comparisonDimension")
    )

    raw_servers = _list(config.get("servers"), "servers")
    if not raw_servers:
        raise ValueError("servers cannot be empty")
    seen_server_ids: set[int] = set()
    pipelines: list[OperationalServerPipeline] = []

    for index, raw_server in enumerate(raw_servers):
        server = _object(raw_server, f"servers[{index}]")
        server_id = _integer(server.get("id"), f"servers[{index}].id")
        if server_id in seen_server_ids:
            raise ValueError("server ids must be unique")
        seen_server_ids.add(server_id)
        server_tag = _optional_text(server.get("tag"), f"servers[{index}].tag")
        if stream_schema.server_column is not None and server_tag is None:
            raise ValueError("server tag is required when influx.stream.serverColumn is configured")
        awake_policy = _text(server.get("awakePolicy"), f"servers[{index}].awakePolicy")
        if awake_policy != "any-active-latest-snapshot":
            raise ValueError("only awakePolicy='any-active-latest-snapshot' is currently supported")

        session = CoreSession()
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

        families = []
        if so_bank is not None:
            so_registry = SOTemplateSelectionRegistry(so_bank)
            so_scorer = LiveSOGroupScorer(so_registry)
            so_runtime = LiveSOEventRuntime(so_scorer, comparison_dimension=comparison)
            so_producer = LiveRuntimeProducer(
                server_id=server_id,
                session=session,
                runtime=so_runtime,
                store=store,
                binding_resolver=binding_resolver(server),
                displayed_score_resolver=displayed_score_resolver,
            )
            families.append(SOFamilyRuntimeAdapter(so_producer))

        if si_templates:
            si_producer = LiveSIRuntimeProducer(
                server_id=server_id,
                session=session,
                templates=si_templates,
                vehicle_profiles=si_vehicle_types,
                store=store,
                displayed_score_resolver=displayed_score_resolver,
                arena=_server_arena(server),
            )
            families.append(SIFamilyRuntimeAdapter(si_producer))

        producer = FamilyRuntimeHost(
            server_id=server_id,
            session=session,
            families=tuple(sorted(families, key=lambda item: item.family)),
            store=store,
        )
        pipelines.append(OperationalServerPipeline(coordinator, producer))

    frozen = tuple(pipelines)
    persistence_raw = config.get("persistence")
    if persistence_raw is None:
        return OperationalRuntimeLoop(frozen)
    persistence = _object(persistence_raw, "persistence")
    state_path = _text(persistence.get("path"), "persistence.path")
    return CheckpointedOperationalRuntimeLoop(
        frozen,
        state_store=AtomicOperationalStateStore(Path(state_path)),
        config_fingerprint=_config_fingerprint(config),
    )


def build_operational_runtime_from_environment(
    store: RuntimeSnapshotStore,
) -> OperationalRuntimeLoop:
    path = os.environ.get("BLUEWOLF_OPERATIONAL_CONFIG", "").strip()
    if not path:
        raise ValueError("BLUEWOLF_OPERATIONAL_CONFIG is required")
    return build_operational_runtime(load_operational_config(path), store)


__all__ = ["build_operational_runtime", "build_operational_runtime_from_environment"]
