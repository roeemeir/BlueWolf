"""Deterministic SO template selection over the developer-approved bank.

Conformance source: core/docs/TEMPLATE_SELECTION_LIFECYCLE_HE.md.

This module owns only *which already-approved template is active* for a
(group_id, constellation) pair. It does not create templates, alter structural
grouping, fit templates, compute synchronization scores, or implement the
30-point recommendation lifecycle (which is event-scoped and belongs beside the
Event Engine).

Precedence is explicit and spec-conformant:
    manual selection for this exact group+constellation
        -> developer default for this constellation
        -> no active template

Manual choices never migrate to another group id or constellation. A bank
revision is reconciled explicitly: stale choices are invalidated and reported,
never silently remapped to a different template.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Mapping

from .so_template_bank import (
    SOConstellationRoute,
    SOConstellationSignature,
    SOTemplateBank,
)
from .so_templates import SORouteKind, SOTemplate


class InvalidSOTemplateSelection(ValueError):
    """A requested or persisted selection violates the current template bank."""


class SOTemplateSelectionSource(StrEnum):
    MANUAL = "manual"
    DEFAULT = "default"
    NONE = "none"


@dataclass(frozen=True, slots=True)
class SOTemplateSelection:
    group_id: str
    constellation: SOConstellationSignature
    template: SOTemplate | None
    source: SOTemplateSelectionSource

    def __post_init__(self) -> None:
        if not self.group_id:
            raise ValueError("group_id is required")
        if self.template is None and self.source is not SOTemplateSelectionSource.NONE:
            raise ValueError("a non-none selection source requires a template")
        if self.template is not None and self.source is SOTemplateSelectionSource.NONE:
            raise ValueError("source NONE cannot carry a template")

    @property
    def template_id(self) -> str | None:
        return self.template.template_id if self.template is not None else None


@dataclass(frozen=True, slots=True)
class InvalidatedManualSelection:
    group_id: str
    constellation: SOConstellationSignature
    template_id: str
    reason: str

    def __post_init__(self) -> None:
        if not self.group_id or not self.template_id or not self.reason:
            raise ValueError("invalidated selection fields must be non-empty")


SelectionKey = tuple[str, tuple[tuple[str, tuple[str, ...]], ...]]


def _selection_key(
    group_id: str,
    constellation: SOConstellationSignature,
) -> SelectionKey:
    if not group_id:
        raise ValueError("group_id is required")
    return group_id, constellation.key


def _signature_to_dict(signature: SOConstellationSignature) -> dict[str, Any]:
    return {
        "routes": [
            {
                "route_kind": route.route_kind.value,
                "vehicle_types": list(route.vehicle_types),
            }
            for route in signature.routes
        ]
    }


def _signature_from_dict(value: object) -> SOConstellationSignature:
    if not isinstance(value, Mapping):
        raise InvalidSOTemplateSelection("constellation must be an object")
    raw_routes = value.get("routes")
    if not isinstance(raw_routes, list) or not raw_routes:
        raise InvalidSOTemplateSelection("constellation routes must be a non-empty list")
    routes: list[SOConstellationRoute] = []
    for raw in raw_routes:
        if not isinstance(raw, Mapping):
            raise InvalidSOTemplateSelection("constellation route must be an object")
        raw_types = raw.get("vehicle_types")
        if not isinstance(raw_types, list) or not raw_types:
            raise InvalidSOTemplateSelection("vehicle_types must be a non-empty list")
        try:
            route_kind = SORouteKind(str(raw["route_kind"]))
        except (KeyError, ValueError) as exc:
            raise InvalidSOTemplateSelection("invalid route_kind in constellation") from exc
        routes.append(
            SOConstellationRoute(
                route_kind=route_kind,
                vehicle_types=tuple(str(item) for item in raw_types),
            )
        )
    return SOConstellationSignature(tuple(routes))


class SOTemplateSelectionRegistry:
    """Mutable operational registry with deterministic serialization.

    The registry deliberately stores only manual overrides. Developer defaults
    remain properties of ``SOTemplateBank`` and are therefore picked up
    automatically when a bank version changes.
    """

    def __init__(self, bank: SOTemplateBank) -> None:
        self._bank = bank
        self._manual: dict[SelectionKey, str] = {}

    @property
    def bank(self) -> SOTemplateBank:
        return self._bank

    def active_selection(
        self,
        group_id: str,
        constellation: SOConstellationSignature,
    ) -> SOTemplateSelection:
        key = _selection_key(group_id, constellation)
        manual_id = self._manual.get(key)
        if manual_id is not None:
            template = self._bank.template_by_id(manual_id)
            # Internal state is kept self-consistent by set/reconcile/from_state.
            if template is None or not self._bank.is_relevant(constellation, manual_id):
                raise AssertionError("manual template selection registry is inconsistent")
            return SOTemplateSelection(
                group_id,
                constellation,
                template,
                SOTemplateSelectionSource.MANUAL,
            )

        default = self._bank.default_template(constellation)
        if default is not None:
            return SOTemplateSelection(
                group_id,
                constellation,
                default,
                SOTemplateSelectionSource.DEFAULT,
            )
        return SOTemplateSelection(
            group_id,
            constellation,
            None,
            SOTemplateSelectionSource.NONE,
        )

    def select_manual(
        self,
        group_id: str,
        constellation: SOConstellationSignature,
        template_id: str,
    ) -> SOTemplateSelection:
        if not template_id:
            raise ValueError("template_id is required")
        if not self._bank.is_relevant(constellation, template_id):
            raise InvalidSOTemplateSelection(
                f"template {template_id!r} is not approved for the supplied constellation"
            )
        self._manual[_selection_key(group_id, constellation)] = template_id
        return self.active_selection(group_id, constellation)

    def clear_manual(
        self,
        group_id: str,
        constellation: SOConstellationSignature,
    ) -> SOTemplateSelection:
        self._manual.pop(_selection_key(group_id, constellation), None)
        return self.active_selection(group_id, constellation)

    def reconcile_bank(
        self,
        bank: SOTemplateBank,
    ) -> tuple[InvalidatedManualSelection, ...]:
        """Apply a new developer bank and explicitly invalidate stale overrides."""

        invalidated: list[InvalidatedManualSelection] = []
        for key, template_id in sorted(self._manual.items()):
            group_id, constellation_key = key
            # Reconstructing through the currently stored key is intentionally
            # avoided; the canonical signature is recovered from a bank entry
            # when possible, otherwise from our serialized/manual snapshot below.
            # We keep a parallel lookup from the key in export state semantics.
            constellation = _signature_from_key(constellation_key)
            if not bank.is_relevant(constellation, template_id):
                reason = (
                    "template_removed"
                    if bank.template_by_id(template_id) is None
                    else "template_no_longer_relevant"
                )
                invalidated.append(
                    InvalidatedManualSelection(
                        group_id=group_id,
                        constellation=constellation,
                        template_id=template_id,
                        reason=reason,
                    )
                )

        invalidated_keys = {
            _selection_key(item.group_id, item.constellation) for item in invalidated
        }
        self._manual = {
            key: template_id
            for key, template_id in self._manual.items()
            if key not in invalidated_keys
        }
        self._bank = bank
        return tuple(invalidated)

    def export_state(self) -> dict[str, Any]:
        """Return deterministic JSON-serializable manual-selection state."""

        selections = []
        for (group_id, constellation_key), template_id in sorted(self._manual.items()):
            constellation = _signature_from_key(constellation_key)
            selections.append(
                {
                    "group_id": group_id,
                    "constellation": _signature_to_dict(constellation),
                    "template_id": template_id,
                }
            )
        return {"manual_selections": selections}

    @classmethod
    def from_state(
        cls,
        bank: SOTemplateBank,
        state: Mapping[str, Any],
    ) -> tuple["SOTemplateSelectionRegistry", tuple[InvalidatedManualSelection, ...]]:
        """Restore state and report selections invalid under the supplied bank."""

        registry = cls(bank)
        invalidated: list[InvalidatedManualSelection] = []
        raw_items = state.get("manual_selections", [])
        if not isinstance(raw_items, list):
            raise InvalidSOTemplateSelection("manual_selections must be a list")

        seen: set[SelectionKey] = set()
        for raw in raw_items:
            if not isinstance(raw, Mapping):
                raise InvalidSOTemplateSelection("manual selection must be an object")
            group_id = str(raw.get("group_id", ""))
            template_id = str(raw.get("template_id", ""))
            if not group_id or not template_id:
                raise InvalidSOTemplateSelection("persisted group_id/template_id are required")
            constellation = _signature_from_dict(raw.get("constellation"))
            key = _selection_key(group_id, constellation)
            if key in seen:
                raise InvalidSOTemplateSelection(
                    "duplicate manual selection for the same group and constellation"
                )
            seen.add(key)

            if not bank.is_relevant(constellation, template_id):
                reason = (
                    "template_removed"
                    if bank.template_by_id(template_id) is None
                    else "template_no_longer_relevant"
                )
                invalidated.append(
                    InvalidatedManualSelection(
                        group_id,
                        constellation,
                        template_id,
                        reason,
                    )
                )
                continue
            registry._manual[key] = template_id

        return registry, tuple(invalidated)


def _signature_from_key(
    key: tuple[tuple[str, tuple[str, ...]], ...],
) -> SOConstellationSignature:
    return SOConstellationSignature(
        tuple(
            SOConstellationRoute(
                route_kind=SORouteKind(route_kind),
                vehicle_types=tuple(vehicle_types),
            )
            for route_kind, vehicle_types in key
        )
    )
