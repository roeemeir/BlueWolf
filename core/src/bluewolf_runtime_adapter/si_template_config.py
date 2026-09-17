"""Parse Web-authored SI coordinate templates into Core domain objects.

The Web workspace is allowed to persist legacy pair-only SI templates for
migration/readability, but only the explicit ``siTemplates`` operational
contract crosses into the Python runtime.  Every slot therefore carries an
exact vehicle type, ring role and normalized phase offset; no coordinates are
reconstructed from pairwise labels or display text.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import math
from typing import Any

from bluewolf_core.models import RouteFamily
from bluewolf_core.templates import SynchronizationTemplate, TemplateSlot


_RING_ROLES = frozenset({"inner", "middle", "outer"})


@dataclass(frozen=True, slots=True)
class OperationalSITemplateEntry:
    template: SynchronizationTemplate
    is_default: bool = False


def _object(value: object, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    return value


def _list(value: object, name: str) -> Sequence[object]:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be a list")
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
    return result


def parse_si_templates(raw: object) -> tuple[OperationalSITemplateEntry, ...]:
    """Parse the operational ``siTemplates`` array without inference."""

    if raw is None:
        return ()
    values = _list(raw, "siTemplates")
    entries: list[OperationalSITemplateEntry] = []
    template_ids: set[str] = set()
    for template_index, raw_template in enumerate(values):
        value = _object(raw_template, f"siTemplates[{template_index}]")
        template_id = _text(value.get("id"), f"siTemplates[{template_index}].id")
        if template_id in template_ids:
            raise ValueError(f"duplicate SI template id: {template_id}")
        template_ids.add(template_id)
        name = _text(value.get("name"), f"siTemplates[{template_index}].name")
        slots: list[TemplateSlot] = []
        slot_ids: set[str] = set()
        for slot_index, raw_slot in enumerate(
            _list(value.get("slots"), f"siTemplates[{template_index}].slots")
        ):
            slot = _object(raw_slot, f"siTemplates[{template_index}].slots[{slot_index}]")
            slot_id = _text(slot.get("id"), f"siTemplates[{template_index}].slots[{slot_index}].id")
            if slot_id in slot_ids:
                raise ValueError(f"duplicate SI template slot id: {slot_id}")
            slot_ids.add(slot_id)
            route_role = _text(
                slot.get("routeRole"),
                f"siTemplates[{template_index}].slots[{slot_index}].routeRole",
            )
            if route_role not in _RING_ROLES:
                raise ValueError("SI template routeRole must be inner, middle or outer")
            slots.append(
                TemplateSlot(
                    slot_id=slot_id,
                    vehicle_type=_text(
                        slot.get("vehicleType"),
                        f"siTemplates[{template_index}].slots[{slot_index}].vehicleType",
                    ),
                    phase_offset=_phase(
                        slot.get("phaseOffset"),
                        f"siTemplates[{template_index}].slots[{slot_index}].phaseOffset",
                    ),
                    route_role=route_role,
                )
            )
        entries.append(
            OperationalSITemplateEntry(
                template=SynchronizationTemplate(
                    template_id=template_id,
                    name=name,
                    family=RouteFamily.SI,
                    slots=tuple(slots),
                ),
                is_default=bool(value.get("default", False)),
            )
        )
    return tuple(entries)


__all__ = ["OperationalSITemplateEntry", "parse_si_templates"]
