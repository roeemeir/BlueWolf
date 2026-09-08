"""Manual SO template selection scoped to group id and constellation.

The product contract is intentionally narrow:
- developers decide which templates are legal and which one is the default;
- operators may choose only from the bank entries relevant to their group;
- a manual choice persists only for the same ``group_id`` and constellation.

This module does not score alternatives or implement suggestion hysteresis.  It
stores explicit operator choices and resolves them against an ``SOTemplateBank``.
A saved template that later disappears from the bank is reported as stale rather
than silently changing the operator's choice.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .so_template_bank import SOConstellationRoute, SOConstellationSignature, SOTemplateBank
from .so_templates import SORouteKind, SOTemplate


class InvalidSOTemplateSelection(ValueError):
    """An operator attempted to select a template outside the relevant bank."""


class StaleSOTemplateSelection(ValueError):
    """A previously valid manual selection is no longer present/relevant."""


SelectionKey = tuple[str, tuple[tuple[str, tuple[str, ...]], ...]]


def _selection_key(
    group_id: str,
    constellation: SOConstellationSignature,
) -> SelectionKey:
    if not group_id:
        raise ValueError("group_id is required")
    return group_id, constellation.key


@dataclass(frozen=True, slots=True)
class SOTemplateSelectionResolution:
    template: SOTemplate | None
    source: str

    def __post_init__(self) -> None:
        if self.source not in ("manual", "default", "none"):
            raise ValueError("selection source must be manual, default or none")
        if self.source == "none" and self.template is not None:
            raise ValueError("none selection cannot contain a template")
        if self.source != "none" and self.template is None:
            raise ValueError("resolved selection requires a template")


class SOTemplateSelectionState:
    """Mutable operator-choice state with deterministic export/import."""

    def __init__(self) -> None:
        self._manual: dict[SelectionKey, str] = {}

    def select_manual(
        self,
        bank: SOTemplateBank,
        group_id: str,
        constellation: SOConstellationSignature,
        template_id: str,
    ) -> None:
        if not template_id:
            raise ValueError("template_id is required")
        if not bank.is_relevant(constellation, template_id):
            raise InvalidSOTemplateSelection(
                f"template {template_id!r} is not relevant to the supplied SO constellation"
            )
        self._manual[_selection_key(group_id, constellation)] = template_id

    def clear_manual(
        self,
        group_id: str,
        constellation: SOConstellationSignature,
    ) -> None:
        self._manual.pop(_selection_key(group_id, constellation), None)

    def manual_template_id(
        self,
        group_id: str,
        constellation: SOConstellationSignature,
    ) -> str | None:
        return self._manual.get(_selection_key(group_id, constellation))

    def resolve(
        self,
        bank: SOTemplateBank,
        group_id: str,
        constellation: SOConstellationSignature,
    ) -> SOTemplateSelectionResolution:
        manual_id = self.manual_template_id(group_id, constellation)
        if manual_id is not None:
            if not bank.is_relevant(constellation, manual_id):
                raise StaleSOTemplateSelection(
                    f"saved template {manual_id!r} is no longer relevant/present"
                )
            template = bank.template_by_id(manual_id)
            if template is None:
                raise StaleSOTemplateSelection(
                    f"saved template {manual_id!r} is no longer present"
                )
            return SOTemplateSelectionResolution(template, "manual")

        default = bank.default_template(constellation)
        if default is not None:
            return SOTemplateSelectionResolution(default, "default")
        return SOTemplateSelectionResolution(None, "none")

    def export_state(self) -> Mapping[str, Any]:
        rows = []
        for (group_id, route_key), template_id in sorted(self._manual.items()):
            rows.append(
                {
                    "group_id": group_id,
                    "template_id": template_id,
                    "routes": [
                        {
                            "route_kind": route_kind,
                            "vehicle_types": list(vehicle_types),
                        }
                        for route_kind, vehicle_types in route_key
                    ],
                }
            )
        return {"manual": rows}

    @classmethod
    def from_state(cls, raw: Mapping[str, Any]) -> "SOTemplateSelectionState":
        state = cls()
        for row in raw.get("manual", []):
            if not isinstance(row, Mapping):
                raise ValueError("manual selection row must be an object")
            routes_raw = row.get("routes", [])
            if not isinstance(routes_raw, list) or not routes_raw:
                raise ValueError("manual selection requires a non-empty constellation")
            routes = []
            for route_raw in routes_raw:
                if not isinstance(route_raw, Mapping):
                    raise ValueError("constellation route must be an object")
                vehicle_types = route_raw.get("vehicle_types", [])
                if not isinstance(vehicle_types, list):
                    raise ValueError("vehicle_types must be a list")
                routes.append(
                    SOConstellationRoute(
                        SORouteKind(str(route_raw["route_kind"])),
                        tuple(str(value) for value in vehicle_types),
                    )
                )
            constellation = SOConstellationSignature(tuple(routes))
            group_id = str(row.get("group_id", ""))
            template_id = str(row.get("template_id", ""))
            if not group_id or not template_id:
                raise ValueError("persisted group_id/template_id must be non-empty")
            state._manual[_selection_key(group_id, constellation)] = template_id
        return state
