from __future__ import annotations

import unittest

from bluewolf_core.models import RouteSubtype
from bluewolf_core.so_templates import (
    Quarter,
    QuarterRelation,
    SORouteInstance,
    SORouteKind,
    SOTemplate,
    SOVehicleSlot,
    UndefinedSOGeometryError,
    quarter_relation,
    synchronization_route_kind,
    template_relations,
)


def _slot(slot_id: str, quarter: Quarter, vehicle_type: str = "A") -> SOVehicleSlot:
    return SOVehicleSlot(slot_id, vehicle_type, quarter)


class NormalizedSOTemplateTests(unittest.TestCase):
    def test_quarter_relation_is_derived_exactly_from_difference(self) -> None:
        self.assertIs(quarter_relation(Quarter.Q0, Quarter.Q0), QuarterRelation.SAME)
        self.assertIs(quarter_relation(Quarter.Q0, Quarter.Q2), QuarterRelation.OPPOSITE)
        self.assertIs(quarter_relation(Quarter.Q0, Quarter.Q1), QuarterRelation.MIXED)
        self.assertIs(quarter_relation(Quarter.Q0, Quarter.Q3), QuarterRelation.MIXED)
        self.assertIs(quarter_relation(Quarter.Q3, Quarter.Q1), QuarterRelation.OPPOSITE)

    def test_quarter_phase_is_normalized_cycle_position(self) -> None:
        self.assertEqual(
            [quarter.phase for quarter in Quarter],
            [0.0, 0.25, 0.5, 0.75],
        )

    def test_single_route_allows_at_most_two_vehicle_slots(self) -> None:
        SORouteInstance(
            "r1",
            SORouteKind.SINGLE,
            (_slot("a", Quarter.Q0), _slot("b", Quarter.Q2)),
        )
        with self.assertRaises(ValueError):
            SORouteInstance(
                "r1",
                SORouteKind.SINGLE,
                (
                    _slot("a", Quarter.Q0),
                    _slot("b", Quarter.Q1),
                    _slot("c", Quarter.Q2),
                ),
            )

    def test_double_route_allows_at_most_four_vehicle_slots(self) -> None:
        SORouteInstance(
            "r1",
            SORouteKind.DOUBLE,
            tuple(_slot(f"s{index}", quarter) for index, quarter in enumerate(Quarter)),
        )
        with self.assertRaises(ValueError):
            SORouteInstance(
                "r1",
                SORouteKind.DOUBLE,
                tuple(
                    _slot(f"s{index}", Quarter.Q0)
                    for index in range(5)
                ),
            )

    def test_route_instance_tuple_is_the_template_chain_order(self) -> None:
        first = SORouteInstance(
            "route-1",
            SORouteKind.SINGLE,
            (_slot("a", Quarter.Q0),),
            geometry_profile_ref="profile-A",
        )
        second = SORouteInstance(
            "route-2",
            SORouteKind.DOUBLE,
            (_slot("b", Quarter.Q2),),
            geometry_profile_ref="profile-B",
        )
        template = SOTemplate("t1", "chain", (first, second))
        self.assertEqual(
            tuple(route.route_instance_id for route in template.route_instances),
            ("route-1", "route-2"),
        )
        self.assertEqual(template.slot_to_route["a"], "route-1")
        self.assertEqual(template.slot_to_route["b"], "route-2")

    def test_relation_across_route_instances_is_not_stored_separately(self) -> None:
        template = SOTemplate(
            "t1",
            "two-route-chain",
            (
                SORouteInstance(
                    "r1",
                    SORouteKind.SINGLE,
                    (_slot("a", Quarter.Q1),),
                ),
                SORouteInstance(
                    "r2",
                    SORouteKind.SINGLE,
                    (_slot("b", Quarter.Q3),),
                ),
            ),
        )
        relations = template_relations(template)
        self.assertEqual(len(relations), 1)
        self.assertIs(relations[0].relation, QuarterRelation.OPPOSITE)
        self.assertEqual(relations[0].quarter_difference, 2)

    def test_geometry_profile_reference_does_not_change_quarter_law(self) -> None:
        first = SOTemplate(
            "t1",
            "first",
            (
                SORouteInstance(
                    "r1",
                    SORouteKind.SINGLE,
                    (_slot("a", Quarter.Q0), _slot("b", Quarter.Q1)),
                    geometry_profile_ref="small-A",
                ),
            ),
        )
        second = SOTemplate(
            "t2",
            "second",
            (
                SORouteInstance(
                    "r2",
                    SORouteKind.SINGLE,
                    (_slot("a2", Quarter.Q0), _slot("b2", Quarter.Q1)),
                    geometry_profile_ref="large-B",
                ),
            ),
        )
        self.assertIs(
            template_relations(first)[0].relation,
            template_relations(second)[0].relation,
        )

    def test_slot_ids_are_unique_across_route_instances(self) -> None:
        with self.assertRaises(ValueError):
            SOTemplate(
                "t1",
                "duplicate-slot",
                (
                    SORouteInstance(
                        "r1",
                        SORouteKind.SINGLE,
                        (_slot("same", Quarter.Q0),),
                    ),
                    SORouteInstance(
                        "r2",
                        SORouteKind.SINGLE,
                        (_slot("same", Quarter.Q2),),
                    ),
                ),
            )

    def test_figure_eight_normalizes_to_single_so_semantics(self) -> None:
        self.assertIs(
            synchronization_route_kind(RouteSubtype.HIPPODROME),
            SORouteKind.SINGLE,
        )
        self.assertIs(
            synchronization_route_kind(RouteSubtype.FIGURE_EIGHT),
            SORouteKind.SINGLE,
        )
        self.assertIs(
            synchronization_route_kind(RouteSubtype.DOUBLE_HIPPODROME),
            SORouteKind.DOUBLE,
        )

    def test_double_figure_eight_is_explicitly_undefined(self) -> None:
        with self.assertRaises(UndefinedSOGeometryError):
            synchronization_route_kind(RouteSubtype.DOUBLE_FIGURE_EIGHT)

    def test_non_so_subtype_is_not_silently_mapped(self) -> None:
        for subtype in (RouteSubtype.COMPACT, RouteSubtype.UNKNOWN):
            with self.subTest(subtype=subtype):
                with self.assertRaises(ValueError):
                    synchronization_route_kind(subtype)


if __name__ == "__main__":
    unittest.main()
