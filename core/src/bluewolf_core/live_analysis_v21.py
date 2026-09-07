"""v2.1 live-analysis concurrency and stale-batch hardening.

The HTTP transport is intentionally threaded so independent sessions can run in
parallel. A single LiveAnalysisSession, however, is mutable algorithm state and
must behave like one ordered stream. This wrapper serializes ingest/checkpoint
operations per session and makes overlapping/stale source batches idempotent.

Raw NAV that arrives late may still join the bounded display window. Only
samples strictly newer than the CoreSession frontier are forwarded into the
state machine, and the public analysis/provenance timestamp never moves
backwards.
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime
from typing import Any, Mapping

from . import application_analysis_v20 as _application_analysis_v20  # noqa: F401
from .live_analysis import _core_bootstrap_samples, _parse_time, _sample_key, _vehicle_sample
from .live_analysis_v20 import LiveAnalysisEnvelope, LiveAnalysisSession as _V20LiveAnalysisSession


class LiveAnalysisSession(_V20LiveAnalysisSession):
    __slots__ = ("_ingest_lock",)

    def __post_init__(self) -> None:
        super().__post_init__()
        self._ingest_lock = threading.RLock()

    @staticmethod
    def _wire_time(value: datetime) -> str:
        return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def ingest(self, dataset: Mapping[str, Any]) -> LiveAnalysisEnvelope:
        with self._ingest_lock:
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
            frontier = self.core.processed_until_utc
            core_batch = None

            if frontier is None:
                core_samples = _core_bootstrap_samples(accepted, observed)
                if core_samples or observed is not None:
                    core_batch = self.core.process_batch(
                        [_vehicle_sample(sample) for sample in core_samples],
                        observed_until_utc=observed,
                    )
            else:
                core_samples = [
                    sample for sample in accepted
                    if _parse_time(str(sample["timestamp"])) > frontier
                ]
                newest_sample = max(
                    (_parse_time(str(sample["timestamp"])) for sample in core_samples),
                    default=frontier,
                )
                effective_observed = max(frontier, newest_sample)
                if observed is not None and observed > effective_observed:
                    effective_observed = observed
                if core_samples or effective_observed > frontier:
                    core_batch = self.core.process_batch(
                        [_vehicle_sample(sample) for sample in core_samples],
                        observed_until_utc=effective_observed,
                    )

            # A stale overlapping request must not make the operational picture
            # appear older than a batch that already completed on this session.
            newest_display = max(
                (_parse_time(str(sample["timestamp"])) for sample in self.samples),
                default=self.core.processed_until_utc or observed or datetime.now(tz=UTC),
            )
            effective_latest = max(
                value for value in (observed, self.core.processed_until_utc, newest_display)
                if value is not None
            )
            latest_wire = self._wire_time(effective_latest)
            provenance["to"] = latest_wire
            provenance["latestSampleAt"] = latest_wire

            return self._analysis_envelope(
                provenance,
                accepted_samples=len(accepted),
                core_batch=core_batch,
                bootstrap_history=not self.history,
            )

    def checkpoint(self) -> bytes:
        with self._ingest_lock:
            return super().checkpoint()


__all__ = ["LiveAnalysisSession", "LiveAnalysisEnvelope"]
