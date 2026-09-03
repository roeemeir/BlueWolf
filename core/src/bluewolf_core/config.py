"""Core configuration with the approved V1 defaults."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True, slots=True)
class ErrorBand:
    full_score_through: float
    zero_score_from: float

    def __post_init__(self) -> None:
        if self.full_score_through < 0:
            raise ValueError("full_score_through must be non-negative")
        if self.zero_score_from <= self.full_score_through:
            raise ValueError("zero_score_from must be greater than full_score_through")


@dataclass(frozen=True, slots=True)
class TripleWeights:
    first: float
    second: float
    third: float

    def __post_init__(self) -> None:
        if min(self.first, self.second, self.third) < 0:
            raise ValueError("weights must be non-negative")
        if self.first + self.second + self.third <= 0:
            raise ValueError("at least one weight must be positive")

    def normalized(self) -> tuple[float, float, float]:
        total = self.first + self.second + self.third
        return self.first / total, self.second / total, self.third / total


@dataclass(frozen=True, slots=True)
class PairWeights:
    first: float
    second: float

    def __post_init__(self) -> None:
        if min(self.first, self.second) < 0:
            raise ValueError("weights must be non-negative")
        if self.first + self.second <= 0:
            raise ValueError("at least one weight must be positive")

    def normalized(self) -> tuple[float, float]:
        total = self.first + self.second
        return self.first / total, self.second / total


@dataclass(frozen=True, slots=True)
class ScoringConfig:
    sync_weights: TripleWeights = field(default_factory=lambda: TripleWeights(60, 20, 20))
    route_weights: TripleWeights = field(default_factory=lambda: TripleWeights(15, 70, 15))
    total_weights: PairWeights = field(default_factory=lambda: PairWeights(75, 25))
    si_position_deg: ErrorBand = field(default_factory=lambda: ErrorBand(10, 30))
    so_position_cycle: ErrorBand = field(default_factory=lambda: ErrorBand(0.05, 0.25))
    period_ratio: ErrorBand = field(default_factory=lambda: ErrorBand(0.05, 0.20))
    movement_ratio: ErrorBand = field(default_factory=lambda: ErrorBand(0.10, 0.30))
    distance_short_axis_ratio: ErrorBand = field(default_factory=lambda: ErrorBand(0.05, 0.30))
    tangent_deg: ErrorBand = field(default_factory=lambda: ErrorBand(10, 60))
    curvature_ratio: ErrorBand = field(default_factory=lambda: ErrorBand(0.10, 1.00))
    minimum_motion_speed_fraction: float = 0.30
    minimum_valid_reliability: float = 0.60
    displayed_smoothing_seconds: int = 10
    good_score_from: float = 80
    low_score_below: float = 50
    alert_open_seconds: int = 10
    alert_recovery_score: float = 60
    alert_recovery_seconds: int = 20
    wrong_direction_zero_seconds: int = 60


@dataclass(frozen=True, slots=True)
class DetectionConfig:
    si_axis_ratio_max: float = 1.5
    canonical_point_limit: int = 64
    new_route_observation_seconds: int = 300
    known_route_candidate_seconds: int = 60
    required_fit_fraction: float = 0.70
    required_completed_cycles: int = 1
    closure_distance_short_axis_ratio: float = 0.20
    closure_direction_error_deg: float = 30
    closure_minimum_phase: float = 0.80
    geometry_change_ratio: float = 0.20
    period_change_ratio: float = 0.20
    change_confirmation_seconds: int = 120
    smoothing_seconds: int = 3


@dataclass(frozen=True, slots=True)
class GroupingConfig:
    minimum_valid_vehicles: int = 2
    membership_confirmation_seconds: int = 120
    membership_hold_seconds: int = 300
    identity_preservation_fraction: float = 0.60
    si_center_distance_ratio: float = 0.30
    si_period_difference_ratio: float = 0.20
    so_period_difference_ratio: float = 0.20
    so_neighbor_longer_leg_multiplier: float = 1.0
    si_wrong_direction_alert_seconds: int = 60
    si_wrong_direction_exit_additional_seconds: int = 300
    default_maximum_so_vehicles: int = 8


@dataclass(frozen=True, slots=True)
class TimingConfig:
    logical_grid_seconds: int = 1
    live_batch_seconds: int = 5
    join_tolerance_seconds: int = 5
    interpolation_limit_seconds: int = 5
    late_correction_horizon_seconds: int = 10
    no_data_display_seconds: int = 20
    return_consistency_seconds: int = 10
    ui_refresh_seconds: int = 2
    checkpoint_seconds: int = 300
    event_finalize_seconds: int = 120


@dataclass(frozen=True, slots=True)
class CoreConfig:
    schema_version: int = 1
    detection_version: str = "1"
    scoring_version: str = "1"
    template_version: str = "1"
    scoring: ScoringConfig = field(default_factory=ScoringConfig)
    detection: DetectionConfig = field(default_factory=DetectionConfig)
    grouping: GroupingConfig = field(default_factory=GroupingConfig)
    timing: TimingConfig = field(default_factory=TimingConfig)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> CoreConfig:
        return cls(
            schema_version=int(raw.get("schema_version", 1)),
            detection_version=str(raw.get("detection_version", "1")),
            scoring_version=str(raw.get("scoring_version", "1")),
            template_version=str(raw.get("template_version", "1")),
            scoring=_scoring_from_dict(raw.get("scoring", {})),
            detection=DetectionConfig(**dict(raw.get("detection", {}))),
            grouping=GroupingConfig(**dict(raw.get("grouping", {}))),
            timing=TimingConfig(**dict(raw.get("timing", {}))),
        )


def _band(raw: Mapping[str, Any], key: str, default: ErrorBand) -> ErrorBand:
    value = raw.get(key)
    return default if value is None else ErrorBand(**dict(value))


def _triple(raw: Mapping[str, Any], key: str, default: TripleWeights) -> TripleWeights:
    value = raw.get(key)
    return default if value is None else TripleWeights(**dict(value))


def _pair(raw: Mapping[str, Any], key: str, default: PairWeights) -> PairWeights:
    value = raw.get(key)
    return default if value is None else PairWeights(**dict(value))


def _scoring_from_dict(value: object) -> ScoringConfig:
    raw = dict(value) if isinstance(value, Mapping) else {}
    defaults = ScoringConfig()
    special = {
        "sync_weights",
        "route_weights",
        "total_weights",
        "si_position_deg",
        "so_position_cycle",
        "period_ratio",
        "movement_ratio",
        "distance_short_axis_ratio",
        "tangent_deg",
        "curvature_ratio",
    }
    scalars = {key: item for key, item in raw.items() if key not in special}
    return ScoringConfig(
        sync_weights=_triple(raw, "sync_weights", defaults.sync_weights),
        route_weights=_triple(raw, "route_weights", defaults.route_weights),
        total_weights=_pair(raw, "total_weights", defaults.total_weights),
        si_position_deg=_band(raw, "si_position_deg", defaults.si_position_deg),
        so_position_cycle=_band(raw, "so_position_cycle", defaults.so_position_cycle),
        period_ratio=_band(raw, "period_ratio", defaults.period_ratio),
        movement_ratio=_band(raw, "movement_ratio", defaults.movement_ratio),
        distance_short_axis_ratio=_band(
            raw, "distance_short_axis_ratio", defaults.distance_short_axis_ratio
        ),
        tangent_deg=_band(raw, "tangent_deg", defaults.tangent_deg),
        curvature_ratio=_band(raw, "curvature_ratio", defaults.curvature_ratio),
        **scalars,
    )

