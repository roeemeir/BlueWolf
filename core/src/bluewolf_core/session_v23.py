"""Blue Wolf streaming CoreSession v2.3 route-history policy.

The route fitting/history horizon is 40 minutes. Checkpoints remain compact and
NAV-free; recovery history is replayed from the external navigation source.
"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any, Iterable

from . import session as _legacy_session
from .models import VehicleSample
from .session_v17 import CoreSession as _V17CoreSession

ROUTE_HISTORY_SECONDS = 40 * 60

# The inherited streaming implementation resolves this value from the session
# module at runtime when bounding in-memory route evidence.
_legacy_session._ROUTE_HISTORY_SECONDS = float(ROUTE_HISTORY_SECONDS)


class CoreSession(_V17CoreSession):
    """Canonical session with a 40-minute reconstructible route-history horizon."""

    def export_checkpoint(self) -> bytes:
        raw: dict[str, Any] = json.loads(super().export_checkpoint().decode("utf-8"))
        raw["recovery_history_seconds"] = ROUTE_HISTORY_SECONDS
        return json.dumps(raw, sort_keys=True, separators=(",", ":")).encode("utf-8")

    @property
    def recovery_history_start_utc(self):
        if self.processed_until_utc is None:
            return None
        return self.processed_until_utc - timedelta(seconds=ROUTE_HISTORY_SECONDS)

    def hydrate_recovery_history(self, samples: Iterable[VehicleSample]) -> None:
        frontier = self.processed_until_utc
        if frontier is None:
            return
        lower = frontier - timedelta(seconds=ROUTE_HISTORY_SECONDS)
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
                _legacy_session._bounded_history(route.history, route.history[-1].sample_time_utc)


__all__ = ["CoreSession", "ROUTE_HISTORY_SECONDS"]
