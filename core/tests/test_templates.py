from __future__ import annotations

import unittest

from bluewolf_core import (
    NoLegalTemplateAssignment,
    ObservedMember,
    RouteFamily,
    SynchronizationTemplate,
    TemplateSlot,
    fit_template,
)


class TemplateMatchingTests(unittest.TestCase):
    def test_si_common_rotation_is_free_and_outlier_is_attributed(self) -> None:
        template = SynchronizationTemplate(
            "si-120",
            "שלוש טבעות 120°",
            RouteFamily.SI,
            (
                TemplateSlot("inner", "A", 0 / 360, route_role="inner"),
                TemplateSlot("middle", "B", 120 / 360, route_role="middle"),
                TemplateSlot("outer", "C", 240 / 360, route_role="outer"),
            ),
        )
        fit = fit_template(
            template,
            (
                ObservedMember("vehicle-1", "A", 30 / 360, "inner"),
                ObservedMember("vehicle-2", "B", 151 / 360, "middle"),
                ObservedMember("vehicle-3", "C", 310 / 360, "outer"),
            ),
        )
        errors = {member.member_id: member.position_error_deg for member in fit.members}
        self.assertAlmostEqual(fit.common_phase * 360, 31)
        self.assertAlmostEqual(errors["vehicle-1"], 1)
        self.assertAlmostEqual(errors["vehicle-2"], 0)
        self.assertAlmostEqual(errors["vehicle-3"], 39)

    def test_two_vehicle_error_is_split_evenly(self) -> None:
        template = SynchronizationTemplate(
            "pair",
            "pair",
            RouteFamily.SI,
            (TemplateSlot("one", "A", 0), TemplateSlot("two", "B", 0)),
        )
        fit = fit_template(
            template,
            (ObservedMember("one", "A", 0), ObservedMember("two", "B", 0.10)),
        )
        self.assertAlmostEqual(fit.common_phase, 0.05)
        self.assertTrue(
            all(abs(member.position_error_cycle - 0.05) < 1e-12 for member in fit.members)
        )

    def test_vehicle_ids_are_not_bound_to_same_type_slots(self) -> None:
        template = SynchronizationTemplate(
            "same-type",
            "same type",
            RouteFamily.SI,
            (
                TemplateSlot("zero", "סער", 0),
                TemplateSlot("quarter", "סער", 0.25),
            ),
        )
        fit = fit_template(
            template,
            (
                ObservedMember("vehicle-17", "סער", 0.25),
                ObservedMember("vehicle-11", "סער", 0.0),
            ),
        )
        slots = {member.member_id: member.slot_id for member in fit.members}
        self.assertEqual(slots, {"vehicle-11": "zero", "vehicle-17": "quarter"})
        self.assertEqual(fit.maximum_position_error_cycle, 0)

    def test_so_opposite_relation_uses_phase_sign(self) -> None:
        template = SynchronizationTemplate(
            "so-opposite",
            "הפוך",
            RouteFamily.SO,
            (
                TemplateSlot("left", "סער", 0, phase_sign=1),
                TemplateSlot("right", "ברק", 0, phase_sign=-1),
            ),
        )
        fit = fit_template(
            template,
            (
                ObservedMember("storm", "סער", 0.2),
                ObservedMember("lightning", "ברק", 0.8),
            ),
        )
        self.assertAlmostEqual(fit.maximum_position_error_cycle, 0)
        self.assertAlmostEqual(fit.common_phase, 0.2)

    def test_route_roles_are_hard_constraints(self) -> None:
        template = SynchronizationTemplate(
            "roles",
            "roles",
            RouteFamily.SI,
            (
                TemplateSlot("inner", "A", 0, route_role="inner"),
                TemplateSlot("outer", "B", 0.5, route_role="outer"),
            ),
        )
        with self.assertRaises(NoLegalTemplateAssignment):
            fit_template(
                template,
                (
                    ObservedMember("a", "A", 0, "outer"),
                    ObservedMember("b", "B", 0.5, "inner"),
                ),
            )

    def test_member_count_must_match(self) -> None:
        template = SynchronizationTemplate(
            "pair",
            "pair",
            RouteFamily.SI,
            (TemplateSlot("one", "A", 0), TemplateSlot("two", "B", 0)),
        )
        with self.assertRaises(NoLegalTemplateAssignment):
            fit_template(template, (ObservedMember("one", "A", 0),))


if __name__ == "__main__":
    unittest.main()
