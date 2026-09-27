"""Relevant-template bank for normalized SO synchronization constellations.

The bank indexes developer-approved ``SOTemplate`` objects only by structural
composition: ordered RouteKind plus the multiset of vehicle types occupying each
Route Instance.  Vehicle identifiers, geometry dimensions, quarter placement
and live synchronization score are deliberately excluded from the key.

A complete chain and the same chain written in reverse order are one
constellation.  This removes the route-order symmetry explicitly prohibited by
the product spec while preserving the different quarter arrangements as
separate legal templates inside that constellation.
"""
from __future__ import annotations

from dataclasses import dataclass

from .so_templates import SORouteKind, SOTemplate


class InvalidSOTemplateBank(ValueError):
    """Developer template-bank configuration is internally inconsistent."""


@dataclass(frozen=True, slots=True)
class SOConstellationRoute:
    route_kind: SORouteKind
    vehicle_types: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.vehicle_types:
            raise ValueError("constellation route requires at least one vehicle type")
        if any(not value for value in self.vehicle_types):
            raise ValueError("vehicle types must be non-empty")
        object.__setattr__(self, "vehicle_types", tuple(sorted(self.vehicle_types)))

    @property
    def key(self) -> tuple[str, tuple[str, ...]]:
        return self.route_kind.value, self.vehicle_types


@dataclass(frozen=True, slots=True)
class SOConstellationSignature:
    """Vehicle-ID-independent SO composition used to filter the template bank."""

    routes: tuple[SOConstellationRoute, ...]

    def __post_init__(self) -> None:
        if not self.routes:
            raise ValueError("SO constellation requires at least one Route Instance")
        forward = tuple(route.key for route in self.routes)
        reverse = tuple(route.key for route in reversed(self.routes))
        if reverse < forward:
            object.__setattr__(self, "routes", tuple(reversed(self.routes)))

    @property
    def key(self) -> tuple[tuple[str, tuple[str, ...]], ...]:
        return tuple(route.key for route in self.routes)

    @classmethod
    def from_template(cls, template: SOTemplate) -> "SOConstellationSignature":
        return cls(
            tuple(
                SOConstellationRoute(
                    route_kind=route.route_kind,
                    vehicle_types=tuple(slot.vehicle_type for slot in route.vehicle_slots),
                )
                for route in template.route_instances
            )
        )


@dataclass(frozen=True, slots=True)
class SOTemplateBankEntry:
    template: SOTemplate
    is_default: bool = False

    @property
    def constellation(self) -> SOConstellationSignature:
        return SOConstellationSignature.from_template(self.template)


@dataclass(frozen=True, slots=True)
class SOTemplateBank:
    """Immutable developer-approved SO template bank.

    At most one template may be the default for a given constellation.  A bank
    may intentionally have no default for a constellation; the operator/product
    layer can then require an explicit choice instead of silently inventing one.
    """

    entries: tuple[SOTemplateBankEntry, ...]

    def __post_init__(self) -> None:
        if not self.entries:
            raise InvalidSOTemplateBank("SO template bank cannot be empty")

        template_ids = [entry.template.template_id for entry in self.entries]
        if len(template_ids) != len(set(template_ids)):
            raise InvalidSOTemplateBank("template_id values must be unique in the bank")

        default_by_constellation: dict[
            tuple[tuple[str, tuple[str, ...]], ...], str
        ] = {}
        for entry in self.entries:
            if not entry.is_default:
                continue
            signature = entry.constellation.key
            previous = default_by_constellation.get(signature)
            if previous is not None:
                raise InvalidSOTemplateBank(
                    "only one default SO template is allowed per constellation: "
                    f"{previous!r} and {entry.template.template_id!r}"
                )
            default_by_constellation[signature] = entry.template.template_id

    def relevant_entries(
        self,
        constellation: SOConstellationSignature,
    ) -> tuple[SOTemplateBankEntry, ...]:
        """Return only templates whose RouteKind/type composition matches exactly."""

        return tuple(
            entry
            for entry in self.entries
            if entry.constellation.key == constellation.key
        )

    def relevant_templates(
        self,
        constellation: SOConstellationSignature,
    ) -> tuple[SOTemplate, ...]:
        return tuple(
            entry.template
            for entry in self.relevant_entries(constellation)
        )

    def default_template(
        self,
        constellation: SOConstellationSignature,
    ) -> SOTemplate | None:
        defaults = tuple(
            entry.template
            for entry in self.relevant_entries(constellation)
            if entry.is_default
        )
        if len(defaults) > 1:
            raise AssertionError("bank validation failed to enforce one default")
        return defaults[0] if defaults else None

    def template_by_id(self, template_id: str) -> SOTemplate | None:
        if not template_id:
            raise ValueError("template_id is required")
        for entry in self.entries:
            if entry.template.template_id == template_id:
                return entry.template
        return None

    def is_relevant(
        self,
        constellation: SOConstellationSignature,
        template_id: str,
    ) -> bool:
        if not template_id:
            return False
        return any(
            entry.template.template_id == template_id
            for entry in self.relevant_entries(constellation)
        )
