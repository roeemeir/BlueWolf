"""Restart the opted-in SO-scored runtime as its original type and policy."""
from __future__ import annotations

from collections.abc import Mapping

from .core_scored_so import CoreScoredSOEventRuntime
from .family_runtime import SOFamilyRuntimeAdapter


class CoreScoredSOFamilyRuntimeAdapter(SOFamilyRuntimeAdapter):
    def _restore_runtime_state(self, state: Mapping[str, object]) -> None:
        current = self.producer.runtime
        if not isinstance(current, CoreScoredSOEventRuntime):
            raise ValueError("SO family is not configured for Core score publication")
        restored, invalidated = CoreScoredSOEventRuntime.from_state(
            current.bank,
            state,
            scoring_config=current.scorer.scoring_config,
            event_config=current.event_engine.config,
            observation_sink=current.observation_sink,
            lifecycle_sink=current.lifecycle_sink,
        )
        if invalidated:
            ids = ", ".join(item.template_id for item in invalidated)
            raise ValueError(
                f"persisted manual SO template selection invalid under current bank: {ids}"
            )
        self.producer.runtime = restored


__all__ = ["CoreScoredSOFamilyRuntimeAdapter"]
