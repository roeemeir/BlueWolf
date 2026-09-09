"""Application-facing adapters around the algorithmic Blue Wolf core.

This package may know about transport/presentation contracts. The public
``bluewolf_core`` package remains independent of HTTP, UI colors, arenas and
other application concerns.
"""

from .contract import LIVE_RUNTIME_SCHEMA_VERSION, build_so_live_runtime_snapshot
from .ingest_coordinator import AwakeResolver, IngestPollResult, LiveCoreIngestCoordinator
from .producer import (
    BindingResolver,
    DisplayedScoreResolver,
    DisplayedScoreValue,
    LiveRuntimeProducer,
    RuntimePublicationResult,
    SOOperationalGroupBinding,
    SOOperationalMemberBinding,
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
    "RuntimePublicationResult",
    "RuntimeSnapshotStore",
    "SOOperationalGroupBinding",
    "SOOperationalMemberBinding",
    "app",
    "build_so_live_runtime_snapshot",
    "create_app",
    "runtime_store",
]
