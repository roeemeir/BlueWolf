from __future__ import annotations

import json
from pathlib import Path
import unittest

from bluewolf_core.models import PrimitiveMetrics, RouteFamily
from bluewolf_core.si_scoring import SIScoringMemberInput, score_si_template
from bluewolf_core.templates import ObservedMember
from bluewolf_runtime_adapter.si_template_config import (
    operational_si_template_index,
    parse_operational_si_templates,
)


FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "si-runtime-bridge.json"


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


class SITemplateConfigBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        cls.fixture = fixture
        cls.config = {"siTemplates": fixture["expectedSiTemplates"]}

    def test_shared_web_fixture_parses_to_exact_core_slots(self) -> None:
        entries = parse_operational_si_templates(self.config)
        self.assertEqual([entry.template.template_id for entry in entries], ["si-exact-120", "si-changed-90"])
        exact = entries[0].template
        changed = entries[1].template
        self.assertAlmostEqual(exact.slots[1].phase_offset, 1.0 / 3.0)
        self.assertAlmostEqual(changed.slots[1].phase_offset, 1.0 / 4.0)
        self.assertEqual(exact.slots[0].route_role, "outer")
        self.assertEqual(exact.slots[1].vehicle_type, "lightning")
        self.assertTrue(entries[0].is_default)
        self.assertFalse(entries[1].is_default)

    def test_bw_sync_012_saved_120_to_90_edit_changes_core_raw_score(self) -> None:
        index = operational_si_template_index(self.config)
        members = (
            SIScoringMemberInput(ObservedMember("v1", "storm", 0.0, route_role="outer"), _metrics()),
            SIScoringMemberInput(ObservedMember("v2", "lightning", 1.0 / 3.0, route_role="outer"), _metrics()),
        )

        exact = score_si_template(index["si-exact-120"].template, members)
        changed = score_si_template(index["si-changed-90"].template, members)

        self.assertTrue(exact.group_scores.valid)
        self.assertTrue(changed.group_scores.valid)
        self.assertEqual(exact.group_scores.sync, 100.0)
        self.assertEqual(exact.group_scores.total, 100.0)
        self.assertLess(changed.group_scores.sync, exact.group_scores.sync)
        self.assertLess(changed.group_scores.total, exact.group_scores.total)
        self.assertGreater(changed.fit.mean_position_error_cycle, exact.fit.mean_position_error_cycle)
        self.assertEqual(changed.fit.template_id, "si-changed-90")

    def test_parser_fails_closed_on_non_discrete_phase_or_unknown_ring(self) -> None:
        bad_phase = json.loads(json.dumps(self.config))
        bad_phase["siTemplates"][0]["slots"][1]["phaseOffset"] = 0.31
        with self.assertRaisesRegex(ValueError, "30-degree SI slot"):
            parse_operational_si_templates(bad_phase)

        bad_ring = json.loads(json.dumps(self.config))
        bad_ring["siTemplates"][0]["slots"][0]["routeRole"] = "sideways"
        with self.assertRaisesRegex(ValueError, "inner, middle or outer"):
            parse_operational_si_templates(bad_ring)


if __name__ == "__main__":
    unittest.main()
