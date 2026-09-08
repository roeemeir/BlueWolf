"""Public contract for the Blue Wolf algorithmic core.

Only symbols imported here are considered part of the stable envelope used by
the surrounding application.  The package intentionally has no knowledge of
InfluxDB, SQLite, HTTP, maps, reports, or display time zones.
"""

from .config import CoreConfig
from .geometry import (
    PolylineProjection,
    circular_phase_distance,
    closed_polyline_length,
    curvature_at_phase,
    normalized_curvature_error,
    point_at_phase,
    project_onto_closed_polyline,
    project_wgs84,
    resample_closed_polyline,
    tangent_error_deg,
)
from .group_lifecycle import (
    GroupLifecycleResult,
    GroupMembershipLifecycle,
    StructuralGroupEvidence,
)
from .grouping import (
    GroupCompatibility,
    GroupObservation,
    GroupingSnapshot,
    RouteGroup,
    StableGroupingEngine,
    StructuralGroup,
    base_period_seconds,
    discover_structural_groups,
    routes_compatible,
)
from .models import (
    ChangeKind,
    ClosedRoute,
    CoreBatchResult,
    Direction,
    FieldQuality,
    PrimitiveMetrics,
    RouteFamily,
    RouteSubtype,
    StateChange,
    VehicleFrameResult,
    VehicleSample,
    VehicleScores,
)
from .route_detection import RouteDetection, detect_closed_route
from .scoring import aggregate_group_scores, score_error, score_vehicle
from .session import CheckpointCompatibilityError, CoreSession
from .templates import (
    MemberTemplateFit,
    NoLegalTemplateAssignment,
    ObservedMember,
    SynchronizationTemplate,
    TemplateFit,
    TemplateSlot,
    fit_template,
)

__all__ = [
    "ChangeKind",
    "CheckpointCompatibilityError",
    "ClosedRoute",
    "CoreBatchResult",
    "CoreConfig",
    "CoreSession",
    "Direction",
    "FieldQuality",
    "GroupCompatibility",
    "GroupLifecycleResult",
    "GroupMembershipLifecycle",
    "GroupObservation",
    "GroupingSnapshot",
    "MemberTemplateFit",
    "NoLegalTemplateAssignment",
    "ObservedMember",
    "PrimitiveMetrics",
    "PolylineProjection",
    "RouteDetection",
    "RouteFamily",
    "RouteGroup",
    "RouteSubtype",
    "StableGroupingEngine",
    "StateChange",
    "StructuralGroup",
    "StructuralGroupEvidence",
    "SynchronizationTemplate",
    "TemplateFit",
    "TemplateSlot",
    "VehicleFrameResult",
    "VehicleSample",
    "VehicleScores",
    "aggregate_group_scores",
    "base_period_seconds",
    "circular_phase_distance",
    "closed_polyline_length",
    "curvature_at_phase",
    "detect_closed_route",
    "discover_structural_groups",
    "fit_template",
    "normalized_curvature_error",
    "point_at_phase",
    "project_onto_closed_polyline",
    "project_wgs84",
    "resample_closed_polyline",
    "routes_compatible",
    "score_error",
    "score_vehicle",
    "tangent_error_deg",
]

__version__ = "0.3.0"
