"""Versioned domain objects crossing the Blue Wolf core boundary."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from math import isfinite
from types import MappingProxyType
from typing import Any, Mapping


class FieldQuality(StrEnum):
    ORIGINAL = "original"
    INTERPOLATED = "interpolated"
    FORWARD_FILLED = "forward_filled"
    MISSING = "missing"


class RouteFamily(StrEnum):
    SI = "si"
    SO = "so"
    FREE = "free"


class RouteSubtype(StrEnum):
    COMPACT = "compact"
    HIPPODROME = "hippodrome"
    DOUBLE_HIPPODROME = "double_hippodrome"
    FIGURE_EIGHT = "figure_eight"
    DOUBLE_FIGURE_EIGHT = "double_figure_eight"
    UNKNOWN = "unknown"


class RouteTopology(StrEnum):
    SIMPLE = "simple"
    DOUBLE = "double"
    SELF_CROSSING = "self_crossing"


class RegionKind(StrEnum):
    LEG = "leg"
    TURN = "turn"
    CONNECTION = "connection"


class Direction(StrEnum):
    CLOCKWISE = "clockwise"
    COUNTERCLOCKWISE = "counterclockwise"
    UNKNOWN = "unknown"


class ChangeKind(StrEnum):
    VEHICLE_ACTIVATED = "vehicle_activated"
    VEHICLE_DEACTIVATED = "vehicle_deactivated"
    DATA_LOST = "data_lost"
    DATA_RESUMED = "data_resumed"
    VEHICLE_EXPIRED = "vehicle_expired"
    ROUTE_CANDIDATE = "route_candidate"
    ROUTE_CONFIRMED = "route_confirmed"
    GROUP_CANDIDATE = "group_candidate"
    GROUP_CONFIRMED = "group_confirmed"
    GROUP_CHANGED = "group_changed"
    EVENT_OPENED = "event_opened"
    EVENT_CLOSED = "event_closed"
    ALERT_OPENED = "alert_opened"
    ALERT_CLOSED = "alert_closed"
    TEMPLATE_SUGGESTED = "template_suggested"


def _require_finite(name: str, value: float | None) -> None:
    if value is not None and not isfinite(value):
        raise ValueError(f"{name} must be finite")


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("sample_time_utc must be timezone-aware")
    return value.astimezone(UTC)


@dataclass(frozen=True, slots=True)
class VehicleSample:
    """One canonical joined sample presented to the core.

    The ingestion adapter owns query, temporal join, interpolation and
    forward-fill.  The core receives the result with provenance per field.
    """

    sample_time_utc: datetime
    server_id: int
    vehicle_number: int
    vehicle_identifier: int
    active: bool | None
    latitude_deg: float | None
    longitude_deg: float | None
    altitude_m: float | None = None
    velocity_north_mps: float | None = None
    velocity_east_mps: float | None = None
    reliability: float = 1.0
    field_quality: Mapping[str, FieldQuality] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "sample_time_utc", _as_utc(self.sample_time_utc))
        object.__setattr__(self, "field_quality", MappingProxyType(dict(self.field_quality)))
        if self.server_id < 0:
            raise ValueError("server_id must be non-negative")
        if self.vehicle_number < 0:
            raise ValueError("vehicle_number must be non-negative")
        if self.vehicle_identifier < 0:
            raise ValueError("vehicle_identifier must be non-negative")
        if (self.latitude_deg is None) != (self.longitude_deg is None):
            raise ValueError("latitude_deg and longitude_deg must both exist or both be missing")
        if self.latitude_deg is not None:
            _require_finite("latitude_deg", self.latitude_deg)
            _require_finite("longitude_deg", self.longitude_deg)
            if not -90.0 <= self.latitude_deg <= 90.0:
                raise ValueError("latitude_deg is out of WGS84 range")
            if not -180.0 <= float(self.longitude_deg) <= 180.0:
                raise ValueError("longitude_deg is out of WGS84 range")
        if not 0.0 <= self.reliability <= 1.0:
            raise ValueError("reliability must be in [0, 1]")
        _require_finite("altitude_m", self.altitude_m)
        _require_finite("velocity_north_mps", self.velocity_north_mps)
        _require_finite("velocity_east_mps", self.velocity_east_mps)

    @property
    def stream_key(self) -> tuple[int, int]:
        return self.server_id, self.vehicle_identifier


@dataclass(frozen=True, slots=True)
class CanonicalPoint:
    x_m: float
    y_m: float

    def __post_init__(self) -> None:
        _require_finite("x_m", self.x_m)
        _require_finite("y_m", self.y_m)


@dataclass(frozen=True, slots=True)
class RouteRegion:
    kind: RegionKind
    start_phase: float
    end_phase: float
    label: str = ""

    def __post_init__(self) -> None:
        if not 0.0 <= self.start_phase < 1.0:
            raise ValueError("start_phase must be in [0, 1)")
        if not 0.0 <= self.end_phase < 1.0:
            raise ValueError("end_phase must be in [0, 1)")


@dataclass(frozen=True, slots=True)
class RouteComponent:
    """One logical geometry component inside a hierarchical detected route.

    For the approved Double Hippodrome this represents one of the two logical
    Single-Hippodrome scoring surfaces. Component labels are diagnostic only and
    carry no fixed vehicle role. ``center_offset_*`` is measured in the parent
    route's local east/north frame; ``canonical_points`` are centered on the
    component itself.
    """

    component_id: str
    subtype: RouteSubtype
    canonical_points: tuple[CanonicalPoint, ...]
    center_offset_east_m: float
    center_offset_north_m: float
    length_m: float
    long_axis_a_m: float
    short_axis_b_m: float
    orientation_deg: float

    def __post_init__(self) -> None:
        if not self.component_id:
            raise ValueError("component_id cannot be empty")
        if not 3 <= len(self.canonical_points) <= 64:
            raise ValueError("component canonical_points must contain 3..64 points")
        for name in (
            "center_offset_east_m",
            "center_offset_north_m",
            "length_m",
            "long_axis_a_m",
            "short_axis_b_m",
            "orientation_deg",
        ):
            _require_finite(name, float(getattr(self, name)))
        if self.length_m <= 0 or self.long_axis_a_m <= 0 or self.short_axis_b_m <= 0:
            raise ValueError("component dimensions must be positive")


@dataclass(frozen=True, slots=True)
class ClosedRoute:
    route_id: str
    family: RouteFamily
    subtype: RouteSubtype
    topology: RouteTopology
    canonical_points: tuple[CanonicalPoint, ...]
    center_latitude_deg: float
    center_longitude_deg: float
    length_m: float
    long_axis_a_m: float
    short_axis_b_m: float
    orientation_deg: float
    estimated_period_s: float
    direction: Direction
    detection_quality: float
    regions: tuple[RouteRegion, ...] = ()
    components: tuple[RouteComponent, ...] = ()

    def __post_init__(self) -> None:
        if not 3 <= len(self.canonical_points) <= 64:
            raise ValueError("canonical_points must contain 3..64 points")
        if self.length_m <= 0 or self.long_axis_a_m <= 0 or self.short_axis_b_m <= 0:
            raise ValueError("route dimensions must be positive")
        if self.estimated_period_s <= 0:
            raise ValueError("estimated_period_s must be positive")
        if not 0.0 <= self.detection_quality <= 1.0:
            raise ValueError("detection_quality must be in [0, 1]")
        component_ids = [component.component_id for component in self.components]
        if len(component_ids) != len(set(component_ids)):
            raise ValueError("route component ids must be unique")
        if self.subtype is RouteSubtype.DOUBLE_HIPPODROME and self.components:
            if len(self.components) != 2 or any(
                component.subtype is not RouteSubtype.HIPPODROME
                for component in self.components
            ):
                raise ValueError(
                    "Double Hippodrome components must be exactly two Hippodromes"
                )


@dataclass(frozen=True, slots=True)
class PrimitiveMetrics:
    """Primitive errors consumed by the score function.

    `position_error` is expressed in degrees for SI and as a fraction of one
    full cycle for SO.  The synchronization module may emphasize SO turn
    regions before placing the effective value here; `position_reason` keeps
    the operator-facing diagnostic without adding a fourth top-level weight.
    """

    family: RouteFamily
    position_error: float
    period_error_ratio: float
    movement_error_ratio: float
    distance_error_b_ratio: float
    tangent_error_deg: float | None
    curvature_error_ratio: float | None
    reliability: float
    speed_fraction: float
    active: bool | None = True
    wrong_direction_seconds: float = 0.0
    position_reason: str = "phase_alignment"
    diagnostics: Mapping[str, float | str | bool] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "diagnostics", MappingProxyType(dict(self.diagnostics)))
        for name in (
            "position_error",
            "period_error_ratio",
            "movement_error_ratio",
            "distance_error_b_ratio",
            "reliability",
            "speed_fraction",
            "wrong_direction_seconds",
        ):
            value = float(getattr(self, name))
            if not isfinite(value) or value < 0:
                raise ValueError(f"{name} must be finite and non-negative")
        _require_finite("tangent_error_deg", self.tangent_error_deg)
        _require_finite("curvature_error_ratio", self.curvature_error_ratio)
        if self.reliability > 1.0:
            raise ValueError("reliability must be in [0, 1]")


@dataclass(frozen=True, slots=True)
class ComponentScores:
    sync_position: float
    sync_period: float
    sync_movement: float
    route_distance: float
    route_tangent: float | None
    route_curvature: float | None


@dataclass(frozen=True, slots=True)
class VehicleScores:
    valid: bool
    sync: float | None
    route: float | None
    total: float | None
    components: ComponentScores | None
    primary_reason: str | None
    reliability: float


@dataclass(frozen=True, slots=True)
class VehicleFrameResult:
    sample_time_utc: datetime
    server_id: int
    vehicle_identifier: int
    active: bool | None
    latitude_deg: float | None
    longitude_deg: float | None
    reliability: float
    group_id: str | None = None
    event_id: str | None = None
    route_id: str | None = None
    phase: float | None = None
    # SO-only geometry-normalized phase used by quarter/template semantics.
    # `phase` remains the raw/legacy route phase for backward compatibility and
    # for SI consumers. Figure-8 may legitimately leave semantic_phase=None at
    # a self-crossing when heading evidence is unavailable. Double Hippodrome
    # semantic phase is local to the currently active logical component.
    semantic_phase: float | None = None
    active_so_component_id: str | None = None
    scores: VehicleScores | None = None

    def __post_init__(self) -> None:
        _require_finite("phase", self.phase)
        _require_finite("semantic_phase", self.semantic_phase)
        if self.phase is not None and not 0.0 <= self.phase < 1.0:
            raise ValueError("phase must be in [0, 1)")
        if self.semantic_phase is not None and not 0.0 <= self.semantic_phase < 1.0:
            raise ValueError("semantic_phase must be in [0, 1)")
        if self.active_so_component_id == "":
            raise ValueError("active_so_component_id must be non-empty when supplied")


@dataclass(frozen=True, slots=True)
class StateChange:
    change_time_utc: datetime
    kind: ChangeKind
    server_id: int
    vehicle_identifier: int | None = None
    group_id: str | None = None
    event_id: str | None = None
    details: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "change_time_utc", _as_utc(self.change_time_utc))
        object.__setattr__(self, "details", MappingProxyType(dict(self.details)))


@dataclass(frozen=True, slots=True)
class CoreBatchResult:
    schema_version: int
    algorithm_version: str
    frames: tuple[VehicleFrameResult, ...]
    changes: tuple[StateChange, ...]
    processed_until_utc: datetime | None


@dataclass(frozen=True, slots=True)
class GroupScores:
    valid: bool
    sync: float | None
    route: float | None
    total: float | None
    valid_vehicle_count: int
    primary_reason: str | None
