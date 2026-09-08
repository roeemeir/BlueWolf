from __future__ import annotations

import unittest

from bluewolf_core.so_template_bank import (
    SOConstellationSignature,
    SOTemplateBank,
    SOTemplateBankEntry,
)
from bluewolf_core.so_template_selection import (
    InvalidSOTemplateSelection,
    SOTemplateSelectionState,
    StaleSOTemplateSelection,
)
from bluewolf_core.so_templates import (
    Quarter,
    SORouteInstance,
    SORouteKind,
    SOTemplate,
    SOVehicleSlot,
)


def _template(
    template_id: str,
    *,
    vehicle_type: str = "A",
    quarters: tuple[Quarter, Quarter] = (Quarter.Q0, Quarter.Q2),
) -> SOTemplate:
    return SOTemplate(
        template_id,
        template_id,
        (
            SORouteInstance(
                f"{template_id}-route",
                SORouteKind.SINGLE,
                (
                    SOVehicleSlot(f"{template_id}-1", vehicle_type, quarters[0]),
                    SOVehicleSlot(f"{template_id}-2", vehicle_type, quarters[1]),
                ),
            ),
        ),
    )


def _bank() -> tuple[SOTemplateBank, SOTemplate, SOTemplate, SOTemplate]:
    default = _template("default")
    alternate = _template("alternate", quarters=(Quarter.Q0, Quarter.Q1))
    other = _template("other", vehicle_type="B")
    bank = SOTemplateBank(
        (
            SOTemplateBankEntry(default, is_default=True),
            SOTemplateBankEntry(alternate),
            SOTemplateBankEntry(other, is_default=True),
        )
    )
    return bank, default, alternate, other


class SOTemplateSelectionTests(unittest.TestCase):
    def test_default_is_used_when_operator_has_no_manual_choice(self) -> None:
        bank, default, _, _ = _bank()
        signature = SOConstellationSignature.from_template(default)
        resolution = SOTemplateSelectionState().resolve(bank, "group-1", signature)

        self.assertEqual(resolution.source, "default")
        self.assertIs(resolution.template, default)

    def test_manual_choice_overrides_default_only_for_same_group_and_constellation(self) -> None:
        bank, default, alternate, other = _bank()
        signature = SOConstellationSignature.from_template(default)
        other_signature = SOConstellationSignature.from_template(other)
        state = SOTemplateSelectionState()
        state.select_manual(bank, "group-1", signature, "alternate")

        selected = state.resolve(bank, "group-1", signature)
        other_group = state.resolve(bank, "group-2", signature)
        other_constellation = state.resolve(bank, "group-1", other_signature)

        self.assertEqual(selected.source, "manual")
        self.assertIs(selected.template, alternate)
        self.assertEqual(other_group.source, "default")
        self.assertIs(other_group.template, default)
        self.assertEqual(other_constellation.source, "default")
        self.assertIs(other_constellation.template, other)

    def test_operator_cannot_select_template_outside_relevant_bank(self) -> None:
        bank, default, _, other = _bank()
        signature = SOConstellationSignature.from_template(default)
        with self.assertRaises(InvalidSOTemplateSelection):
            SOTemplateSelectionState().select_manual(
                bank,
                "group-1",
                signature,
                other.template_id,
            )

    def test_clear_manual_returns_resolution_to_developer_default(self) -> None:
        bank, default, alternate, _ = _bank()
        signature = SOConstellationSignature.from_template(default)
        state = SOTemplateSelectionState()
        state.select_manual(bank, "group-1", signature, alternate.template_id)
        state.clear_manual("group-1", signature)

        resolution = state.resolve(bank, "group-1", signature)
        self.assertEqual(resolution.source, "default")
        self.assertIs(resolution.template, default)
        self.assertIsNone(state.manual_template_id("group-1", signature))

    def test_no_default_and_no_manual_choice_is_explicit_none(self) -> None:
        template = _template("manual-only")
        bank = SOTemplateBank((SOTemplateBankEntry(template),))
        signature = SOConstellationSignature.from_template(template)
        resolution = SOTemplateSelectionState().resolve(bank, "group-1", signature)

        self.assertEqual(resolution.source, "none")
        self.assertIsNone(resolution.template)

    def test_saved_choice_that_disappears_from_bank_is_reported_stale(self) -> None:
        bank, default, alternate, _ = _bank()
        signature = SOConstellationSignature.from_template(default)
        state = SOTemplateSelectionState()
        state.select_manual(bank, "group-1", signature, alternate.template_id)

        replacement_bank = SOTemplateBank((SOTemplateBankEntry(default, is_default=True),))
        with self.assertRaises(StaleSOTemplateSelection):
            state.resolve(replacement_bank, "group-1", signature)

    def test_state_export_import_is_deterministic(self) -> None:
        bank, default, alternate, other = _bank()
        first_signature = SOConstellationSignature.from_template(default)
        second_signature = SOConstellationSignature.from_template(other)
        state = SOTemplateSelectionState()
        state.select_manual(bank, "group-2", first_signature, alternate.template_id)
        state.select_manual(bank, "group-1", second_signature, other.template_id)

        exported = state.export_state()
        restored = SOTemplateSelectionState.from_state(exported)

        self.assertEqual(restored.export_state(), exported)
        self.assertEqual(
            restored.manual_template_id("group-2", first_signature),
            alternate.template_id,
        )
        self.assertEqual(
            restored.manual_template_id("group-1", second_signature),
            other.template_id,
        )

    def test_group_id_and_template_id_must_be_non_empty(self) -> None:
        bank, default, _, _ = _bank()
        signature = SOConstellationSignature.from_template(default)
        state = SOTemplateSelectionState()
        with self.assertRaises(ValueError):
            state.select_manual(bank, "", signature, default.template_id)
        with self.assertRaises(ValueError):
            state.select_manual(bank, "group-1", signature, "")

    def test_invalid_persisted_state_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            SOTemplateSelectionState.from_state(
                {"manual": [{"group_id": "g", "template_id": "t", "routes": []}]}
            )


if __name__ == "__main__":
    unittest.main()
