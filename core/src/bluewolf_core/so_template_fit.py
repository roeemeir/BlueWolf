"""Vehicle-ID-independent fitting for normalized SO synchronization templates.

This layer deliberately accepts *semantic* SO phase rather than raw detector
phase. Raw per-stream V2 phase can have a different zero point for each detected
route; callers must normalize it into the Route Instance coordinate system
before invoking this module.

The fitter never generates templates. It only assigns members to the legal slots
of one already-selected SOTemplate and estimates one free common phase offset.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .geometry import circular_phase_distance
from .so_templates import SORouteInstance, SOTemplate, SOVehicleSlot


class NoLegalSOTemplateAssignment(ValueError):
    """Observed SO members cannot occupy the selected template's legal slots."""


@dataclass(frozen=True, slots=True)
class SOObservedMember:
    """One live group member expressed in a normalized SO semantic phase frame."""

    member_id: str
    vehicle_type: str
    route_instance_id: str
    semantic_phase: float

    def __post_init__(self) -> None:
        if not self.member_id:
            raise ValueError("member_id is required")
        if not self.vehicle_type:
            raise ValueError("vehicle_type is required")
        if not self.route_instance_id:
            raise ValueError("route_instance_id is required")
        if not math.isfinite(self.semantic_phase):
            raise ValueError("semantic_phase must be finite")
        object.__setattr__(self, "semantic_phase", self.semantic_phase % 1.0)


@dataclass(frozen=True, slots=True)
class SOMemberTemplateFit:
    member_id: str
    route_instance_id: str
    slot_id: str
    expected_phase: float
    position_error_cycle: float

    @property
    def position_error_deg(self) -> float:
        return self.position_error_cycle * 360.0


@dataclass(frozen=True, slots=True)
class SOTemplateFit:
    template_id: str
    common_phase: float
    mean_position_error_cycle: float
    maximum_position_error_cycle: float
    members: tuple[SOMemberTemplateFit, ...]


def _signed_cycle_delta(value: float, reference: float) -> float:
    return ((value - reference + 0.5) % 1.0) - 0.5


def _circular_l1_center(values: tuple[float, ...]) -> float:
    """Exact circular L1 center with deterministic tie-breaking."""

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
            candidates.add(
                ((unwrapped[count // 2 - 1] + unwrapped[count // 2]) / 2.0) % 1.0
            )

    return min(
        candidates,
        key=lambda candidate: (
            sum(circular_phase_distance(value, candidate) for value in values),
            max(circular_phase_distance(value, candidate) for value in values),
            candidate,
        ),
    )


def _slot_rows(template: SOTemplate) -> tuple[tuple[SORouteInstance, SOVehicleSlot], ...]:
    return tuple(
        (route, slot)
        for route in template.route_instances
        for slot in route.vehicle_slots
    )


def _legal(
    member: SOObservedMember,
    route: SORouteInstance,
    slot: SOVehicleSlot,
) -> bool:
    return (
        member.route_instance_id == route.route_instance_id
        and member.vehicle_type == slot.vehicle_type
    )


def _assignments(
    members: tuple[SOObservedMember, ...],
    rows: tuple[tuple[SORouteInstance, SOVehicleSlot], ...],
) -> tuple[tuple[tuple[SORouteInstance, SOVehicleSlot], ...], ...]:
    """Enumerate only legal assignments inside one selected, bounded template.

    Route Instance membership is a hard structural constraint. This keeps the
    search local: Single contributes at most 2 slots and Double at most 4.
    """

    output: list[tuple[tuple[SORouteInstance, SOVehicleSlot], ...]] = []

    def visit(
        index: int,
        remaining: tuple[tuple[SORouteInstance, SOVehicleSlot], ...],
        chosen: list[tuple[SORouteInstance, SOVehicleSlot]],
    ) -> None:
        if index == len(members):
            output.append(tuple(chosen))
            return

        member = members[index]
        for row_index, (route, slot) in enumerate(remaining):
            if not _legal(member, route, slot):
                continue
            chosen.append((route, slot))
            visit(
                index + 1,
                remaining[:row_index] + remaining[row_index + 1 :],
                chosen,
            )
            chosen.pop()

    visit(0, rows, [])
    return tuple(output)


def fit_so_template(
    template: SOTemplate,
    members: tuple[SOObservedMember, ...],
) -> SOTemplateFit:
    """Fit members to Route Instance quarters with one free common phase.

    Vehicle identifiers never constrain legality. Legal occupancy uses only
    Route Instance and vehicle type. Once a legal slot mapping is proposed, each
    quarter is a target phase offset (Q0=0, Q1=.25, Q2=.5, Q3=.75); a free common
    phase absorbs the group's instantaneous progress around the formation.
    """

    rows = _slot_rows(template)
    if len(members) != len(rows):
        raise NoLegalSOTemplateAssignment("member count does not match template slots")

    member_ids = [member.member_id for member in members]
    if len(member_ids) != len(set(member_ids)):
        raise ValueError("member_id values must be unique")

    ordered_members = tuple(
        sorted(members, key=lambda item: (item.route_instance_id, item.member_id))
    )
    assignments = _assignments(ordered_members, rows)
    if not assignments:
        raise NoLegalSOTemplateAssignment(
            "vehicle types or Route Instance membership do not match template"
        )

    best_key: tuple[float, float, tuple[str, ...], float] | None = None
    best_result: SOTemplateFit | None = None

    for assignment in assignments:
        normalized = tuple(
            (member.semantic_phase - slot.quarter.phase) % 1.0
            for member, (_, slot) in zip(ordered_members, assignment, strict=True)
        )
        common = _circular_l1_center(normalized)
        member_fits = tuple(
            SOMemberTemplateFit(
                member_id=member.member_id,
                route_instance_id=route.route_instance_id,
                slot_id=slot.slot_id,
                expected_phase=(common + slot.quarter.phase) % 1.0,
                position_error_cycle=circular_phase_distance(value, common),
            )
            for member, (route, slot), value in zip(
                ordered_members,
                assignment,
                normalized,
                strict=True,
            )
        )
        mean_error = sum(item.position_error_cycle for item in member_fits) / len(member_fits)
        maximum_error = max(item.position_error_cycle for item in member_fits)
        key = (
            round(mean_error, 15),
            round(maximum_error, 15),
            tuple(item.slot_id for item in member_fits),
            common,
        )
        if best_key is None or key < best_key:
            best_key = key
            best_result = SOTemplateFit(
                template_id=template.template_id,
                common_phase=common,
                mean_position_error_cycle=mean_error,
                maximum_position_error_cycle=maximum_error,
                members=member_fits,
            )

    if best_result is None:
        raise AssertionError("unreachable")
    return best_result
