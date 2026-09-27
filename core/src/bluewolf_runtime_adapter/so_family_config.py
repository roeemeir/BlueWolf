"""SO-only operational template/binding configuration.

Keeping SO parsing here lets the neutral runtime factory compose SI and SO as
peers. Shared ingest/deployment helpers live in ``runtime_config_common`` and no
SI code depends on this module.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from bluewolf_core.so_template_bank import (
    SOConstellationRoute,
    SOConstellationSignature,
    SOTemplateBank,
    SOTemplateBankEntry,
)
from bluewolf_core.so_templates import (
    Quarter,
    SORouteInstance,
    SORouteKind,
    SOTemplate,
    SOVehicleSlot,
)

from .producer import SOOperationalGroupBinding, SOOperationalMemberBinding
from .runtime_config_common import _integer, _list, _number, _object, _optional_text, _text


def _parse_template(raw: object, index: int) -> SOTemplateBankEntry:
    value = _object(raw, f"templates[{index}]")
    template_id = _text(value.get("id"), f"templates[{index}].id")
    name = _text(value.get("name"), f"templates[{index}].name")
    route_instances: list[SORouteInstance] = []
    for route_index, raw_route in enumerate(_list(value.get("routes"), f"templates[{index}].routes")):
        route = _object(raw_route, f"templates[{index}].routes[{route_index}]")
        route_id = _text(route.get("id"), f"templates[{index}].routes[{route_index}].id")
        try:
            route_kind = SORouteKind(_text(route.get("kind"), f"templates[{index}].routes[{route_index}].kind"))
        except ValueError as exc:
            raise ValueError(f"templates[{index}].routes[{route_index}].kind is invalid") from exc
        slots: list[SOVehicleSlot] = []
        for slot_index, raw_slot in enumerate(_list(route.get("slots"), f"templates[{index}].routes[{route_index}].slots")):
            slot = _object(raw_slot, f"templates[{index}].routes[{route_index}].slots[{slot_index}]")
            try:
                quarter = Quarter(_text(slot.get("quarter"), f"templates[{index}].routes[{route_index}].slots[{slot_index}].quarter"))
            except ValueError as exc:
                raise ValueError("template slot quarter must be Q0, Q1, Q2 or Q3") from exc
            slots.append(
                SOVehicleSlot(
                    slot_id=_text(slot.get("id"), "template slot id"),
                    vehicle_type=_text(slot.get("vehicleType"), "template slot vehicleType"),
                    quarter=quarter,
                )
            )
        route_instances.append(
            SORouteInstance(
                route_instance_id=route_id,
                route_kind=route_kind,
                vehicle_slots=tuple(slots),
                geometry_profile_ref=_optional_text(route.get("geometryProfileRef"), "template geometryProfileRef"),
            )
        )
    return SOTemplateBankEntry(
        SOTemplate(template_id, name, tuple(route_instances)),
        is_default=bool(value.get("default", False)),
    )


def template_bank(config: Mapping[str, Any]) -> SOTemplateBank:
    raw_templates = _list(config.get("templates"), "templates")
    if not raw_templates:
        raise ValueError("templates cannot be empty")
    return SOTemplateBank(tuple(_parse_template(raw, index) for index, raw in enumerate(raw_templates)))


def _binding_from_config(raw: object, index: int) -> tuple[frozenset[int], Callable[[str], SOOperationalGroupBinding]]:
    value = _object(raw, f"server.groups[{index}]")
    arena = _text(value.get("arena"), f"server.groups[{index}].arena")
    color = _text(value.get("color"), f"server.groups[{index}].color")
    name = _optional_text(value.get("name"), f"server.groups[{index}].name")
    subtitle = _text(value.get("subtitle", "Python Core · SO"), f"server.groups[{index}].subtitle")

    route_kinds: dict[str, SORouteKind] = {}
    route_order: list[str] = []
    for route_index, raw_route in enumerate(_list(value.get("routeInstances"), f"server.groups[{index}].routeInstances")):
        route = _object(raw_route, f"server.groups[{index}].routeInstances[{route_index}]")
        route_id = _text(route.get("id"), "binding route instance id")
        if route_id in route_kinds:
            raise ValueError("binding route instance ids must be unique")
        try:
            route_kinds[route_id] = SORouteKind(_text(route.get("kind"), "binding route kind"))
        except ValueError as exc:
            raise ValueError("binding route kind must be single or double") from exc
        route_order.append(route_id)
    if not route_order:
        raise ValueError("binding routeInstances cannot be empty")

    members: list[SOOperationalMemberBinding] = []
    for member_index, raw_member in enumerate(_list(value.get("members"), f"server.groups[{index}].members")):
        member = _object(raw_member, f"server.groups[{index}].members[{member_index}]")
        route_instance_id = _text(member.get("routeInstanceId"), "binding member routeInstanceId")
        if route_instance_id not in route_kinds:
            raise ValueError("binding member references an unknown routeInstanceId")
        members.append(
            SOOperationalMemberBinding(
                vehicle_identifier=_integer(member.get("vehicleId"), "binding member vehicleId"),
                vehicle_type=_text(member.get("vehicleType"), "binding member vehicleType"),
                route_instance_id=route_instance_id,
                work_speed_mps=_number(member.get("workSpeedMps"), "binding member workSpeedMps", positive=True),
                member_id=_optional_text(member.get("memberId"), "binding member memberId"),
            )
        )
    if not members:
        raise ValueError("binding members cannot be empty")

    types_by_route: dict[str, list[str]] = {route_id: [] for route_id in route_order}
    for member in members:
        types_by_route[member.route_instance_id].append(member.vehicle_type)
    constellation_routes: list[SOConstellationRoute] = []
    for route_id in route_order:
        vehicle_types = tuple(types_by_route[route_id])
        if not vehicle_types:
            raise ValueError("every binding route instance must have at least one member")
        constellation_routes.append(SOConstellationRoute(route_kinds[route_id], vehicle_types))
    constellation = SOConstellationSignature(tuple(constellation_routes))
    member_tuple = tuple(members)
    vehicle_set = frozenset(member.vehicle_identifier for member in member_tuple)

    def build(group_id: str) -> SOOperationalGroupBinding:
        return SOOperationalGroupBinding(
            group_id=group_id,
            constellation=constellation,
            members=member_tuple,
            arena=arena,
            group_name=name,
            subtitle=subtitle,
            color=color,
        )

    return vehicle_set, build


def binding_resolver(server: Mapping[str, Any]):
    configured: dict[frozenset[int], Callable[[str], SOOperationalGroupBinding]] = {}
    for index, raw in enumerate(_list(server.get("groups"), "server.groups")):
        vehicle_set, builder = _binding_from_config(raw, index)
        if vehicle_set in configured:
            raise ValueError("server group bindings must have unique vehicle sets")
        configured[vehicle_set] = builder

    def resolve(group):
        vehicle_set = frozenset(key[1] for key in group.member_keys)
        builder = configured.get(vehicle_set)
        return None if builder is None else builder(group.group_id)

    return resolve


__all__ = ["binding_resolver", "template_bank"]
