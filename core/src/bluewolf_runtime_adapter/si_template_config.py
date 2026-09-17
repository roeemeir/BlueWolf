"""Operational SI template contract shared with the Web workspace.

The Web authoring surface persists coordinate placements.  The local server
converts those placements to ``siTemplates`` in the operational JSON.  This
module is the only Python-side parser for that boundary and produces the exact
``SynchronizationTemplate`` objects consumed by ``score_si_template``.

Legacy pair-only UI templates are intentionally absent from this contract: they
remain readable for migration but cannot silently become operational scoring
truth without coordinate placement evidence.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
from types import MappingProxyType
from typing import Any, Mapping

from bluewolf_core.models import RouteFamily
from bluewolf_core.templates import SynchronizationTemplate, TemplateSlot


_RING_ROLES = frozenset({"inner", "middle", "outer"})


@dataclass(frozen=True, slots=True)
class OperationalSITemplateEntry:
    template: SynchronizationTemplate
    is_default: bool


def _object(value: object, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    return value


def _text(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value.strip()


def _phase(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be numeric")
    result = float(value)
    if not math.isfinite(result) or not 0.0 <= result < 1.0:
        raise ValueError(f"{name} must be finite and in [0,1)")
    # Operational SI is snapped by the Web editor to exact 30-degree positions.
    step = result * 12.0
    if abs(step - round(step)) > 1e-9:
        raise ValueError(f"{name} must align to a 30-degree SI slot")
    return result


def _phase_sign(value: object, name: str) -> int:
    if value is None:
        return 1
    if isinstance(value, bool) or not isinstance(value, int) or value not in (-1, 1):
        raise ValueError(f"{name} must be -1 or 1")
    return value


def _parse_slot(value: object, template_index: int, slot_index: int) -> TemplateSlot:
    prefix = f"siTemplates[{template_index}].slots[{slot_index}]"
    row = _object(value, prefix)
    route_role = _text(row.get("routeRole"), f"{prefix}.routeRole")
    if route_role not in _RING_ROLES:
        raise ValueError(f"{prefix}.routeRole must be inner, middle or outer")
    return TemplateSlot(
        slot_id=_text(row.get("id"), f"{prefix}.id"),
        vehicle_type=_text(row.get("vehicleType"), f"{prefix}.vehicleType"),
        phase_offset=_phase(row.get("phaseOffset"), f"{prefix}.phaseOffset"),
        phase_sign=_phase_sign(row.get("phaseSign"), f"{prefix}.phaseSign"),
        route_role=route_role,
    )


def parse_operational_si_templates(config: Mapping[str, Any]) -> tuple[OperationalSITemplateEntry, ...]:
    raw = config.get("siTemplates", [])
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ValueError("siTemplates must be a list")

    entries: list[OperationalSITemplateEntry] = []
    template_ids: set[str] = set()
    for index, value in enumerate(raw):
        prefix = f"siTemplates[{index}]"
        row = _object(value, prefix)
        template_id = _text(row.get("id"), f"{prefix}.id")
        if template_id in template_ids:
            raise ValueError(f"duplicate SI template id: {template_id}")
        template_ids.add(template_id)
        raw_slots = row.get("slots")
        if not isinstance(raw_slots, list):
            raise ValueError(f"{prefix}.slots must be a list")
        slots = tuple(_parse_slot(slot, index, slot_index) for slot_index, slot in enumerate(raw_slots))
        template = SynchronizationTemplate(
            template_id=template_id,
            name=_text(row.get("name"), f"{prefix}.name"),
            family=RouteFamily.SI,
            slots=slots,
        )
        is_default = row.get("default", False)
        if not isinstance(is_default, bool):
            raise ValueError(f"{prefix}.default must be boolean")
        entries.append(OperationalSITemplateEntry(template, is_default))
    return tuple(entries)


def operational_si_template_index(
    config: Mapping[str, Any],
) -> Mapping[str, OperationalSITemplateEntry]:
    entries = parse_operational_si_templates(config)
    return MappingProxyType({entry.template.template_id: entry for entry in entries})


__all__ = [
    "OperationalSITemplateEntry",
    "operational_si_template_index",
    "parse_operational_si_templates",
]
