"""Application-facing adapters around the algorithmic Blue Wolf core.

This package may know about transport/presentation contracts. The public
``bluewolf_core`` package remains independent of HTTP, UI colors, arenas and
other application concerns.
"""

from .contract import (
    LIVE_RUNTIME_SCHEMA_VERSION,
    RuntimeVehiclePosition,
    build_so_live_runtime_snapshot,
)
from .ingest_coordinator import AwakeResolver, IngestPollResult, LiveCoreIngestCoordinator
from .operational_pipeline import (
    OperationalPipelineResult,
    OperationalRuntimeLoop,
    OperationalServerPipeline,
    OperationalTick,
)
from .operational_state import (
    OPERATIONAL_STATE_SCHEMA_VERSION,
    AtomicOperationalStateStore,
    CheckpointedOperationalRuntimeLoop,
    OperationalStateCompatibilityError,
    export_operational_state,
    restore_operational_state,
)
from .position_enrichment import (
    PositionEnrichedLiveRuntimeProducer,
    enrich_runtime_snapshot_positions,
)
from .producer import (
    BindingResolver,
    DisplayedScoreResolver,
    DisplayedScoreValue,
    LiveRuntimeProducer,
    RuntimePublicationResult,
    SOOperationalGroupBinding,
    SOOperationalMemberBinding,
)
from .runtime_host import (
    OperationalHostSnapshot,
    OperationalLoopFactory,
    OperationalLoopHost,
    host_from_environment,
    load_operational_loop_factory,
)
from .service import (
    BlueWolfRuntimeASGI,
    RuntimeSnapshotStore,
    app,
    create_app,
    runtime_store,
)

__all__ = [
    "LIVE_RUNTIME_SCHEMA_VERSION",
    "OPERATIONAL_STATE_SCHEMA_VERSION",
    "AtomicOperationalStateStore",
    "AwakeResolver",
    "BindingResolver",
    "BlueWolfRuntimeASGI",
    "CheckpointedOperationalRuntimeLoop",
    "DisplayedScoreResolver",
    "DisplayedScoreValue",
    "IngestPollResult",
    "LiveCoreIngestCoordinator",
    "LiveRuntimeProducer",
    "OperationalHostSnapshot",
    "OperationalLoopFactory",
    "OperationalLoopHost",
    "OperationalPipelineResult",
    "OperationalRuntimeLoop",
    "OperationalServerPipeline",
    "OperationalStateCompatibilityError",
    "OperationalTick",
    "PositionEnrichedLiveRuntimeProducer",
    "RuntimePublicationResult",
    "RuntimeSnapshotStore",
    "RuntimeVehiclePosition",
    "SOOperationalGroupBinding",
    "SOOperationalMemberBinding",
    "app",
    "build_so_live_runtime_snapshot",
    "create_app",
    "enrich_runtime_snapshot_positions",
    "export_operational_state",
    "host_from_environment",
    "load_operational_loop_factory",
    "restore_operational_state",
    "runtime_store",
]
