"""Checkpoint adapter for the explicitly enabled truth-scored SI family."""
from __future__ import annotations

from collections.abc import Mapping

from .core_scored_si import CoreScoredSIRuntime
from .family_runtime import SIFamilyRuntimeAdapter


class CoreScoredSIFamilyRuntimeAdapter(SIFamilyRuntimeAdapter):
    """Restore the same scored runtime type, not the invalid-policy base type."""

    def _restore_runtime_state(self, state: Mapping[str, object]) -> None:
        current = self.producer.runtime
        if not isinstance(current, CoreScoredSIRuntime):
            raise ValueError("SI family is not configured for Core score publication")
        templates = tuple(entry.template for entry in self.producer.templates)
        self.producer.runtime = CoreScoredSIRuntime.from_state(
            templates,
            state,
            scoring_config=current.scoring_config,
            event_config=current.event_engine.config,
            observation_sink=current.observation_sink,
            lifecycle_sink=current.lifecycle_sink,
        )


__all__ = ["CoreScoredSIFamilyRuntimeAdapter"]
