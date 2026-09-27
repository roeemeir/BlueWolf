from __future__ import annotations

import unittest

from bluewolf_core.so_template_bank import (
    SOConstellationSignature,
    SOTemplateBank,
    SOTemplateBankEntry,
)
from bluewolf_core.so_template_selection import (
    InvalidSOTemplateSelection,
    SOTemplateSelectionRegistry,
    SOTemplateSelectionSource,
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
    route_kind: SORouteKind = SORouteKind.SINGLE,
) -> SOTemplate:
    return SOTemplate(
        template_id=template_id,
        name=template_id,
        route_instances=(
            SORouteInstance(
                route_instance_id=f"{template_id}-route",
                route_kind=route_kind,
                vehicle_slots=(
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


class SOTemplateSelectionRegistryTests(unittest.TestCase):
    def test_default_is_used_when_no_manual_selection_exists(self) -> None:
        bank, default, _, _ = _bank()
        signature = SOConstellationSignature.from_template(default)
        registry = SOTemplateSelectionRegistry(bank)

        selection = registry.active_selection("group-1", signature)
        self.assertEqual(selection.template_id, "default")
        self.assertIs(selection.source, SOTemplateSelectionSource.DEFAULT)

    def test_constellation_without_default_has_no_active_template(self) -> None:
        manual_only = _template("manual-only")
        bank = SOTemplateBank((SOTemplateBankEntry(manual_only),))
        signature = SOConstellationSignature.from_template(manual_only)
        registry = SOTemplateSelectionRegistry(bank)

        selection = registry.active_selection("group-1", signature)
        self.assertIsNone(selection.template)
        self.assertIs(selection.source, SOTemplateSelectionSource.NONE)

    def test_manual_selection_overrides_default(self) -> None:
        bank, default, alternate, _ = _bank()
        signature = SOConstellationSignature.from_template(default)
        registry = SOTemplateSelectionRegistry(bank)

        selection = registry.select_manual("group-1", signature, alternate.template_id)
        self.assertEqual(selection.template_id, "alternate")
        self.assertIs(selection.source, SOTemplateSelectionSource.MANUAL)

    def test_manual_selection_cannot_choose_irrelevant_template(self) -> None:
        bank, default, _, other = _bank()
        signature = SOConstellationSignature.from_template(default)
        registry = SOTemplateSelectionRegistry(bank)

        with self.assertRaises(InvalidSOTemplateSelection):
            registry.select_manual("group-1", signature, other.template_id)

    def test_manual_selection_is_scoped_to_exact_group_id(self) -> None:
        bank, default, alternate, _ = _bank()
        signature = SOConstellationSignature.from_template(default)
        registry = SOTemplateSelectionRegistry(bank)
        registry.select_manual("group-1", signature, alternate.template_id)

        first = registry.active_selection("group-1", signature)
        second = registry.active_selection("group-2", signature)
        self.assertEqual(first.template_id, "alternate")
        self.assertEqual(second.template_id, "default")

    def test_manual_selection_is_scoped_to_exact_constellation(self) -> None:
        bank, default, alternate, other = _bank()
        first_signature = SOConstellationSignature.from_template(default)
        second_signature = SOConstellationSignature.from_template(other)
        registry = SOTemplateSelectionRegistry(bank)
        registry.select_manual("group-1", first_signature, alternate.template_id)

        first = registry.active_selection("group-1", first_signature)
        second = registry.active_selection("group-1", second_signature)
        self.assertEqual(first.template_id, "alternate")
        self.assertEqual(second.template_id, "other")

    def test_clearing_manual_selection_falls_back_to_default(self) -> None:
        bank, default, alternate, _ = _bank()
        signature = SOConstellationSignature.from_template(default)
        registry = SOTemplateSelectionRegistry(bank)
        registry.select_manual("group-1", signature, alternate.template_id)

        selection = registry.clear_manual("group-1", signature)
        self.assertEqual(selection.template_id, "default")
        self.assertIs(selection.source, SOTemplateSelectionSource.DEFAULT)

    def test_state_roundtrip_is_deterministic(self) -> None:
        bank, default, alternate, other = _bank()
        first_signature = SOConstellationSignature.from_template(default)
        second_signature = SOConstellationSignature.from_template(other)
        registry = SOTemplateSelectionRegistry(bank)
        registry.select_manual("group-z", first_signature, alternate.template_id)
        registry.select_manual("group-a", second_signature, other.template_id)

        state = registry.export_state()
        restored, invalidated = SOTemplateSelectionRegistry.from_state(bank, state)

        self.assertEqual(invalidated, ())
        self.assertEqual(restored.export_state(), state)
        self.assertEqual(
            restored.active_selection("group-z", first_signature).template_id,
            "alternate",
        )
        self.assertEqual(
            restored.active_selection("group-a", second_signature).template_id,
            "other",
        )

    def test_restore_explicitly_reports_removed_template(self) -> None:
        bank, default, alternate, _ = _bank()
        signature = SOConstellationSignature.from_template(default)
        registry = SOTemplateSelectionRegistry(bank)
        registry.select_manual("group-1", signature, alternate.template_id)
        state = registry.export_state()

        new_bank = SOTemplateBank((SOTemplateBankEntry(default, is_default=True),))
        restored, invalidated = SOTemplateSelectionRegistry.from_state(new_bank, state)

        self.assertEqual(len(invalidated), 1)
        self.assertEqual(invalidated[0].template_id, "alternate")
        self.assertEqual(invalidated[0].reason, "template_removed")
        self.assertEqual(
            restored.active_selection("group-1", signature).template_id,
            "default",
        )

    def test_reconcile_bank_retains_still_relevant_manual_selection(self) -> None:
        bank, default, alternate, _ = _bank()
        signature = SOConstellationSignature.from_template(default)
        registry = SOTemplateSelectionRegistry(bank)
        registry.select_manual("group-1", signature, alternate.template_id)

        new_bank = SOTemplateBank(
            (
                SOTemplateBankEntry(default, is_default=True),
                SOTemplateBankEntry(alternate),
            )
        )
        invalidated = registry.reconcile_bank(new_bank)

        self.assertEqual(invalidated, ())
        self.assertEqual(
            registry.active_selection("group-1", signature).template_id,
            "alternate",
        )

    def test_reconcile_bank_invalidates_template_that_changed_constellation(self) -> None:
        bank, default, alternate, _ = _bank()
        signature = SOConstellationSignature.from_template(default)
        registry = SOTemplateSelectionRegistry(bank)
        registry.select_manual("group-1", signature, alternate.template_id)

        moved = _template("alternate", vehicle_type="B")
        new_bank = SOTemplateBank(
            (
                SOTemplateBankEntry(default, is_default=True),
                SOTemplateBankEntry(moved),
            )
        )
        invalidated = registry.reconcile_bank(new_bank)

        self.assertEqual(len(invalidated), 1)
        self.assertEqual(invalidated[0].reason, "template_no_longer_relevant")
        self.assertEqual(
            registry.active_selection("group-1", signature).template_id,
            "default",
        )

    def test_duplicate_persisted_selection_is_rejected(self) -> None:
        bank, default, alternate, _ = _bank()
        signature = SOConstellationSignature.from_template(default)
        registry = SOTemplateSelectionRegistry(bank)
        registry.select_manual("group-1", signature, alternate.template_id)
        item = registry.export_state()["manual_selections"][0]

        with self.assertRaises(InvalidSOTemplateSelection):
            SOTemplateSelectionRegistry.from_state(
                bank,
                {"manual_selections": [item, item]},
            )


if __name__ == "__main__":
    unittest.main()
