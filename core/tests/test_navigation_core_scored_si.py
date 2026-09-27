"""Real SI score provenance through the opt-in live source/engine/HTTP bridge.

Only GPS/velocity input is synthetic. The running Core must independently
confirm geometry/grouping, calculate group scores and open the event. No score,
route, group, event or server snapshot is inserted directly into the store.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_runtime_adapter.core_scored_si import CoreScoredSIRuntime
from bluewolf_runtime_adapter.family_environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.service import BlueWolfRuntimeASGI, RuntimeSnapshotStore
from test_navigation_http_history import _get
from test_navigation_simulation_pipeline import _config

START = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)


class NavigationCoreScoredSITests(unittest.TestCase):
    def test_live_core_group_score_flows_to_event_web_http_and_checkpoint_without_second_score_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            config = _config(str(Path(directory) / "nav-test.sqlite"))
            config["servers"] = config["servers"][:1]
            config["displayedScore"] = {"mode": "core-si"}
            config["polling"]["idleProbeSeconds"] = 5
            config["siVehicleTypes"][0]["workSpeedMps"] = 2.0 * math.pi * 100.0 / 60.0
            for vehicle in config["navigationSource"]["vehicles"]:
                vehicle["periodSeconds"] = 60.0
                vehicle["radiusMeters"] = 100.0
            store = RuntimeSnapshotStore()
            with patch.dict(os.environ, {
                "BLUEWOLF_TEST_MODE": "1",
                "BLUEWOLF_TEST_STORAGE_ROOT": directory,
                "BLUEWOLF_SAMPLE_ARCHIVE_PATH": "",
                "BLUEWOLF_OPERATIONAL_STATE_PATH": "",
                "BLUEWOLF_WORKSPACE_DB": "",
            }):
                loop = build_operational_runtime(config, store)
            pipeline = loop.pipelines[0]
            runtime = pipeline.producer.family("si").producer.runtime
            self.assertIsInstance(runtime, CoreScoredSIRuntime)
            adapter = pipeline.coordinator.reader.adapter
            seen_valid = []
            seen_invalid = []
            for elapsed in range(10, 171, 5):
                now = START + timedelta(seconds=elapsed)
                adapter.clock = lambda current=now: current
                tick = loop.tick(now)
                self.assertEqual(tick.errors, {}, f"Core failed at {elapsed}s: {tick.errors}")
                self.assertIsNotNone(tick.results[1].poll)
                snapshot = store.get("1")
                if snapshot is None or not snapshot["groupList"]:
                    continue
                self.assertEqual(snapshot["source"]["navigationOrigin"], "simulation")
                for group in snapshot["groupList"]:
                    self.assertEqual(group["family"], "SI")
                    self.assertIn("event", group)
                    core_displayed = runtime.latest_displayed(
                        group["id"],
                        datetime.fromisoformat(group["observedAt"].replace("Z", "+00:00")),
                    )
                    self.assertEqual(group["scoreValid"], core_displayed.valid)
                    if group["scoreValid"]:
                        self.assertTrue(all(member["scoreValid"] for member in group["members"]))
                        self.assertAlmostEqual(group["total"], core_displayed.score)
                        self.assertTrue(0 <= group["total"] <= 100)
                        self.assertEqual(group["event"]["contextKey"], runtime.event_engine.snapshot(group["id"]).context_key)
                        seen_valid.append(group)
                    else:
                        self.assertFalse(group.get("alert"))
                        seen_invalid.append(group)
            self.assertTrue(seen_invalid, "Core warmup never produced an invalid-score group")
            self.assertTrue(seen_valid, "Core never produced a genuine valid group score")
            latest = store.get("1")
            self.assertTrue(latest["groupList"][0]["scoreValid"])
            self.assertTrue(any(group["scoreValid"] for point in store.history("1") for group in point["groups"]))
            api = BlueWolfRuntimeASGI(store, token="test-only", clock=lambda: START + timedelta(seconds=171))
            status, unauthorized = asyncio.run(_get(api, "/v1/live-runtime", "serverId=1"))
            self.assertEqual((status, unauthorized["error"]), (401, "unauthorized"))
            status, observed = asyncio.run(_get(api, "/v1/live-runtime", "serverId=1", token="test-only"))
            self.assertEqual(status, 200)
            self.assertTrue(observed["groupList"][0]["scoreValid"])
            self.assertEqual(observed["groupList"][0]["total"], latest["groupList"][0]["total"])
            status, history = asyncio.run(_get(api, "/v1/live-runtime/history", "serverId=1", token="test-only"))
            self.assertEqual(status, 200)
            self.assertTrue(any(group["scoreValid"] for point in history["points"] for group in point["groups"]))
            original_family = pipeline.producer.family("si")
            checkpoint = original_family.export_state()
            with patch.dict(os.environ, {
                "BLUEWOLF_TEST_MODE": "1",
                "BLUEWOLF_TEST_STORAGE_ROOT": directory,
                "BLUEWOLF_SAMPLE_ARCHIVE_PATH": "",
                "BLUEWOLF_OPERATIONAL_STATE_PATH": "",
                "BLUEWOLF_WORKSPACE_DB": "",
            }):
                restored_loop = build_operational_runtime(config, RuntimeSnapshotStore())
            restored_family = restored_loop.pipelines[0].producer.family("si")
            restored_family.restore_state(checkpoint)
            self.assertIsInstance(restored_family.producer.runtime, CoreScoredSIRuntime)
            self.assertEqual(
                restored_family.producer.runtime.display_window.export_state(),
                runtime.display_window.export_state(),
            )

    def test_score_mode_is_explicit_and_rejects_external_scores(self):
        runtime = CoreScoredSIRuntime.__new__(CoreScoredSIRuntime)
        # Provenance validation happens before any scoring inputs are accepted.
        with self.assertRaisesRegex(ValueError, "externally supplied"):
            CoreScoredSIRuntime.process_snapshot(
                runtime, "g", None, (), reference_period_s=60,
                displayed_group_score=90, displayed_score_valid=True,
            )


if __name__ == "__main__":
    unittest.main()
