from __future__ import annotations

import unittest

from bluewolf_core.so_template_fit import (
    NoLegalSOTemplateAssignment,
    SOObservedMember,
    fit_so_template,
)
from bluewolf_core.so_templates import Quarter, SORouteInstance, SORouteKind, SOTemplate, SOVehicleSlot


def _slot(slot_id: str, vehicle_type: str, quarter: Quarter) -> SOVehicleSlot:
    return SOVehicleSlot(slot_id, vehicle_type, quarter)


def _single_template() -> SOTemplate:
    return SOTemplate(
        "so-single",
        "single",
        (
            SORouteInstance(
                "r1",
                SORouteKind.SINGLE,
                (
                    _slot("front", "A", Quarter.Q0),
                    _slot("back", "A", Quarter.Q2),
                ),
            ),
        ),
    )


class NormalizedSOTemplateFitTests(unittest.TestCase):
    def test_exact_quarters_fit_with_free_common_phase(self) -> None:
        result = fit_so_template(
            _single_template(),
            (
                SOObservedMember("v1", "A", "r1", 0.10),
                SOObservedMember("v2", "A", "r1", 0.60),
            ),
        )

        self.assertAlmostEqual(result.common_phase, 0.10)
        self.assertAlmostEqual(result.mean_position_error_cycle, 0.0)
        self.assertAlmostEqual(result.maximum_position_error_cycle, 0.0)
        self.assertEqual(
            {item.member_id: item.slot_id for item in result.members},
            {"v1": "front", "v2": "back"},
        )

    def test_global_phase_shift_changes_common_phase_not_error(self) -> None:
        template = _single_template()
        first = fit_so_template(
            template,
            (
                SOObservedMember("v1", "A", "r1", 0.10),
                SOObservedMember("v2", "A", "r1", 0.60),
            ),
        )
        shifted = fit_so_template(
            template,
            (
                SOObservedMember("v1", "A", "r1", 0.37),
                SOObservedMember("v2", "A", "r1", 0.87),
            ),
        )

        self.assertAlmostEqual(first.mean_position_error_cycle, shifted.mean_position_error_cycle)
        self.assertAlmostEqual(first.maximum_position_error_cycle, shifted.maximum_position_error_cycle)
        self.assertAlmostEqual(shifted.common_phase, 0.37)

    def test_assignment_uses_phase_not_vehicle_identifier_order(self) -> None:
        result = fit_so_template(
            _single_template(),
            (
                SOObservedMember("aaa", "A", "r1", 0.50),
                SOObservedMember("zzz", "A", "r1", 0.00),
            ),
        )

        self.assertEqual(
            {item.member_id: item.slot_id for item in result.members},
            {"aaa": "back", "zzz": "front"},
        )
        self.assertAlmostEqual(result.maximum_position_error_cycle, 0.0)

    def test_route_instance_is_a_hard_structural_constraint(self) -> None:
        template = SOTemplate(
            "chain",
            "chain",
            (
                SORouteInstance(
                    "r1",
                    SORouteKind.SINGLE,
                    (_slot("r1-q0", "A", Quarter.Q0),),
                ),
                SORouteInstance(
                    "r2",
                    SORouteKind.SINGLE,
                    (_slot("r2-q2", "A", Quarter.Q2),),
                ),
            ),
        )
        result = fit_so_template(
            template,
            (
                SOObservedMember("v1", "A", "r1", 0.20),
                SOObservedMember("v2", "A", "r2", 0.70),
            ),
        )

        self.assertEqual(
            {item.member_id: item.slot_id for item in result.members},
            {"v1": "r1-q0", "v2": "r2-q2"},
        )
        self.assertAlmostEqual(result.maximum_position_error_cycle, 0.0)

    def test_vehicle_type_is_a_hard_constraint(self) -> None:
        template = SOTemplate(
            "typed",
            "typed",
            (
                SORouteInstance(
                    "r1",
                    SORouteKind.SINGLE,
                    (
                        _slot("a", "A", Quarter.Q0),
                        _slot("b", "B", Quarter.Q2),
                    ),
                ),
            ),
        )
        result = fit_so_template(
            template,
            (
                SOObservedMember("vehicle-b", "B", "r1", 0.50),
                SOObservedMember("vehicle-a", "A", "r1", 0.00),
            ),
        )
        self.assertEqual(
            {item.member_id: item.slot_id for item in result.members},
            {"vehicle-a": "a", "vehicle-b": "b"},
        )

    def test_wrong_vehicle_composition_has_no_legal_assignment(self) -> None:
        template = SOTemplate(
            "typed",
            "typed",
            (
                SORouteInstance(
                    "r1",
                    SORouteKind.SINGLE,
                    (
                        _slot("a", "A", Quarter.Q0),
                        _slot("b", "B", Quarter.Q2),
                    ),
                ),
            ),
        )
        with self.assertRaises(NoLegalSOTemplateAssignment):
            fit_so_template(
                template,
                (
                    SOObservedMember("v1", "A", "r1", 0.0),
                    SOObservedMember("v2", "A", "r1", 0.5),
                ),
            )

    def test_wrong_route_instance_composition_has_no_legal_assignment(self) -> None:
        template = SOTemplate(
            "chain",
            "chain",
            (
                SORouteInstance(
                    "r1",
                    SORouteKind.SINGLE,
                    (_slot("a", "A", Quarter.Q0),),
                ),
                SORouteInstance(
                    "r2",
                    SORouteKind.SINGLE,
                    (_slot("b", "A", Quarter.Q2),),
                ),
            ),
        )
        with self.assertRaises(NoLegalSOTemplateAssignment):
            fit_so_template(
                template,
                (
                    SOObservedMember("v1", "A", "r1", 0.0),
                    SOObservedMember("v2", "A", "r1", 0.5),
                ),
            )

    def test_member_count_must_match_selected_template(self) -> None:
        with self.assertRaises(NoLegalSOTemplateAssignment):
            fit_so_template(
                _single_template(),
                (SOObservedMember("v1", "A", "r1", 0.0),),
            )

    def test_duplicate_member_ids_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            fit_so_template(
                _single_template(),
                (
                    SOObservedMember("same", "A", "r1", 0.0),
                    SOObservedMember("same", "A", "r1", 0.5),
                ),
            )

    def test_semantic_phase_is_normalized_modulo_one(self) -> None:
        member = SOObservedMember("v1", "A", "r1", 1.25)
        self.assertAlmostEqual(member.semantic_phase, 0.25)

    def test_position_error_is_reported_per_member(self) -> None:
        result = fit_so_template(
            _single_template(),
            (
                SOObservedMember("v1", "A", "r1", 0.00),
                SOObservedMember("v2", "A", "r1", 0.60),
            ),
        )
        errors = {item.member_id: item.position_error_cycle for item in result.members}
        self.assertAlmostEqual(errors["v1"], 0.05)
        self.assertAlmostEqual(errors["v2"], 0.05)
        self.assertAlmostEqual(result.mean_position_error_cycle, 0.05)
        self.assertAlmostEqual(result.maximum_position_error_cycle, 0.05)


if __name__ == "__main__":
    unittest.main()
