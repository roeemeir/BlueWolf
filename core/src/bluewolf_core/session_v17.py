"""v1.7 checkpoint policy for the canonical Python CoreSession.

The legacy streaming implementation keeps a bounded joined-NAV window in
memory because route fitting needs recent geometry. v1.7 deliberately does not
persist that window in checkpoints: Influx is the navigation source of truth.
On restart the orchestrator restores the compact checkpoint, queries the
recovery lookback from Influx, joins it, hydrates the in-memory fitting window,
and only then processes samples newer than the checkpoint frontier.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Iterable, Mapping, Any

from .config import CoreConfig
from .models import VehicleSample
from .session import (
    CHECKPOINT_SCHEMA_VERSION as LEGACY_CHECKPOINT_SCHEMA_VERSION,
    CheckpointCompatibilityError,
    CoreSession as _StreamingCoreSession,
    _ROUTE_HISTORY_SECONDS,
    _bounded_history,
)

CHECKPOINT_SCHEMA_VERSION = 4


class CoreSession(_StreamingCoreSession):
    """Canonical v1.7 session with compact, NAV-free checkpoints."""

    def export_checkpoint(self) -> bytes:
        raw: dict[str, Any] = json.loads(super().export_checkpoint().decode("utf-8"))
        raw["checkpoint_schema_version"] = CHECKPOINT_SCHEMA_VERSION
        raw["recovery_history_seconds"] = int(_ROUTE_HISTORY_SECONDS)
        for route in raw.get("routes", []):
            if isinstance(route, dict):
                route.pop("history", None)
        return json.dumps(raw, sort_keys=True, separators=(",", ":")).encode("utf-8")

    @classmethod
    def from_checkpoint(
        cls,
        checkpoint: bytes | str,
        *,
        config: CoreConfig | None = None,
        algorithm_version: str = "0.8.0",
        recovery_samples: Iterable[VehicleSample] = (),
    ) -> "CoreSession":
        text = checkpoint.decode("utf-8") if isinstance(checkpoint, bytes) else checkpoint
        raw: Mapping[str, Any] = json.loads(text)
        if raw.get("checkpoint_schema_version") != CHECKPOINT_SCHEMA_VERSION:
            raise CheckpointCompatibilityError("unsupported checkpoint schema")

        # Reuse the battle-tested compatibility/config restoration logic without
        # persisting its historical sample window. The legacy parser receives
        # empty history arrays and the external Influx replay hydrates them below.
        legacy = dict(raw)
        legacy["checkpoint_schema_version"] = LEGACY_CHECKPOINT_SCHEMA_VERSION
        legacy.pop("recovery_history_seconds", None)
        legacy_routes = []
        for value in raw.get("routes", []):
            item = dict(value)
            item["history"] = []
            legacy_routes.append(item)
        legacy["routes"] = legacy_routes

        restored = _StreamingCoreSession.from_checkpoint(
            json.dumps(legacy, sort_keys=True, separators=(",", ":")),
            config=config,
            algorithm_version=algorithm_version,
        )
        session = cls(config=restored.config, algorithm_version=restored.algorithm_version)
        session._states = restored._states
        session._routes = restored._routes
        session._processed_until_utc = restored._processed_until_utc
        session.hydrate_recovery_history(recovery_samples)
        return session

    @property
    def recovery_history_start_utc(self) -> datetime | None:
        if self.processed_until_utc is None:
            return None
        return self.processed_until_utc - timedelta(seconds=_ROUTE_HISTORY_SECONDS)

    def hydrate_recovery_history(self, samples: Iterable[VehicleSample]) -> None:
        """Restore only the transient route-fitting window from external NAV.

        Hydration never emits Core frames/changes and never moves the processed
        frontier. Samples after the checkpoint frontier are deliberately ignored
        here; they must enter through normal process_batch afterwards.
        """
        frontier = self.processed_until_utc
        if frontier is None:
            return
        lower = frontier - timedelta(seconds=_ROUTE_HISTORY_SECONDS)
        ordered = sorted(
            (
                sample
                for sample in samples
                if lower <= sample.sample_time_utc <= frontier
                and sample.active is not False
                and sample.latitude_deg is not None
                and sample.longitude_deg is not None
            ),
            key=lambda item: (
                item.sample_time_utc,
                item.server_id,
                item.vehicle_identifier,
                item.vehicle_number,
            ),
        )
        by_key: dict[tuple[int, int], list[VehicleSample]] = {}
        for sample in ordered:
            if sample.stream_key not in self._routes:
                continue
            by_key.setdefault(sample.stream_key, []).append(sample)
        for key, route in self._routes.items():
            route.history = by_key.get(key, [])
            if route.history:
                _bounded_history(route.history, route.history[-1].sample_time_utc)
