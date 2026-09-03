"""Vehicle-ID-independent synchronization template matching."""

from __future__ import annotations

import math
from dataclasses import dataclass

from .geometry import circular_phase_distance
from .models import RouteFamily


class NoLegalTemplateAssignment(ValueError):
    """The observed composition cannot occupy the template's legal slots."""


@dataclass(frozen=True, slots=True)
class TemplateSlot:
    slot_id: str
    vehicle_type: str
    phase_offset: float
    phase_sign: int = 1
    route_role: str | None = None

    def __post_init__(self) -> None:
        if not self.slot_id or not self.vehicle_type:
            raise ValueError("slot_id and vehicle_type are required")
        if not math.isfinite(self.phase_offset):
            raise ValueError("phase_offset must be finite")
        if self.phase_sign not in (-1, 1):
            raise ValueError("phase_sign must be -1 or 1")
        object.__setattr__(self, "phase_offset", self.phase_offset % 1.0)


@dataclass(frozen=True, slots=True)
class SynchronizationTemplate:
    template_id: str
    name: str
    family: RouteFamily
    slots: tuple[TemplateSlot, ...]

    def __post_init__(self) -> None:
        if self.family is RouteFamily.FREE:
            raise ValueError("free routes do not have synchronization templates")
        if len(self.slots) < 2:
            raise ValueError("a synchronization template requires at least two slots")
        slot_ids = [slot.slot_id for slot in self.slots]
        if len(slot_ids) != len(set(slot_ids)):
            raise ValueError("slot_id values must be unique inside a template")


@dataclass(frozen=True, slots=True)
class ObservedMember:
    member_id: str
    vehicle_type: str
    phase: float
    route_role: str | None = None

    def __post_init__(self) -> None:
        if not self.member_id or not self.vehicle_type:
            raise ValueError("member_id and vehicle_type are required")
        if not math.isfinite(self.phase):
            raise ValueError("phase must be finite")
        object.__setattr__(self, "phase", self.phase % 1.0)


@dataclass(frozen=True, slots=True)
class MemberTemplateFit:
    member_id: str
    slot_id: str
    expected_phase: float
    position_error_cycle: float

    @property
    def position_error_deg(self) -> float:
        return self.position_error_cycle * 360.0


@dataclass(frozen=True, slots=True)
class TemplateFit:
    template_id: str
    common_phase: float
    mean_position_error_cycle: float
    maximum_position_error_cycle: float
    members: tuple[MemberTemplateFit, ...]


def _signed_cycle_delta(value: float, reference: float) -> float:
    return ((value - reference + 0.5) % 1.0) - 0.5


def _circular_l1_center(values: tuple[float, ...]) -> float:
    """Exact circular L1 center; two members split an ambiguous error evenly."""
    if not values:
        raise ValueError("at least one phase is required")
    if len(values) == 1:
        return values[0] % 1.0
    candidates: set[float] = set()
    for anchor in values:
        unwrapped = sorted(anchor + _signed_cycle_delta(value, anchor) for value in values)
        count = len(unwrapped)
        if count % 2:
            candidates.add(unwrapped[count // 2] % 1.0)
        else:
            candidates.add(((unwrapped[count // 2 - 1] + unwrapped[count // 2]) / 2) % 1.0)
    return min(
        candidates,
        key=lambda candidate: (
            sum(circular_phase_distance(value, candidate) for value in values),
            max(circular_phase_distance(value, candidate) for value in values),
            candidate,
        ),
    )


def _legal(member: ObservedMember, slot: TemplateSlot) -> bool:
    return member.vehicle_type == slot.vehicle_type and (
        slot.route_role is None or member.route_role == slot.route_role
    )


def _assignments(
    members: tuple[ObservedMember, ...], slots: tuple[TemplateSlot, ...]
) -> tuple[tuple[TemplateSlot, ...], ...]:
    output: list[tuple[TemplateSlot, ...]] = []

    def visit(index: int, remaining: tuple[TemplateSlot, ...], chosen: list[TemplateSlot]) -> None:
        if index == len(members):
            output.append(tuple(chosen))
            return
        member = members[index]
        for slot_index, slot in enumerate(remaining):
            if _legal(member, slot):
                chosen.append(slot)
                visit(index + 1, remaining[:slot_index] + remaining[slot_index + 1 :], chosen)
                chosen.pop()

    visit(0, slots, [])
    return tuple(output)


def fit_template(
    template: SynchronizationTemplate,
    members: tuple[ObservedMember, ...],
) -> TemplateFit:
    """Choose legal slots and a free common phase without binding vehicle IDs."""
    if len(members) != len(template.slots):
        raise NoLegalTemplateAssignment("member count does not match template")
    ordered_members = tuple(sorted(members, key=lambda member: member.member_id))
    assignments = _assignments(ordered_members, template.slots)
    if not assignments:
        raise NoLegalTemplateAssignment("vehicle types or route roles do not match")

    best_key: tuple[float, float, tuple[str, ...], float] | None = None
    best_result: TemplateFit | None = None
    for slots in assignments:
        normalized = tuple(
            (slot.phase_sign * member.phase - slot.phase_offset) % 1.0
            for member, slot in zip(ordered_members, slots, strict=True)
        )
        common = _circular_l1_center(normalized)
        member_fits = tuple(
            MemberTemplateFit(
                member_id=member.member_id,
                slot_id=slot.slot_id,
                expected_phase=(slot.phase_sign * (common + slot.phase_offset)) % 1.0,
                position_error_cycle=circular_phase_distance(value, common),
            )
            for member, slot, value in zip(ordered_members, slots, normalized, strict=True)
        )
        mean_error = sum(item.position_error_cycle for item in member_fits) / len(member_fits)
        maximum_error = max(item.position_error_cycle for item in member_fits)
        key = (
            round(mean_error, 15),
            round(maximum_error, 15),
            tuple(slot.slot_id for slot in slots),
            common,
        )
        if best_key is None or key < best_key:
            best_key = key
            best_result = TemplateFit(
                template_id=template.template_id,
                common_phase=common,
                mean_position_error_cycle=mean_error,
                maximum_position_error_cycle=maximum_error,
                members=member_fits,
            )
    if best_result is None:
        raise AssertionError("unreachable")
    return best_result
