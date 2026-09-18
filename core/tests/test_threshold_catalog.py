from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import unittest

from bluewolf_core.config import CoreConfig
from bluewolf_core.event_alert import EventAlertConfig
from bluewolf_ingest.polling import LivePollConfig

CATALOG_PATH = Path(__file__).resolve().parents[1] / "docs" / "ACTIVE_ALGORITHM_THRESHOLD_CATALOG.json"
ALLOWED_CLASSIFICATIONS = {"product", "calibration", "implementation_guard", "compatibility"}


def _actual_thresholds() -> dict[str, object]:
    config = CoreConfig()
    actual: dict[str, object] = {}
    for section in ("scoring", "detection", "grouping", "timing"):
        for key, value in asdict(getattr(config, section)).items():
            actual[f"core.{section}.{key}"] = value
    for key, value in asdict(LivePollConfig()).items():
        actual[f"ingest.polling.{key}"] = value
    for key, value in asdict(EventAlertConfig()).items():
        actual[f"events.{key}"] = value
    return actual


class ActiveThresholdCatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))

    def test_catalog_exactly_matches_active_config_defaults(self) -> None:
        actual = _actual_thresholds()
        rows = {row["path"]: row for row in self.catalog["thresholds"]}
        self.assertEqual(set(rows), set(actual))
        for path, value in actual.items():
            self.assertEqual(rows[path]["value"], value, path)

    def test_every_threshold_has_classification_rationale_and_source(self) -> None:
        for row in self.catalog["thresholds"]:
            self.assertIn(row["classification"], ALLOWED_CLASSIFICATIONS, row["path"])
            self.assertGreaterEqual(len(row["rationale"].strip()), 24, row["path"])
            source_file = row["source"].split(":", 1)[0]
            self.assertTrue((Path(__file__).resolve().parents[1] / source_file).exists(), row["path"])

    def test_compatibility_fields_are_never_described_as_active_gates(self) -> None:
        rows = {row["path"]: row for row in self.catalog["thresholds"]}
        for path in (
            "core.detection.new_route_observation_seconds",
            "core.detection.known_route_candidate_seconds",
            "core.detection.change_confirmation_seconds",
        ):
            self.assertEqual(rows[path]["classification"], "compatibility")
            self.assertRegex(rows[path]["rationale"], r"(legacy|תאימות|compatibility|אינו)")

    def test_algorithm_decisions_have_rationale_alternatives_and_real_evidence_paths(self) -> None:
        algorithms = self.catalog["algorithms"]
        self.assertGreaterEqual(len(algorithms), 10)
        seen: set[str] = set()
        root = Path(__file__).resolve().parents[1]
        repo_root = root.parent
        for row in algorithms:
            self.assertNotIn(row["id"], seen)
            seen.add(row["id"])
            self.assertGreaterEqual(len(row["decision"].strip()), 24, row["id"])
            self.assertGreaterEqual(len(row["rationale"].strip()), 24, row["id"])
            self.assertGreaterEqual(len(row["alternatives"].strip()), 24, row["id"])
            self.assertTrue(row["evidence"], row["id"])
            for evidence in row["evidence"]:
                candidate = (root / evidence) if not evidence.startswith("../") else (repo_root / evidence[3:])
                self.assertTrue(candidate.exists(), f"{row['id']}: missing {evidence}")


    def test_current_state_docs_do_not_reintroduce_superseded_runtime_claims(self) -> None:
        docs_root = Path(__file__).resolve().parents[1] / "docs"
        implementation = (docs_root / "IMPLEMENTATION_STATUS_HE.md").read_text(encoding="utf-8")
        research = (docs_root / "ALGORITHMIC_CORE_RESEARCH_LOG_HE.md").read_text(encoding="utf-8")

        self.assertNotIn("ה־runtime operational הנוכחי מחבר SO; SI דורש serializer/bindings/live pipeline מקבילים.", implementation)
        self.assertNotIn("אין נוסחת smoothing מוגדרת", implementation)
        self.assertIn("SI ו-SO מחוברים כיום כ-first-class sibling families", implementation)
        self.assertIn("ACTIVE_ALGORITHM_THRESHOLD_CATALOG.json", implementation)

        self.assertIn("## Current-head supersession — 18/09/2026", research)
        self.assertIn("המצב הפעיל אינו עוד SO-only", research)
        self.assertIn("RAW/5/10/20/30", research)
        self.assertIn("Reader מדומה אינו נחשב acceptance evidence", research)

    def test_documented_current_baseline_is_not_older_than_threshold_catalog_baseline(self) -> None:
        docs_root = Path(__file__).resolve().parents[1] / "docs"
        implementation = (docs_root / "IMPLEMENTATION_STATUS_HE.md").read_text(encoding="utf-8")
        research = (docs_root / "ALGORITHMIC_CORE_RESEARCH_LOG_HE.md").read_text(encoding="utf-8")
        current = "3c76d8bda4526ec7e36d7cbb3d3d4737ec6628a2"
        self.assertIn(current, implementation)
        self.assertIn(current, research)


if __name__ == "__main__":
    unittest.main()
