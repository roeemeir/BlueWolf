"""Stateful first-class SI family runtime.

The SI runtime owns per-group/template temporal scoring state so checkpoint replay
is equivalent to continuous execution. The outer family adapter can therefore
export/restore SI with the same runtime-state contract used by SO.
"""
from __future__ import annotations

from collections.abc import Mapping

from .config import ScoringConfig
from .live_si_scoring import LiveSIGroupScorer
from .models import RouteFamily
from .templates import SynchronizationTemplate


LIVE_SI_RUNTIME_STATE_SCHEMA_VERSION = "bluewolf.live-si-runtime.v1"


class LiveSIRuntime:
    def __init__(
        self,
        templates: tuple[SynchronizationTemplate, ...],
        *,
        scoring_config: ScoringConfig | None = None,
    ) -> None:
        if not templates:
            raise ValueError("live SI runtime requires at least one template")
        by_id: dict[str, SynchronizationTemplate] = {}
        for template in templates:
            if template.family is not RouteFamily.SI:
                raise ValueError("live SI runtime accepts SI templates only")
            if template.template_id in by_id:
                raise ValueError("live SI runtime template ids must be unique")
            by_id[template.template_id] = template
        self.templates = tuple(templates)
        self._templates = by_id
        self.scoring_config = scoring_config or ScoringConfig()
        self._scorers: dict[tuple[str, str], LiveSIGroupScorer] = {}

    def scorer(self, group_id: str, template: SynchronizationTemplate) -> LiveSIGroupScorer:
        if not group_id:
            raise ValueError("SI runtime group_id is required")
        configured = self._templates.get(template.template_id)
        if configured is None or configured != template:
            raise ValueError("SI runtime scorer requested an unconfigured template")
        key = (group_id, template.template_id)
        scorer = self._scorers.get(key)
        if scorer is None:
            scorer = LiveSIGroupScorer(template, config=self.scoring_config)
            self._scorers[key] = scorer
        return scorer

    def remove_group(self, group_id: str) -> None:
        for key in [key for key in self._scorers if key[0] == group_id]:
            self._scorers.pop(key, None)

    def export_state(self) -> dict[str, object]:
        return {
            "schemaVersion": LIVE_SI_RUNTIME_STATE_SCHEMA_VERSION,
            "scorers": [
                {
                    "groupId": group_id,
                    "templateId": template_id,
                    "state": scorer.export_state(),
                }
                for (group_id, template_id), scorer in sorted(self._scorers.items())
            ],
        }

    @classmethod
    def from_state(
        cls,
        templates: tuple[SynchronizationTemplate, ...],
        state: Mapping[str, object],
        *,
        scoring_config: ScoringConfig | None = None,
    ) -> "LiveSIRuntime":
        if state.get("schemaVersion") != LIVE_SI_RUNTIME_STATE_SCHEMA_VERSION:
            raise ValueError("unsupported live SI runtime state schema")
        raw_scorers = state.get("scorers")
        if not isinstance(raw_scorers, list):
            raise ValueError("live SI runtime scorers must be a list")
        runtime = cls(templates, scoring_config=scoring_config)
        seen: set[tuple[str, str]] = set()
        for index, raw in enumerate(raw_scorers):
            if not isinstance(raw, Mapping):
                raise ValueError(f"live SI runtime scorer {index} must be an object")
            group_id = raw.get("groupId")
            template_id = raw.get("templateId")
            scorer_state = raw.get("state")
            if not isinstance(group_id, str) or not group_id:
                raise ValueError("live SI runtime scorer groupId is required")
            if not isinstance(template_id, str) or not template_id:
                raise ValueError("live SI runtime scorer templateId is required")
            if not isinstance(scorer_state, Mapping):
                raise ValueError("live SI runtime scorer state must be an object")
            key = (group_id, template_id)
            if key in seen:
                raise ValueError("live SI runtime scorer keys must be unique")
            seen.add(key)
            template = runtime._templates.get(template_id)
            if template is None:
                raise ValueError(
                    f"persisted SI scorer references unavailable template: {template_id}"
                )
            scorer = LiveSIGroupScorer(template, config=runtime.scoring_config)
            scorer.restore_state(scorer_state)
            runtime._scorers[key] = scorer
        return runtime


__all__ = ["LIVE_SI_RUNTIME_STATE_SCHEMA_VERSION", "LiveSIRuntime"]
