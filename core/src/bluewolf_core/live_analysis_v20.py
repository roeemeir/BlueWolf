"""v2.0 live-analysis refinement for bounded current-state computation.

The selected Operator NAV window may be 30-120 minutes because the map and
Timeline need that evidence. Current route/group scoring must not repeatedly fit
all of that history on every warm-up. This module keeps the complete bounded
NAV display window in memory, while the *current* operational analysis uses the
most recent 15 minutes. Fifteen minutes is comfortably longer than the route
fitting/state horizon and several normal route periods, while avoiding stale
geometry dominating a current transition.

No UI, network, DB, filesystem or simulator-GT dependency is introduced here.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Mapping

from .application_analysis_v19 import analyze_navigation_dataset, derive_events
from .live_analysis import (
    LiveAnalysisEnvelope,
    LiveAnalysisSession as _BaseLiveAnalysisSession,
    _bounded_dataset,
    _parse_time,
    _sample_key,
)

_CURRENT_ANALYSIS_SECONDS = 15 * 60
_HISTORY_FRAME_SECONDS = 12 * 60


class LiveAnalysisSession(_BaseLiveAnalysisSession):
    """Live session with a bounded current-analysis horizon.

    ``self.samples`` still retains the configured Operator window. Only the
    current algorithm fit is clipped to the recent horizon. The public
    provenance remains the provenance of the selected NAV window so the UI's
    sample/completeness metrics continue to describe the data actually loaded.
    """

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
            retention_cutoff = latest - timedelta(seconds=self.retention_seconds)
            self.samples = [
                sample for sample in self.samples
                if _parse_time(str(sample["timestamp"])) >= retention_cutoff
            ]
            self._seen = {_sample_key(sample) for sample in self.samples}

        if self.samples:
            full_start = min(_parse_time(str(sample["timestamp"])) for sample in self.samples)
            end = latest or max(_parse_time(str(sample["timestamp"])) for sample in self.samples)
        else:
            end = latest or datetime.now(tz=UTC)
            full_start = end

        full_dataset = _bounded_dataset(self.samples, provenance, full_start, end)
        current_start = max(full_start, end - timedelta(seconds=_CURRENT_ANALYSIS_SECONDS))
        current_samples = [
            sample for sample in self.samples
            if _parse_time(str(sample["timestamp"])) >= current_start
        ]
        current_dataset = _bounded_dataset(current_samples, provenance, current_start, end)
        analysis = analyze_navigation_dataset(current_dataset, self.app_config)
        # The score/route fit comes from the recent operational horizon, but
        # provenance describes the complete selected NAV window used by the
        # Operator map and quality KPIs.
        analysis["provenance"] = full_dataset["provenance"]
        timestamp = full_dataset["provenance"].get("latestSampleAt") or full_dataset["provenance"].get("to")

        if bootstrap_history:
            self.history = [{"timestamp": timestamp, "analysis": analysis}] if timestamp else []
        elif timestamp and (not self.history or self.history[-1]["timestamp"] != timestamp):
            history_start = max(full_start, end - timedelta(seconds=_HISTORY_FRAME_SECONDS))
            history_samples = [
                sample for sample in self.samples
                if _parse_time(str(sample["timestamp"])) >= history_start
            ]
            history_dataset = _bounded_dataset(history_samples, provenance, history_start, end)
            history_analysis = analyze_navigation_dataset(history_dataset, self.app_config)
            history_analysis["provenance"] = full_dataset["provenance"]
            self.history.append({"timestamp": timestamp, "analysis": history_analysis})
            if len(self.history) > self.max_history_frames:
                self.history = self.history[-self.max_history_frames:]

        return LiveAnalysisEnvelope(
            analysis=analysis,
            history=list(self.history),
            events=derive_events(self.history, self.app_config.get("thresholds", {})),
            accepted_samples=accepted_samples,
            core_batch=core_batch,
        )


__all__ = ["LiveAnalysisSession", "LiveAnalysisEnvelope"]
