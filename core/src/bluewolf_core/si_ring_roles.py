"""Evidence-based SI ring-role and template resolution.

Ring roles are operational semantics, not labels inferred from vehicle IDs.  A
runtime group is therefore resolved only when one unique assignment satisfies
both the selected template's type/role slots and the geometric ordering of the
confirmed SI routes.  No product threshold is introduced here: route roles of
different rank must have strictly ordered ``short_axis_b_m`` values.  Equal or
otherwise multiply-assignable evidence is reported as ambiguous and scoring
remains fail-closed.
"""
from __future__ import annotations

from dataclasses import dataclass
import math

from .models import ClosedRoute, RouteFamily
from .templates import SynchronizationTemplate, TemplateSlot


_ROLE_ORDER = {"inner": 0, "middle": 1, "outer": 2}


class NoLegalSIRingAssignment(ValueError):
    """No template/role assignment matches the observed SI group."""


class AmbiguousSIRingAssignment(ValueError):
    """More than one template/role assignment is supported by the evidence."""


@dataclass(frozen=True, slots=True)
class SIRingMemberEvidence:
    member_id: str
    vehicle_type: str
    route: ClosedRoute

    def __post_init__(self) -> None:
        if not self.member_id or not self.vehicle_type:
            raise ValueError("member_id and vehicle_type are required")
        if self.route.family is not RouteFamily.SI:
            raise ValueError("SI ring evidence requires an SI route")
        if not math.isfinite(self.route.short_axis_b_m) or self.route.short_axis_b_m <= 0.0:
            raise ValueError("SI route short_axis_b_m must be finite and positive")


@dataclass(frozen=True, slots=True)
class SIRingAssignment:
    template: SynchronizationTemplate
    member_roles: tuple[tuple[str, str], ...]
    member_slot_ids: tuple[tuple[str, str], ...]

    def role_for(self, member_id: str) -> str:
        for candidate, role in self.member_roles:
            if candidate == member_id:
                return role
        raise KeyError(member_id)

    def slot_for(self, member_id: str) -> str:
        for candidate, slot_id in self.member_slot_ids:
            if candidate == member_id:
                return slot_id
        raise KeyError(member_id)


def _role(slot: TemplateSlot) -> str:
    role = slot.route_role
    if role not in _ROLE_ORDER:
        raise ValueError("SI template slots must declare inner, middle or outer route_role")
    return role


def _legal(member: SIRingMemberEvidence, slot: TemplateSlot) -> bool:
    return member.vehicle_type == slot.vehicle_type and _role(slot) in _ROLE_ORDER


def _geometrically_consistent(
    members: tuple[SIRingMemberEvidence, ...],
    slots: tuple[TemplateSlot, ...],
) -> bool:
    for first_index, first_slot in enumerate(slots):
        first_role = _ROLE_ORDER[_role(first_slot)]
        first_scale = members[first_index].route.short_axis_b_m
        for second_index, second_slot in enumerate(slots):
            second_role = _ROLE_ORDER[_role(second_slot)]
            if first_role >= second_role:
                continue
            second_scale = members[second_index].route.short_axis_b_m
            # Distinct ring roles require strictly ordered geometric evidence.
            # There is deliberately no arbitrary minimum-separation threshold.
            if not first_scale < second_scale:
                return False
    return True


def _assignments(
    template: SynchronizationTemplate,
    members: tuple[SIRingMemberEvidence, ...],
) -> tuple[SIRingAssignment, ...]:
    if template.family is not RouteFamily.SI:
        return ()
    if len(template.slots) != len(members):
        return ()
    ordered_members = tuple(sorted(members, key=lambda item: item.member_id))
    output: list[SIRingAssignment] = []

    def visit(index: int, remaining: tuple[TemplateSlot, ...], chosen: list[TemplateSlot]) -> None:
        if index == len(ordered_members):
            selected = tuple(chosen)
            if not _geometrically_consistent(ordered_members, selected):
                return
            output.append(
                SIRingAssignment(
                    template=template,
                    member_roles=tuple(
                        (member.member_id, _role(slot))
                        for member, slot in zip(ordered_members, selected, strict=True)
                    ),
                    member_slot_ids=tuple(
                        (member.member_id, slot.slot_id)
                        for member, slot in zip(ordered_members, selected, strict=True)
                    ),
                )
            )
            return
        member = ordered_members[index]
        for slot_index, slot in enumerate(remaining):
            if not _legal(member, slot):
                continue
            chosen.append(slot)
            visit(index + 1, remaining[:slot_index] + remaining[slot_index + 1 :], chosen)
            chosen.pop()

    visit(0, template.slots, [])
    # Multiple slots can be semantically equivalent (same type/role). Collapse
    # permutations that produce exactly the same per-member role assignment.
    unique: dict[tuple[tuple[str, str], ...], SIRingAssignment] = {}
    for assignment in output:
        key = assignment.member_roles
        previous = unique.get(key)
        if previous is None or assignment.member_slot_ids < previous.member_slot_ids:
            unique[key] = assignment
    return tuple(unique[key] for key in sorted(unique))


def resolve_si_ring_assignment(
    templates: tuple[SynchronizationTemplate, ...],
    members: tuple[SIRingMemberEvidence, ...],
    *,
    preferred_template_id: str | None = None,
) -> SIRingAssignment:
    """Return the single assignment supported by current confirmed geometry.

    When ``preferred_template_id`` is provided (for an explicit/default product
    choice), only that template is considered.  Without one, all legal SI
    templates are considered and the function succeeds only if the observed
    evidence identifies one template *and* one role assignment uniquely.
    """

    if len(members) < 2:
        raise NoLegalSIRingAssignment("SI synchronization requires at least two members")
    member_ids = [member.member_id for member in members]
    if len(member_ids) != len(set(member_ids)):
        raise ValueError("SI ring member ids must be unique")

    candidates = tuple(
        template for template in templates
        if template.family is RouteFamily.SI
        and (preferred_template_id is None or template.template_id == preferred_template_id)
    )
    if preferred_template_id is not None and not candidates:
        raise NoLegalSIRingAssignment(f"SI template is unavailable: {preferred_template_id}")

    resolved: list[SIRingAssignment] = []
    for template in candidates:
        resolved.extend(_assignments(template, members))
    if not resolved:
        raise NoLegalSIRingAssignment("no SI template/ring assignment matches current evidence")

    semantic_keys = {
        (
            assignment.template.template_id,
            assignment.member_roles,
        )
        for assignment in resolved
    }
    if len(semantic_keys) != 1:
        raise AmbiguousSIRingAssignment("SI ring/template evidence is ambiguous")
    return min(resolved, key=lambda item: (item.template.template_id, item.member_slot_ids))


__all__ = [
    "AmbiguousSIRingAssignment",
    "NoLegalSIRingAssignment",
    "SIRingAssignment",
    "SIRingMemberEvidence",
    "resolve_si_ring_assignment",
]
