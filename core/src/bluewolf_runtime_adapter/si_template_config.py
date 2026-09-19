"""Parse Web-authored SI templates and vehicle profiles into Core domain objects.

The Web workspace may retain legacy pair-only SI templates for migration, but
only explicit ``siTemplates`` and ``siVehicleTypes`` cross into the operational
Python runtime. No coordinates, vehicle types, ring roles or work speeds are
inferred from display text or vehicle identifiers.
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


@dataclass(frozen=True, slots=True)
class OperationalSIVehicleType:
    type_id: str
    min_id: int
    max_id: int
    work_speed_mps: float
    si_roles: frozenset[str]
    id_ranges: tuple[tuple[int, int], ...] = ()

    def __post_init__(self) -> None:
        if not self.type_id:
            raise ValueError("SI vehicle type id is required")
        ranges = self.id_ranges or ((self.min_id, self.max_id),)
        if not ranges:
            raise ValueError("SI vehicle type requires at least one id range")
        for minimum, maximum in ranges:
            if minimum < 0 or maximum < minimum:
                raise ValueError("SI vehicle id range is invalid")
        if not math.isfinite(self.work_speed_mps) or self.work_speed_mps <= 0.0:
            raise ValueError("SI vehicle workSpeedMps must be finite and positive")
        if not self.si_roles or not self.si_roles.issubset(_RING_ROLES):
            raise ValueError("SI vehicle roles must be a non-empty subset of inner/middle/outer")

    @property
    def ranges(self) -> tuple[tuple[int, int], ...]:
        return self.id_ranges or ((self.min_id, self.max_id),)

    def contains(self, vehicle_identifier: int) -> bool:
        return any(minimum <= vehicle_identifier <= maximum for minimum, maximum in self.ranges)


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


def _integer(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer")
    return value


def _positive_number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be numeric")
    result = float(value)
    if not math.isfinite(result) or result <= 0.0:
        raise ValueError(f"{name} must be finite and positive")
    return result


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


def parse_si_vehicle_types(raw: object) -> tuple[OperationalSIVehicleType, ...]:
    if raw is None:
        return ()
    values = _list(raw, "siVehicleTypes")
    output: list[OperationalSIVehicleType] = []
    type_ids: set[str] = set()
    for index, raw_profile in enumerate(values):
        value = _object(raw_profile, f"siVehicleTypes[{index}]")
        type_id = _text(value.get("id"), f"siVehicleTypes[{index}].id")
        if type_id in type_ids:
            raise ValueError(f"duplicate SI vehicle type id: {type_id}")
        type_ids.add(type_id)
        roles = frozenset(
            _text(role, f"siVehicleTypes[{index}].siRoles")
            for role in _list(value.get("siRoles"), f"siVehicleTypes[{index}].siRoles")
        )
        raw_ranges = value.get("ranges")
        if raw_ranges is None:
            ranges = (
                (
                    _integer(value.get("minId"), f"siVehicleTypes[{index}].minId"),
                    _integer(value.get("maxId"), f"siVehicleTypes[{index}].maxId"),
                ),
            )
        else:
            parsed_ranges: list[tuple[int, int]] = []
            for range_index, raw_range in enumerate(
                _list(raw_ranges, f"siVehicleTypes[{index}].ranges")
            ):
                range_value = _object(
                    raw_range,
                    f"siVehicleTypes[{index}].ranges[{range_index}]",
                )
                parsed_ranges.append(
                    (
                        _integer(
                            range_value.get("minId"),
                            f"siVehicleTypes[{index}].ranges[{range_index}].minId",
                        ),
                        _integer(
                            range_value.get("maxId"),
                            f"siVehicleTypes[{index}].ranges[{range_index}].maxId",
                        ),
                    )
                )
            if not parsed_ranges:
                raise ValueError("SI vehicle type ranges cannot be empty")
            ranges = tuple(parsed_ranges)
        output.append(
            OperationalSIVehicleType(
                type_id=type_id,
                min_id=ranges[0][0],
                max_id=ranges[0][1],
                id_ranges=ranges,
                work_speed_mps=_positive_number(
                    value.get("workSpeedMps"),
                    f"siVehicleTypes[{index}].workSpeedMps",
                ),
                si_roles=roles,
            )
        )
    flattened = sorted(
        (
            (minimum, maximum, profile.type_id)
            for profile in output
            for minimum, maximum in profile.ranges
        ),
        key=lambda item: (item[0], item[1], item[2]),
    )
    for previous, current in zip(flattened, flattened[1:]):
        if current[0] <= previous[1]:
            raise ValueError(
                f"overlapping SI vehicle id ranges: {previous[2]} and {current[2]}"
            )
    return tuple(sorted(output, key=lambda item: (item.min_id, item.max_id, item.type_id)))


def resolve_si_vehicle_type(
    profiles: tuple[OperationalSIVehicleType, ...],
    vehicle_identifier: int,
) -> OperationalSIVehicleType | None:
    if isinstance(vehicle_identifier, bool) or not isinstance(vehicle_identifier, int) or vehicle_identifier < 0:
        raise ValueError("vehicle_identifier must be a non-negative integer")
    matches = [profile for profile in profiles if profile.contains(vehicle_identifier)]
    if len(matches) > 1:
        raise ValueError("SI vehicle profile resolution is ambiguous")
    return None if not matches else matches[0]


def validate_si_runtime_configuration(
    templates: tuple[OperationalSITemplateEntry, ...],
    profiles: tuple[OperationalSIVehicleType, ...],
) -> None:
    profile_by_type = {profile.type_id: profile for profile in profiles}
    default_by_signature: dict[tuple[tuple[str, str], ...], str] = {}
    for entry in templates:
        signature: list[tuple[str, str]] = []
        for slot in entry.template.slots:
            profile = profile_by_type.get(slot.vehicle_type)
            if profile is None:
                raise ValueError(
                    f"SI template {entry.template.template_id} references unknown vehicle type {slot.vehicle_type}"
                )
            if slot.route_role is None or slot.route_role not in profile.si_roles:
                raise ValueError(
                    f"SI template {entry.template.template_id} uses forbidden role {slot.route_role} for {slot.vehicle_type}"
                )
            signature.append((slot.vehicle_type, slot.route_role))
        if entry.is_default:
            key = tuple(sorted(signature))
            previous = default_by_signature.get(key)
            if previous is not None:
                raise ValueError(
                    f"multiple default SI templates for one composition: {previous} and {entry.template.template_id}"
                )
            default_by_signature[key] = entry.template.template_id


__all__ = [
    "OperationalSITemplateEntry",
    "OperationalSIVehicleType",
    "parse_si_templates",
    "parse_si_vehicle_types",
    "resolve_si_vehicle_type",
    "validate_si_runtime_configuration",
]
