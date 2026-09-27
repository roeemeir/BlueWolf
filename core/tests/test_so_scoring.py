from __future__ import annotations

import unittest

from bluewolf_core.so_scoring import SOScoringObservation, score_so_template
from bluewolf_core.so_template_fit import NoLegalSOTemplateAssignment
from bluewolf_core.so_templates import (
    Quarter,
    SORouteInstance,
    SORouteKind,
    SOTemplate,
    SOVehicleSlot,
)


def _template() -> SOTemplate:
    return SOTemplate(
        "so-score",
        "SO score",
        (
            SORouteInstance(
                "r1",
                SORouteKind.SINGLE,
                (
                    SOVehicleSlot("front", "A", Quarter.Q0),
                    SOVehicleSlot("back", "A", Quarter.Q2),
                ),
            ),
        ),
    )


def _observation(
    member_id: str,
    phase: float,
    *,
    vehicle_type: str = "A",
    reliability: float = 1.0,
    period_error_ratio: float = 0.0,
    movement_error_ratio: float = 0.0,
    position_reason: str = "so_template_phase",
    diagnostics=None,
) -> SOScoringObservation:
    return SOScoringObservation(
        member_id=member_id,
        vehicle_type=vehicle_type,
        route_instance_id="r1",
        semantic_phase=phase,
        period_error_ratio=period_error_ratio,
        movement_error_ratio=movement_error_ratio,
        distance_error_b_ratio=0.0,
        tangent_error_deg=0.0,
        curvature_error_ratio=0.0,
        reliability=reliability,
        speed_fraction=1.0,
        position_reason=position_reason,
        diagnostics={} if diagnostics is None else diagnostics,
    )


class SOScoringBridgeTests(unittest.TestCase):
    def test_exact_template_fit_produces_full_scores(self) -> None:
        result = score_so_template(
            _template(),
            (
                _observation("v1", 0.10),
                _observation("v2", 0.60),
            ),
        )

        self.assertAlmostEqual(result.template_fit.common_phase, 0.10)
        self.assertTrue(result.group_scores.valid)
        self.assertAlmostEqual(result.group_scores.total or 0.0, 100.0)
        for member in result.members:
            self.assertAlmostEqual(member.position_error_cycle, 0.0)
            self.assertAlmostEqual(member.scores.total or 0.0, 100.0)
            assert member.scores.components is not None
            self.assertAlmostEqual(member.scores.components.sync_position, 100.0)

    def test_position_error_uses_approved_so_cycle_band(self) -> None:
        # Normalized template phases differ by 0.30 cycles, so the L1 common
        # phase sits halfway and each member has 0.15 cycle position error.
        result = score_so_template(
            _template(),
            (
                _observation("v1", 0.00),
                _observation("v2", 0.80),
            ),
        )

        for member in result.members:
            self.assertAlmostEqual(member.position_error_cycle, 0.15)
            assert member.scores.components is not None
            self.assertAlmostEqual(member.scores.components.sync_position, 50.0)
            # 60% position + 20% period + 20% movement = 70 sync.
            self.assertAlmostEqual(member.scores.sync or 0.0, 70.0)
            # Route remains 100; total law is 75% sync + 25% route.
            self.assertAlmostEqual(member.scores.total or 0.0, 77.5)

    def test_period_and_movement_primitives_are_not_redefined_by_template_fit(self) -> None:
        result = score_so_template(
            _template(),
            (
                _observation(
                    "v1",
                    0.10,
                    period_error_ratio=0.10,
                    movement_error_ratio=0.20,
                ),
                _observation(
                    "v2",
                    0.60,
                    period_error_ratio=0.10,
                    movement_error_ratio=0.20,
                ),
            ),
        )

        for member in result.members:
            self.assertAlmostEqual(member.metrics.period_error_ratio, 0.10)
            self.assertAlmostEqual(member.metrics.movement_error_ratio, 0.20)
            self.assertAlmostEqual(member.metrics.position_error, 0.0)

    def test_low_reliability_member_is_invalid_and_group_requires_two_valid(self) -> None:
        result = score_so_template(
            _template(),
            (
                _observation("v1", 0.10, reliability=1.0),
                _observation("v2", 0.60, reliability=0.50),
            ),
        )

        by_id = {member.member_id: member for member in result.members}
        self.assertTrue(by_id["v1"].scores.valid)
        self.assertFalse(by_id["v2"].scores.valid)
        self.assertFalse(result.group_scores.valid)
        self.assertEqual(result.group_scores.valid_vehicle_count, 1)
        self.assertEqual(result.group_scores.primary_reason, "insufficient_coverage")

    def test_turn_timing_can_label_position_loss_without_becoming_a_fourth_weight(self) -> None:
        result = score_so_template(
            _template(),
            (
                _observation(
                    "v1",
                    0.00,
                    position_reason="turn_timing",
                    diagnostics={"turn_timing_error_cycle": 0.12},
                ),
                _observation(
                    "v2",
                    0.80,
                    position_reason="turn_timing",
                    diagnostics={"turn_timing_error_cycle": 0.12},
                ),
            ),
        )

        for member in result.members:
            self.assertEqual(member.scores.primary_reason, "turn_timing")
            self.assertAlmostEqual(
                float(member.metrics.diagnostics["turn_timing_error_cycle"]),
                0.12,
            )
            # The numeric score is still the same 60/20/20 three-component law.
            self.assertAlmostEqual(member.scores.sync or 0.0, 70.0)

    def test_fit_diagnostics_are_reserved_and_cannot_be_overridden(self) -> None:
        result = score_so_template(
            _template(),
            (
                _observation(
                    "v1",
                    0.10,
                    diagnostics={"template_id": "fake", "operator_note": "ok"},
                ),
                _observation("v2", 0.60),
            ),
        )
        by_id = {member.member_id: member for member in result.members}
        diagnostics = by_id["v1"].metrics.diagnostics
        self.assertEqual(diagnostics["template_id"], "so-score")
        self.assertEqual(diagnostics["operator_note"], "ok")
        self.assertIn(diagnostics["slot_id"], ("front", "back"))

    def test_wrong_vehicle_composition_still_has_no_legal_assignment(self) -> None:
        with self.assertRaises(NoLegalSOTemplateAssignment):
            score_so_template(
                _template(),
                (
                    _observation("v1", 0.10, vehicle_type="A"),
                    _observation("v2", 0.60, vehicle_type="B"),
                ),
            )

    def test_minimum_valid_vehicle_count_must_be_positive(self) -> None:
        with self.assertRaises(ValueError):
            score_so_template(
                _template(),
                (_observation("v1", 0.10), _observation("v2", 0.60)),
                minimum_valid_vehicles=0,
            )


if __name__ == "__main__":
    unittest.main()
