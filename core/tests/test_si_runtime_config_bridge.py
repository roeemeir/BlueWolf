from __future__ import annotations

import unittest

from bluewolf_core.models import PrimitiveMetrics, RouteFamily
from bluewolf_core.si_scoring import SIScoringMemberInput, score_si_template
from bluewolf_core.templates import ObservedMember
from bluewolf_runtime_adapter.si_template_config import (
    parse_si_templates,
    parse_si_vehicle_types,
    resolve_si_vehicle_type,
    validate_si_runtime_configuration,
)


def _metrics() -> PrimitiveMetrics:
    return PrimitiveMetrics(
        family=RouteFamily.SI,
        position_error=999.0,
        period_error_ratio=0.0,
        movement_error_ratio=0.0,
        distance_error_b_ratio=0.0,
        tangent_error_deg=0.0,
        curvature_error_ratio=0.0,
        reliability=1.0,
        speed_fraction=1.0,
    )


def _raw(second_phase: float) -> list[dict[str, object]]:
    return [
        {
            "id": "web-si",
            "name": "Web SI",
            "default": True,
            "slots": [
                {"id": "outer-0", "vehicleType": "TYPE_A", "routeRole": "outer", "phaseOffset": 0.0},
                {"id": "outer-2", "vehicleType": "TYPE_A", "routeRole": "outer", "phaseOffset": second_phase},
            ],
        }
    ]


def _profiles() -> list[dict[str, object]]:
    return [
        {
            "id": "TYPE_A",
            "minId": 100,
            "maxId": 199,
            "workSpeedMps": 12.5,
            "siRoles": ["outer", "middle"],
        },
        {
            "id": "TYPE_B",
            "minId": 300,
            "maxId": 399,
            "workSpeedMps": 10.0,
            "siRoles": ["inner"],
        },
    ]


class SIRuntimeConfigBridgeTests(unittest.TestCase):
    def test_bw_sync_012_web_operational_coordinates_change_core_score(self) -> None:
        exact = parse_si_templates(_raw(1.0 / 3.0))[0]
        changed = parse_si_templates(_raw(1.0 / 4.0))[0]
        self.assertTrue(exact.is_default)
        self.assertEqual(exact.template.slots[1].route_role, "outer")

        members = (
            SIScoringMemberInput(ObservedMember("v1", "TYPE_A", 0.0, "outer"), _metrics()),
            SIScoringMemberInput(ObservedMember("v2", "TYPE_A", 1.0 / 3.0, "outer"), _metrics()),
        )
        exact_result = score_si_template(exact.template, members)
        changed_result = score_si_template(changed.template, members)

        self.assertEqual(exact_result.group_scores.sync, 100.0)
        self.assertEqual(exact_result.group_scores.total, 100.0)
        self.assertLess(changed_result.group_scores.sync, exact_result.group_scores.sync)
        self.assertLess(changed_result.group_scores.total, exact_result.group_scores.total)

    def test_vehicle_profile_resolver_uses_saved_ranges_and_work_speed(self) -> None:
        profiles = parse_si_vehicle_types(_profiles())
        selected = resolve_si_vehicle_type(profiles, 145)
        self.assertIsNotNone(selected)
        assert selected is not None
        self.assertEqual(selected.type_id, "TYPE_A")
        self.assertEqual(selected.work_speed_mps, 12.5)
        self.assertEqual(selected.si_roles, frozenset({"outer", "middle"}))
        self.assertIsNone(resolve_si_vehicle_type(profiles, 250))

    def test_runtime_configuration_rejects_unknown_type_or_forbidden_ring(self) -> None:
        templates = parse_si_templates(_raw(1.0 / 3.0))
        profiles = parse_si_vehicle_types(_profiles())
        validate_si_runtime_configuration(templates, profiles)

        bad_profiles = _profiles()
        bad_profiles[0]["siRoles"] = ["inner"]
        with self.assertRaisesRegex(ValueError, "forbidden role"):
            validate_si_runtime_configuration(
                templates,
                parse_si_vehicle_types(bad_profiles),
            )

    def test_vehicle_profile_parser_rejects_overlapping_ranges(self) -> None:
        overlapping = _profiles()
        overlapping[1]["minId"] = 150
        with self.assertRaisesRegex(ValueError, "overlapping"):
            parse_si_vehicle_types(overlapping)

    def test_parser_rejects_non_ring_roles_and_out_of_cycle_offsets(self) -> None:
        invalid_role = _raw(1.0 / 3.0)
        invalid_role[0]["slots"][1]["routeRole"] = "left"  # type: ignore[index]
        with self.assertRaisesRegex(ValueError, "routeRole"):
            parse_si_templates(invalid_role)

        invalid_offset = _raw(1.0 / 3.0)
        invalid_offset[0]["slots"][1]["phaseOffset"] = 1.0  # type: ignore[index]
        with self.assertRaisesRegex(ValueError, r"\[0,1\)"):
            parse_si_templates(invalid_offset)

    def test_missing_si_runtime_sections_are_backward_compatible(self) -> None:
        self.assertEqual(parse_si_templates(None), ())
        self.assertEqual(parse_si_templates([]), ())
        self.assertEqual(parse_si_vehicle_types(None), ())
        self.assertEqual(parse_si_vehicle_types([]), ())


if __name__ == "__main__":
    unittest.main()
