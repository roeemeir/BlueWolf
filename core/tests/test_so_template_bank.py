from __future__ import annotations

import unittest

from bluewolf_core.so_template_bank import (
    InvalidSOTemplateBank,
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


def _route(
    route_id: str,
    kind: SORouteKind,
    slots: tuple[tuple[str, str, Quarter], ...],
) -> SORouteInstance:
    return SORouteInstance(
        route_id,
        kind,
        tuple(
            SOVehicleSlot(slot_id, vehicle_type, quarter)
            for slot_id, vehicle_type, quarter in slots
        ),
    )


def _template(
    template_id: str,
    routes: tuple[SORouteInstance, ...],
) -> SOTemplate:
    return SOTemplate(template_id, template_id, routes)


def _single_a_template(template_id: str, quarters=(Quarter.Q0, Quarter.Q2)) -> SOTemplate:
    return _template(
        template_id,
        (
            _route(
                f"{template_id}-r1",
                SORouteKind.SINGLE,
                (
                    (f"{template_id}-a", "A", quarters[0]),
                    (f"{template_id}-b", "A", quarters[1]),
                ),
            ),
        ),
    )


class SOTemplateBankTests(unittest.TestCase):
    def test_quarter_arrangements_share_one_relevant_constellation(self) -> None:
        opposite = _single_a_template("opposite", (Quarter.Q0, Quarter.Q2))
        mixed = _single_a_template("mixed", (Quarter.Q0, Quarter.Q1))
        bank = SOTemplateBank(
            (
                SOTemplateBankEntry(opposite, is_default=True),
                SOTemplateBankEntry(mixed),
            )
        )
        constellation = SOConstellationSignature.from_template(opposite)

        self.assertEqual(
            tuple(template.template_id for template in bank.relevant_templates(constellation)),
            ("opposite", "mixed"),
        )
        self.assertEqual(bank.default_template(constellation).template_id, "opposite")

    def test_vehicle_type_multiset_is_part_of_constellation(self) -> None:
        aa = _single_a_template("aa")
        ab = _template(
            "ab",
            (
                _route(
                    "r-ab",
                    SORouteKind.SINGLE,
                    (
                        ("a", "A", Quarter.Q0),
                        ("b", "B", Quarter.Q2),
                    ),
                ),
            ),
        )
        bank = SOTemplateBank((SOTemplateBankEntry(aa), SOTemplateBankEntry(ab)))

        relevant = bank.relevant_templates(SOConstellationSignature.from_template(aa))
        self.assertEqual(tuple(item.template_id for item in relevant), ("aa",))

    def test_vehicle_type_order_inside_route_instance_does_not_matter(self) -> None:
        first = _template(
            "first",
            (
                _route(
                    "r1",
                    SORouteKind.SINGLE,
                    (("a", "A", Quarter.Q0), ("b", "B", Quarter.Q2)),
                ),
            ),
        )
        second = _template(
            "second",
            (
                _route(
                    "r2",
                    SORouteKind.SINGLE,
                    (("b2", "B", Quarter.Q0), ("a2", "A", Quarter.Q2)),
                ),
            ),
        )
        self.assertEqual(
            SOConstellationSignature.from_template(first),
            SOConstellationSignature.from_template(second),
        )

    def test_route_kind_is_part_of_constellation(self) -> None:
        single = _single_a_template("single")
        double = _template(
            "double",
            (
                _route(
                    "double-r",
                    SORouteKind.DOUBLE,
                    (("a", "A", Quarter.Q0), ("b", "A", Quarter.Q2)),
                ),
            ),
        )
        bank = SOTemplateBank(
            (SOTemplateBankEntry(single), SOTemplateBankEntry(double))
        )

        self.assertEqual(
            tuple(
                item.template_id
                for item in bank.relevant_templates(
                    SOConstellationSignature.from_template(single)
                )
            ),
            ("single",),
        )

    def test_complete_chain_reversal_is_same_constellation(self) -> None:
        forward = _template(
            "forward",
            (
                _route(
                    "s",
                    SORouteKind.SINGLE,
                    (("s1", "A", Quarter.Q0), ("s2", "A", Quarter.Q2)),
                ),
                _route(
                    "d",
                    SORouteKind.DOUBLE,
                    (("d1", "B", Quarter.Q0), ("d2", "B", Quarter.Q2)),
                ),
            ),
        )
        reverse = _template(
            "reverse",
            tuple(reversed(forward.route_instances)),
        )
        bank = SOTemplateBank(
            (SOTemplateBankEntry(forward), SOTemplateBankEntry(reverse))
        )
        signature = SOConstellationSignature.from_template(forward)

        self.assertEqual(signature, SOConstellationSignature.from_template(reverse))
        self.assertEqual(
            {item.template_id for item in bank.relevant_templates(signature)},
            {"forward", "reverse"},
        )

    def test_default_is_scoped_to_constellation(self) -> None:
        aa = _single_a_template("aa")
        bb = _template(
            "bb",
            (
                _route(
                    "bb-r",
                    SORouteKind.SINGLE,
                    (("b1", "B", Quarter.Q0), ("b2", "B", Quarter.Q2)),
                ),
            ),
        )
        bank = SOTemplateBank(
            (
                SOTemplateBankEntry(aa, is_default=True),
                SOTemplateBankEntry(bb, is_default=True),
            )
        )

        self.assertEqual(
            bank.default_template(SOConstellationSignature.from_template(aa)).template_id,
            "aa",
        )
        self.assertEqual(
            bank.default_template(SOConstellationSignature.from_template(bb)).template_id,
            "bb",
        )

    def test_two_defaults_for_same_constellation_are_rejected(self) -> None:
        first = _single_a_template("first")
        second = _single_a_template("second", (Quarter.Q1, Quarter.Q3))
        with self.assertRaises(InvalidSOTemplateBank):
            SOTemplateBank(
                (
                    SOTemplateBankEntry(first, is_default=True),
                    SOTemplateBankEntry(second, is_default=True),
                )
            )

    def test_duplicate_template_ids_are_rejected(self) -> None:
        first = _single_a_template("same")
        second = _single_a_template("same", (Quarter.Q1, Quarter.Q3))
        with self.assertRaises(InvalidSOTemplateBank):
            SOTemplateBank((SOTemplateBankEntry(first), SOTemplateBankEntry(second)))

    def test_bank_can_intentionally_have_no_default(self) -> None:
        template = _single_a_template("manual")
        bank = SOTemplateBank((SOTemplateBankEntry(template),))
        signature = SOConstellationSignature.from_template(template)
        self.assertIsNone(bank.default_template(signature))
        self.assertTrue(bank.is_relevant(signature, "manual"))
        self.assertFalse(bank.is_relevant(signature, "missing"))

    def test_template_lookup_does_not_invent_selection_policy(self) -> None:
        template = _single_a_template("manual")
        bank = SOTemplateBank((SOTemplateBankEntry(template),))
        self.assertIs(bank.template_by_id("manual"), template)
        self.assertIsNone(bank.template_by_id("missing"))
        with self.assertRaises(ValueError):
            bank.template_by_id("")

    def test_signature_constructor_sorts_vehicle_multiset(self) -> None:
        first = SOConstellationSignature(
            (SOConstellationRoute(SORouteKind.DOUBLE, ("B", "A", "A")),)
        )
        second = SOConstellationSignature(
            (SOConstellationRoute(SORouteKind.DOUBLE, ("A", "B", "A")),)
        )
        self.assertEqual(first, second)
        self.assertEqual(first.routes[0].vehicle_types, ("A", "A", "B"))


if __name__ == "__main__":
    unittest.main()
