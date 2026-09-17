"""Build the operational runtime with atomic SI+SO publication when SI is configured.

The established ``environment_factory`` remains the SO-compatible composition
source.  This module upgrades each already-validated server pipeline only when
Web-authored ``siTemplates`` are present.  The compatibility facade deliberately
keeps the public producer attributes used by checkpoint/restart code so adding
SI does not invalidate the existing SO event-runtime state contract.
"""
from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .composite_producer import (
    CompositeRuntimeProducer,
    DiscardingRuntimeSnapshotStore,
    PositionEnrichedCompositeRuntimeProducer,
)
from .environment_factory import (
    _config_fingerprint,
    build_operational_runtime as build_so_operational_runtime,
    load_operational_config,
)
from .operational_pipeline import OperationalRuntimeLoop, OperationalServerPipeline
from .operational_state import AtomicOperationalStateStore, CheckpointedOperationalRuntimeLoop
from .position_enrichment import PositionEnrichedLiveRuntimeProducer
from .service import RuntimeSnapshotStore
from .si_producer import LiveSIRuntimeProducer
from .si_template_config import (
    parse_si_templates,
    parse_si_vehicle_types,
    validate_si_runtime_configuration,
)


class MixedRuntimeProducer:
    """Compatibility facade around one atomic SI+SO composite producer.

    ``operational_pipeline`` may replace ``session`` after rollback and
    ``operational_state`` persists/restores the established SO ``runtime``.
    Exposing both properties here keeps those boundaries correct while SI keeps
    its own safe warm-up-only temporal state.
    """

    def __init__(
        self,
        *,
        server_id: int,
        session: Any,
        so_producer: PositionEnrichedLiveRuntimeProducer,
        si_producer: LiveSIRuntimeProducer,
        store: RuntimeSnapshotStore,
    ) -> None:
        self.server_id = server_id
        self.so_producer = so_producer
        self.si_producer = si_producer
        self.store = store
        sink = DiscardingRuntimeSnapshotStore()
        # Child commits are never externally visible.  Only the composite emits
        # the atomic family-safe snapshot after final position enrichment.
        self.so_producer.store = sink  # type: ignore[assignment]
        self.si_producer.store = sink  # type: ignore[assignment]
        self.composite = CompositeRuntimeProducer(
            server_id=server_id,
            producers=(("si", self.si_producer), ("so", self.so_producer)),
            store=store,
        )
        self.positioned = PositionEnrichedCompositeRuntimeProducer(self.composite, store)
        self.session = session

    @property
    def session(self):
        return self._session

    @session.setter
    def session(self, value) -> None:
        self._session = value
        self.so_producer.session = value
        self.si_producer.session = value

    @property
    def runtime(self):
        """Expose the established SO event runtime for checkpoint compatibility."""

        return self.so_producer.runtime

    @runtime.setter
    def runtime(self, value) -> None:
        self.so_producer.runtime = value

    def export_state(self) -> dict[str, object]:
        return self.composite.export_state()

    def restore_state(self, state: Mapping[str, object]) -> None:
        self.composite.restore_state(state)

    def publish_poll(self, poll):
        return self.positioned.publish_poll(poll)


def _server_arena(raw_server: object) -> str:
    """Resolve presentation metadata only; never use arena for grouping/scoring."""

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


def _server_config_by_id(config: Mapping[str, Any]) -> dict[int, object]:
    raw_servers = config.get("servers")
    if not isinstance(raw_servers, list):
        return {}
    output: dict[int, object] = {}
    for raw in raw_servers:
        if not isinstance(raw, Mapping):
            continue
        server_id = raw.get("id")
        if isinstance(server_id, bool) or not isinstance(server_id, int):
            continue
        output[server_id] = raw
    return output


def build_operational_runtime(config: Mapping[str, Any], store: RuntimeSnapshotStore) -> OperationalRuntimeLoop:
    """Build SO-only compatibility mode or SI+SO mixed mode from one config."""

    si_templates = parse_si_templates(config.get("siTemplates"))
    si_vehicle_types = parse_si_vehicle_types(config.get("siVehicleTypes"))
    validate_si_runtime_configuration(si_templates, si_vehicle_types)
    if not si_templates:
        return build_so_operational_runtime(config, store)

    # Avoid restoring a checkpoint into the temporary SO-only composition.
    # The mixed composition below restores it exactly once with the compatibility
    # facade installed.
    base_config = dict(config)
    persistence = base_config.pop("persistence", None)
    base_loop = build_so_operational_runtime(base_config, store)
    server_configs = _server_config_by_id(config)
    mixed_pipelines: list[OperationalServerPipeline] = []

    for pipeline in base_loop.pipelines:
        so_producer = pipeline.producer
        if not isinstance(so_producer, PositionEnrichedLiveRuntimeProducer):
            raise TypeError("SO environment factory returned an unsupported producer")
        si_producer = LiveSIRuntimeProducer(
            server_id=pipeline.server_id,
            session=pipeline.coordinator.session,
            templates=si_templates,
            vehicle_profiles=si_vehicle_types,
            store=store,
            displayed_score_resolver=so_producer.displayed_score_resolver,
            arena=_server_arena(server_configs.get(pipeline.server_id)),
        )
        producer = MixedRuntimeProducer(
            server_id=pipeline.server_id,
            session=pipeline.coordinator.session,
            so_producer=so_producer,
            si_producer=si_producer,
            store=store,
        )
        mixed_pipelines.append(OperationalServerPipeline(pipeline.coordinator, producer))

    pipelines = tuple(mixed_pipelines)
    if persistence is None:
        return OperationalRuntimeLoop(pipelines)
    if not isinstance(persistence, Mapping):
        raise ValueError("persistence must be an object")
    state_path = persistence.get("path")
    if not isinstance(state_path, str) or not state_path.strip():
        raise ValueError("persistence.path must be a non-empty string")
    return CheckpointedOperationalRuntimeLoop(
        pipelines,
        state_store=AtomicOperationalStateStore(Path(state_path)),
        config_fingerprint=_config_fingerprint(config),
    )


def build_operational_runtime_from_environment(store: RuntimeSnapshotStore) -> OperationalRuntimeLoop:
    import os

    path = os.environ.get("BLUEWOLF_OPERATIONAL_CONFIG", "").strip()
    if not path:
        raise ValueError("BLUEWOLF_OPERATIONAL_CONFIG is required")
    return build_operational_runtime(load_operational_config(path), store)


__all__ = [
    "MixedRuntimeProducer",
    "build_operational_runtime",
    "build_operational_runtime_from_environment",
]
