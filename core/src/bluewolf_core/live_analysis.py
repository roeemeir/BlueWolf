"""Stateful live application analysis around the canonical CoreSession.

The browser/service contract sends one warm-up NavigationDataset and then only
new five-second NAV batches. This module keeps a bounded in-memory NAV window
for display analysis while CoreSession owns the durable algorithm state. The
NAV window is intentionally not part of the checkpoint; after restart it is
rehydrated by replay from InfluxDB.

No network, database, filesystem or UI access belongs here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Mapping

from . import __version__
from .application_analysis_v18 import (
    analyze_navigation_dataset,
    derive_events,
    provenance_from_samples,
)
from .config import CoreConfig
from .models import FieldQuality, VehicleSample
from .session_v17 import CoreSession


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _vehicle_sample(raw: Mapping[str, Any]) -> VehicleSample:
    timestamp = raw.get("sample_time_utc", raw.get("timestamp"))
    if not isinstance(timestamp, str):
        raise ValueError("sample_time_utc/timestamp is required")
    server = raw.get("server_id", raw.get("serverId", 0))
    vehicle_identifier = raw.get("vehicle_identifier", raw.get("vehicleId"))
    if vehicle_identifier is None:
        raise ValueError("vehicle_identifier/vehicleId is required")
    vehicle_number = raw.get("vehicle_number", raw.get("vehicleNumber", vehicle_identifier))
    latitude = raw.get("latitude_deg", raw.get("latitude"))
    longitude = raw.get("longitude_deg", raw.get("longitude"))
    altitude = raw.get("altitude_m", raw.get("altitude"))
    velocity_north = raw.get("velocity_north_mps", raw.get("velocityNorth"))
    velocity_east = raw.get("velocity_east_mps", raw.get("velocityEast"))
    quality_raw = raw.get("field_quality", raw.get("fieldQuality", {}))
    field_quality = {
        str(key): item if isinstance(item, FieldQuality) else FieldQuality(str(item))
        for key, item in dict(quality_raw).items()
    }
    return VehicleSample(
        sample_time_utc=_parse_time(timestamp),
        server_id=int(server),
        vehicle_number=int(vehicle_number),
        vehicle_identifier=int(vehicle_identifier),
        active=raw.get("active"),
        latitude_deg=float(latitude) if latitude is not None else None,
        longitude_deg=float(longitude) if longitude is not None else None,
        altitude_m=float(altitude) if altitude is not None else None,
        velocity_north_mps=float(velocity_north) if velocity_north is not None else None,
        velocity_east_mps=float(velocity_east) if velocity_east is not None else None,
        reliability=float(raw.get("reliability", 1.0)),
        field_quality=field_quality,
    )


def app_config_to_core_config(raw: Mapping[str, Any]) -> CoreConfig:
    """Translate the stable web scoring envelope to canonical CoreConfig."""
    thresholds = raw.get("thresholds", {})
    weights = raw.get("weights", {})
    sync = weights.get("sync", {})
    route = weights.get("route", {})
    total = weights.get("total", {})

    def band(full_key: str, zero_key: str, *, fraction: bool = False) -> dict[str, float]:
        scale = 0.01 if fraction else 1.0
        return {
            "full_score_through": float(thresholds.get(full_key, 0.0)) * scale,
            "zero_score_from": float(thresholds.get(zero_key, 1.0)) * scale,
        }

    return CoreConfig.from_dict({
        "scoring": {
            "sync_weights": {
                "first": float(sync.get("position", 60.0)),
                "second": float(sync.get("period", 20.0)),
                "third": float(sync.get("motion", 20.0)),
            },
            "route_weights": {
                "first": float(route.get("distance", 15.0)),
                "second": float(route.get("tangent", 70.0)),
                "third": float(route.get("curvature", 15.0)),
            },
            "total_weights": {
                "first": float(total.get("sync", 75.0)),
                "second": float(total.get("route", 25.0)),
            },
            "si_position_deg": band("siPositionFullDeg", "siPositionZeroDeg"),
            "so_position_cycle": band("soPositionFullPct", "soPositionZeroPct", fraction=True),
            "period_ratio": band("periodFullPct", "periodZeroPct", fraction=True),
            "movement_ratio": band("motionFullPct", "motionZeroPct", fraction=True),
            "distance_short_axis_ratio": band("routeDistanceFullPct", "routeDistanceZeroPct", fraction=True),
            "tangent_deg": band("tangentFullDeg", "tangentZeroDeg"),
            "curvature_ratio": band("curvatureFullPct", "curvatureZeroPct", fraction=True),
            "minimum_motion_speed_fraction": float(thresholds.get("lowSpeedPct", 30.0)) / 100.0,
            "displayed_smoothing_seconds": int(thresholds.get("smoothingSeconds", 10)),
            "good_score_from": float(thresholds.get("greenScore", 80.0)),
            "low_score_below": float(thresholds.get("redScore", 50.0)),
        },
    })


def _sample_key(sample: Mapping[str, Any]) -> tuple[str, int, str]:
    return (
        str(sample.get("serverId", sample.get("server_id", "0"))),
        int(sample.get("vehicleId", sample.get("vehicle_identifier", 0))),
        str(sample.get("timestamp", sample.get("sample_time_utc", ""))),
    )


def _bounded_dataset(
    samples: list[dict[str, Any]],
    provenance: Mapping[str, Any],
    start: datetime,
    end: datetime,
) -> dict[str, Any]:
    source = str(provenance.get("source", "simulation"))
    server_id = str(provenance.get("serverId", "1"))
    normalized = provenance_from_samples(
        source,
        server_id,
        start,
        end,
        samples,
        provenance.get("warnings", []),
    )
    return {"samples": samples, "provenance": normalized}


@dataclass(slots=True)
class LiveAnalysisEnvelope:
    analysis: dict[str, Any]
    history: list[dict[str, Any]]
    events: list[dict[str, Any]]
    accepted_samples: int
    core_batch: Any | None


@dataclass(slots=True)
class LiveAnalysisSession:
    app_config: Mapping[str, Any]
    algorithm_version: str = __version__
    retention_seconds: int = 30 * 60
    max_history_frames: int = 72
    core: CoreSession = field(init=False)
    samples: list[dict[str, Any]] = field(default_factory=list)
    history: list[dict[str, Any]] = field(default_factory=list)
    _seen: set[tuple[str, int, str]] = field(default_factory=set)

    def __post_init__(self) -> None:
        self.retention_seconds = max(12 * 60, min(int(self.retention_seconds), 2 * 60 * 60))
        self.max_history_frames = max(12, min(int(self.max_history_frames), 240))
        self.core = CoreSession(
            config=app_config_to_core_config(self.app_config),
            algorithm_version=self.algorithm_version,
        )

    def _analysis_envelope(
        self,
        provenance: Mapping[str, Any],
        *,
        accepted_samples: int,
        core_batch: Any | None,
        bootstrap_history: bool,
    ) -> LiveAnalysisEnvelope:
        latest_raw = provenance.get("to") or provenance.get("latestSampleAt")
        latest = _parse_time(str(latest_raw)) if latest_raw else None
        if latest is None and self.samples:
            latest = max(_parse_time(str(sample["timestamp"])) for sample in self.samples)
        if latest is not None:
            cutoff = latest - timedelta(seconds=self.retention_seconds)
            self.samples = [sample for sample in self.samples if _parse_time(str(sample["timestamp"])) >= cutoff]
            self._seen = {_sample_key(sample) for sample in self.samples}

        if self.samples:
            start = min(_parse_time(str(sample["timestamp"])) for sample in self.samples)
            end = latest or max(_parse_time(str(sample["timestamp"])) for sample in self.samples)
        else:
            end = latest or datetime.now(tz=UTC)
            start = end
        dataset = _bounded_dataset(self.samples, provenance, start, end)
        analysis = analyze_navigation_dataset(dataset, self.app_config)
        timestamp = dataset["provenance"].get("latestSampleAt") or dataset["provenance"].get("to")

        # Live warm-up must make the current operational picture available first.
        # Building dozens of historical analysis frames synchronously delayed the
        # first usable group result. Seed history with the already-computed current
        # analysis, then append one bounded 12-minute frame per incremental batch.
        if bootstrap_history:
            self.history = [{"timestamp": timestamp, "analysis": analysis}] if timestamp else []
        elif timestamp and (not self.history or self.history[-1]["timestamp"] != timestamp):
            history_start = max(start, end - timedelta(minutes=12))
            history_samples = [
                sample for sample in self.samples
                if _parse_time(str(sample["timestamp"])) >= history_start
            ]
            history_dataset = _bounded_dataset(history_samples, provenance, history_start, end)
            self.history.append({
                "timestamp": timestamp,
                "analysis": analyze_navigation_dataset(history_dataset, self.app_config),
            })
            if len(self.history) > self.max_history_frames:
                self.history = self.history[-self.max_history_frames:]

        return LiveAnalysisEnvelope(
            analysis=analysis,
            history=list(self.history),
            events=derive_events(self.history, self.app_config.get("thresholds", {})),
            accepted_samples=accepted_samples,
            core_batch=core_batch,
        )

    def ingest(self, dataset: Mapping[str, Any]) -> LiveAnalysisEnvelope:
        provenance = dict(dataset.get("provenance", {}))
        incoming = [dict(sample) for sample in dataset.get("samples", []) if isinstance(sample, Mapping)]
        accepted: list[dict[str, Any]] = []
        for sample in incoming:
            key = _sample_key(sample)
            if key in self._seen:
                continue
            self._seen.add(key)
            accepted.append(sample)
        self.samples.extend(accepted)
        self.samples.sort(key=lambda sample: (_parse_time(str(sample["timestamp"])), int(sample["vehicleId"])))

        observed_raw = provenance.get("to") or provenance.get("latestSampleAt")
        observed = _parse_time(str(observed_raw)) if observed_raw else None
        core_batch = None
        if accepted or observed is not None:
            core_batch = self.core.process_batch(
                [_vehicle_sample(sample) for sample in accepted],
                observed_until_utc=observed,
            )

        return self._analysis_envelope(
            provenance,
            accepted_samples=len(accepted),
            core_batch=core_batch,
            bootstrap_history=not self.history,
        )

    def checkpoint(self) -> bytes:
        return self.core.export_checkpoint()

    @classmethod
    def restore(
        cls,
        checkpoint: bytes,
        *,
        app_config: Mapping[str, Any],
        recovery_dataset: Mapping[str, Any],
        algorithm_version: str = __version__,
        retention_seconds: int = 30 * 60,
        max_history_frames: int = 72,
    ) -> tuple["LiveAnalysisSession", LiveAnalysisEnvelope]:
        session = cls(
            app_config=app_config,
            algorithm_version=algorithm_version,
            retention_seconds=retention_seconds,
            max_history_frames=max_history_frames,
        )
        recovery_samples = [dict(sample) for sample in recovery_dataset.get("samples", []) if isinstance(sample, Mapping)]
        wire_samples = [_vehicle_sample(sample) for sample in recovery_samples]
        session.core = CoreSession.from_checkpoint(
            checkpoint,
            config=app_config_to_core_config(app_config),
            algorithm_version=algorithm_version,
            recovery_samples=wire_samples,
        )

        frontier = session.core.processed_until_utc
        post_frontier = [
            sample for sample, wire in zip(recovery_samples, wire_samples, strict=True)
            if frontier is None or wire.sample_time_utc > frontier
        ]
        post_wire = [
            wire for wire in wire_samples
            if frontier is None or wire.sample_time_utc > frontier
        ]
        provenance = dict(recovery_dataset.get("provenance", {}))
        observed_raw = provenance.get("to") or provenance.get("latestSampleAt")
        observed = _parse_time(str(observed_raw)) if observed_raw else None
        core_batch = None
        if post_wire or (observed is not None and (frontier is None or observed > frontier)):
            core_batch = session.core.process_batch(post_wire, observed_until_utc=observed)

        # Seed the reconstructible display window with the replay range. Samples
        # at/before frontier hydrated route state; samples after frontier were
        # just processed normally above. None of this NAV is persisted in the
        # compact checkpoint itself.
        session.samples = recovery_samples
        session._seen = {_sample_key(sample) for sample in recovery_samples}
        envelope = session._analysis_envelope(
            provenance,
            accepted_samples=len(post_frontier),
            core_batch=core_batch,
            bootstrap_history=True,
        )
        return session, envelope
