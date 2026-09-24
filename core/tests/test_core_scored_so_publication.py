"""SO publication test uses FIXTURE route/group identities, not route-detection E2E.

The SO scorer, scores, event lifecycle, selection, runtime serializer and HTTP
snapshot store are real. The separately verified navigation-source integration
is required before this fixture is promoted to full route-to-publisher proof.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_core.live_so_event_runtime import TemplateComparisonDimension
from bluewolf_core.live_so_scoring import LiveSOGroupScorer
from bluewolf_core.so_template_bank import SOTemplateBank, SOTemplateBankEntry
from bluewolf_core.so_template_selection import SOTemplateSelectionRegistry
from bluewolf_runtime_adapter.core_scored_si import CoreScoredSIRuntime
from bluewolf_runtime_adapter.core_scored_si_family import CoreScoredSIFamilyRuntimeAdapter
from bluewolf_runtime_adapter.core_scored_so import CoreScoredSOEventRuntime
from bluewolf_runtime_adapter.core_scored_so_family import CoreScoredSOFamilyRuntimeAdapter
from bluewolf_runtime_adapter.core_scored_so_producer import CoreScoredSOProducer
from bluewolf_runtime_adapter.family_environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.operational_state import CheckpointedOperationalRuntimeLoop
from bluewolf_runtime_adapter.producer import DisplayedScoreValue
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore
from test_mixed_environment_factory import _config as mixed_config
from test_runtime_producer import _Session, _binding, _group, _poll
from test_live_so_scoring import START, _route, _template


class CoreScoredSOPublicationTests(unittest.TestCase):
    def test_two_fixture_bound_groups_publish_only_real_same_observation_core_scores(self):
        route = _route(period_s=100.0)
        groups = (_group("g1", 1, 2, route), _group("g2", 3, 4, route))
        session = _Session(groups, {(1, key): route for key in (1, 2, 3, 4)})
        bindings = {"g1": _binding("g1", 1, 2, route), "g2": _binding("g2", 3, 4, route)}
        bank = SOTemplateBank((SOTemplateBankEntry(_template("default"), is_default=True),))
        runtime = CoreScoredSOEventRuntime(
            LiveSOGroupScorer(SOTemplateSelectionRegistry(bank)),
            comparison_dimension=TemplateComparisonDimension.SYNC,
        )
        store = RuntimeSnapshotStore()
        def no_external_scores(group_id, observed_at):
            raise AssertionError("Core-scored producer must not request an external score")
        producer = CoreScoredSOProducer(
            server_id=1,
            session=session,
            runtime=runtime,
            store=store,
            binding_resolver=lambda group: bindings.get(group.group_id),
            displayed_score_resolver=no_external_scores,
        )
        pending = producer.publish_poll(_poll(groups, route, 0))
        self.assertEqual(pending.published_group_ids, ("g1", "g2"))
        self.assertFalse(any(item["scoreValid"] for item in store.get("1")["groupList"]))
        scored = producer.publish_poll(_poll(groups, route, 5))
        self.assertEqual(scored.published_group_ids, ("g1", "g2"))
        latest = store.get("1")
        self.assertEqual(latest["source"]["kind"], "python-core")
        self.assertEqual([item["id"] for item in latest["groupList"]], ["g1", "g2"])
        for item in latest["groupList"]:
            measured = runtime.latest_displayed(item["id"], START.replace(second=5))
            self.assertTrue(measured.valid)
            self.assertTrue(item["scoreValid"])
            self.assertAlmostEqual(item["total"], measured.score)
            self.assertEqual(item["event"]["contextKey"], runtime.event_engine.snapshot(item["id"]).context_key)
            self.assertTrue(all(member["scoreValid"] for member in item["members"]))
        self.assertEqual(latest["groups"]["so"]["id"], "g1")
        self.assertTrue(any(point["groups"] for point in store.history("1")))

    def test_core_mode_builds_independent_scored_si_so_and_restores_family_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            config = mixed_config(persistence_path=str(Path(directory) / "state.json"))
            config["displayedScore"] = {"mode": "core"}
            with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "not-a-real-token"}):
                first = build_operational_runtime(config, RuntimeSnapshotStore())
            self.assertIsInstance(first, CheckpointedOperationalRuntimeLoop)
            host = first.pipelines[0].producer
            si, so = host.family("si"), host.family("so")
            self.assertIsInstance(si, CoreScoredSIFamilyRuntimeAdapter)
            self.assertIsInstance(so, CoreScoredSOFamilyRuntimeAdapter)
            self.assertIsInstance(si.producer.runtime, CoreScoredSIRuntime)
            self.assertIsInstance(so.producer.runtime, CoreScoredSOEventRuntime)
            self.assertIs(si.session, so.session)
            first.save_checkpoint()
            persisted = json.loads(Path(directory, "state.json").read_text(encoding="utf-8"))
            self.assertIn("coreDisplayedScoreWindow", persisted["servers"][0]["producer"]["so"]["runtime"])
            self.assertIn("coreDisplayedScoreWindow", persisted["servers"][0]["producer"]["si"]["runtime"])
            with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "not-a-real-token"}):
                second = build_operational_runtime(config, RuntimeSnapshotStore())
            self.assertIsInstance(second.pipelines[0].producer.family("so").producer.runtime, CoreScoredSOEventRuntime)
            self.assertIsInstance(second.pipelines[0].producer.family("si").producer.runtime, CoreScoredSIRuntime)
            self.assertEqual(second.pipelines[0].producer.export_state(), first.pipelines[0].producer.export_state())

    def test_modes_keep_legacy_fail_closed_and_reject_family_mismatch(self):
        config = mixed_config()
        for mode in ("core-si", "core-so"):
            config["displayedScore"] = {"mode": mode}
            with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "not-a-real-token"}):
                with self.assertRaisesRegex(ValueError, "use 'core' for mixed"):
                    build_operational_runtime(config, RuntimeSnapshotStore())
        config["displayedScore"] = {"mode": "invalid"}
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "not-a-real-token"}):
            original = build_operational_runtime(config, RuntimeSnapshotStore())
        self.assertNotIsInstance(original.pipelines[0].producer.family("so").producer.runtime, CoreScoredSOEventRuntime)
        self.assertNotIsInstance(original.pipelines[0].producer.family("si").producer.runtime, CoreScoredSIRuntime)


if __name__ == "__main__":
    unittest.main()
