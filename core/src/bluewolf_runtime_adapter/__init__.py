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
    "AwakeResolver",
    "BindingResolver",
    "BlueWolfRuntimeASGI",
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
    "host_from_environment",
    "load_operational_loop_factory",
    "runtime_store",
]
