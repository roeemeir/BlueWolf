"""Normalized SO synchronization-template data model.

Conformance source: core/docs/ROUTE_GEOMETRY_SPEC_HE.md, section 8.

This module models synchronization semantics only. It deliberately does not
encode hippodrome size, opening angle, vehicle geometry dimensions or detector
thresholds. Those belong to route geometry / vehicle geometry profiles.

Approved hierarchy:
    SO Template -> Route Instances -> Vehicle Slots -> Quarter

Quarter relations are derived, never stored twice:
    diff 0 -> Same
    diff 2 -> Opposite
    diff 1/3 -> Mixed

Figure-8 uses Single-SO synchronization semantics. DOUBLE_FIGURE_EIGHT remains
undefined and must not be inferred or implemented here.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Mapping

from .models import RouteSubtype


class UndefinedSOGeometryError(ValueError):
    """Raised when synchronization code is asked to assume undefined geometry."""


class SORouteKind(StrEnum):
    SINGLE = "single"
    DOUBLE = "double"


class Quarter(StrEnum):
    Q0 = "Q0"
    Q1 = "Q1"
    Q2 = "Q2"
    Q3 = "Q3"

    @property
    def index(self) -> int:
        return {
            Quarter.Q0: 0,
            Quarter.Q1: 1,
            Quarter.Q2: 2,
            Quarter.Q3: 3,
        }[self]

    @property
    def phase(self) -> float:
        return self.index / 4.0


class QuarterRelation(StrEnum):
    SAME = "same"
    OPPOSITE = "opposite"
    MIXED = "mixed"


@dataclass(frozen=True, slots=True)
class SOVehicleSlot:
    slot_id: str
    vehicle_type: str
    quarter: Quarter

    def __post_init__(self) -> None:
        if not self.slot_id:
            raise ValueError("slot_id is required")
        if not self.vehicle_type:
            raise ValueError("vehicle_type is required")


@dataclass(frozen=True, slots=True)
class SORouteInstance:
    """One ordered route instance inside an SO synchronization template.

    `geometry_profile_ref` is an external reference only. It does not change the
    quarter law or create a different synchronization rule by itself.
    """

    route_instance_id: str
    route_kind: SORouteKind
    vehicle_slots: tuple[SOVehicleSlot, ...]
    geometry_profile_ref: str | None = None

    def __post_init__(self) -> None:
        if not self.route_instance_id:
            raise ValueError("route_instance_id is required")
        if not self.vehicle_slots:
            raise ValueError("a route instance requires at least one vehicle slot")
        maximum = 2 if self.route_kind is SORouteKind.SINGLE else 4
        if len(self.vehicle_slots) > maximum:
            raise ValueError(
                f"{self.route_kind.value} route supports at most {maximum} vehicle slots"
            )
        slot_ids = [slot.slot_id for slot in self.vehicle_slots]
        if len(slot_ids) != len(set(slot_ids)):
            raise ValueError("slot_id values must be unique inside a route instance")
        if self.geometry_profile_ref == "":
            raise ValueError("geometry_profile_ref must be non-empty when supplied")


@dataclass(frozen=True, slots=True)
class SOTemplate:
    template_id: str
    name: str
    route_instances: tuple[SORouteInstance, ...]

    def __post_init__(self) -> None:
        if not self.template_id:
            raise ValueError("template_id is required")
        if not self.name:
            raise ValueError("template name is required")
        if not self.route_instances:
            raise ValueError("an SO template requires at least one route instance")

        route_ids = [route.route_instance_id for route in self.route_instances]
        if len(route_ids) != len(set(route_ids)):
            raise ValueError("route_instance_id values must be unique inside a template")

        slots = [slot for route in self.route_instances for slot in route.vehicle_slots]
        if len(slots) < 2:
            raise ValueError("a synchronization template requires at least two slots")
        slot_ids = [slot.slot_id for slot in slots]
        if len(slot_ids) != len(set(slot_ids)):
            raise ValueError("slot_id values must be unique across the SO template")

    @property
    def slots(self) -> tuple[SOVehicleSlot, ...]:
        return tuple(
            slot
            for route in self.route_instances
            for slot in route.vehicle_slots
        )

    @property
    def slot_to_route(self) -> Mapping[str, str]:
        return MappingProxyType(
            {
                slot.slot_id: route.route_instance_id
                for route in self.route_instances
                for slot in route.vehicle_slots
            }
        )


@dataclass(frozen=True, slots=True)
class SOSlotRelation:
    first_slot_id: str
    second_slot_id: str
    relation: QuarterRelation
    quarter_difference: int

    def __post_init__(self) -> None:
        if self.first_slot_id == self.second_slot_id:
            raise ValueError("slot relation requires two distinct slots")
        if self.quarter_difference not in (0, 1, 2, 3):
            raise ValueError("quarter_difference must be in 0..3")


def quarter_relation(first: Quarter, second: Quarter) -> QuarterRelation:
    difference = (second.index - first.index) % 4
    if difference == 0:
        return QuarterRelation.SAME
    if difference == 2:
        return QuarterRelation.OPPOSITE
    return QuarterRelation.MIXED


def slot_relation(first: SOVehicleSlot, second: SOVehicleSlot) -> SOSlotRelation:
    if first.slot_id == second.slot_id:
        raise ValueError("slot relation requires two distinct slots")
    difference = (second.quarter.index - first.quarter.index) % 4
    return SOSlotRelation(
        first_slot_id=first.slot_id,
        second_slot_id=second.slot_id,
        relation=quarter_relation(first.quarter, second.quarter),
        quarter_difference=difference,
    )


def template_relations(template: SOTemplate) -> tuple[SOSlotRelation, ...]:
    """Derive all pair relations once from quarter placement.

    Relations may span Route Instances. This is what lets a Route1→Route2 chain
    expose Same/Opposite/Mixed without storing a second, potentially
    contradictory relation field.
    """

    slots = template.slots
    return tuple(
        slot_relation(first, second)
        for index, first in enumerate(slots)
        for second in slots[index + 1 :]
    )


def synchronization_route_kind(subtype: RouteSubtype) -> SORouteKind:
    """Map detected SO display/topology subtype to approved sync semantics."""

    if subtype in (RouteSubtype.HIPPODROME, RouteSubtype.FIGURE_EIGHT):
        return SORouteKind.SINGLE
    if subtype is RouteSubtype.DOUBLE_HIPPODROME:
        return SORouteKind.DOUBLE
    if subtype is RouteSubtype.DOUBLE_FIGURE_EIGHT:
        raise UndefinedSOGeometryError(
            "DOUBLE_FIGURE_EIGHT geometry is undefined by the approved specification"
        )
    raise ValueError(f"route subtype {subtype.value!r} has no SO synchronization semantics")
