"""Three-server TEST input exercises the full scored SI checkpoint/replay path.

Only raw navigation is generated. Group IDs, scores, events, snapshot and
history come from production Core and runtime. A full operational checkpoint
(not merely family export/import) must preserve their timeline on restart.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_runtime_adapter.family_environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.operational_state import CheckpointedOperationalRuntimeLoop
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore
from test_navigation_simulation_pipeline import _config

START = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)


class CoreSICheckpointE2ETests(unittest.TestCase):
    def test_three_independent_servers_keep_real_scores_and_events_after_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = str(Path(directory) / "nav-test.sqlite")
            checkpoint_path = Path(directory) / "operational-state.json"
            config = _config(archive)
            config["displayedScore"] = {"mode": "core-si"}
            config["persistence"] = {"path": str(checkpoint_path)}
            config["polling"]["idleProbeSeconds"] = 5
            config["siVehicleTypes"][0]["workSpeedMps"] = 2.0 * math.pi * 100.0 / 60.0
            for vehicle in config["navigationSource"]["vehicles"]:
                vehicle["periodSeconds"] = 60.0
                vehicle["radiusMeters"] = 100.0

            environment = {
                "BLUEWOLF_TEST_MODE": "1",
                "BLUEWOLF_TEST_STORAGE_ROOT": directory,
                "BLUEWOLF_SAMPLE_ARCHIVE_PATH": "",
                "BLUEWOLF_OPERATIONAL_STATE_PATH": "",
                "BLUEWOLF_WORKSPACE_DB": "",
                "BLUEWOLF_INFLUX_TOKEN": "",
            }
            store = RuntimeSnapshotStore()
            with patch.dict(os.environ, environment):
                loop = build_operational_runtime(config, store)
            self.assertIsInstance(loop, CheckpointedOperationalRuntimeLoop)
            self.assertEqual([pipeline.server_id for pipeline in loop.pipelines], [1, 2, 3])
            source = loop.pipelines[0].coordinator.reader.adapter
            self.assertTrue(all(p.coordinator.reader.adapter is source for p in loop.pipelines))
            for elapsed in range(10, 171, 5):
                now = START + timedelta(seconds=elapsed)
                source.clock = lambda current=now: current
                tick = loop.tick(now)
                self.assertEqual(tick.errors, {}, f"failed before restart at {elapsed}: {tick.errors}")

            before: dict[int, tuple[str, str, float, dict]] = {}
            for pipeline in loop.pipelines:
                server_id = pipeline.server_id
                latest = store.get(str(server_id))
                self.assertIsNotNone(latest, f"server {server_id} did not publish")
                self.assertEqual(latest["source"]["navigationOrigin"], "simulation")
                self.assertEqual(len(latest["groupList"]), 1)
                group = latest["groupList"][0]
                self.assertEqual(group["family"], "SI")
                self.assertTrue(group["scoreValid"], f"server {server_id} never scored")
                self.assertEqual(len(group["members"]), 2)
                self.assertTrue(all(row["scoreValid"] for row in group["members"]))
                self.assertEqual({row["id"] for row in group["members"]}, {
                    server_id * 100 + 1, server_id * 100 + 2,
                })
                self.assertIsInstance(group["total"], (int, float))
                self.assertTrue(0 <= group["total"] <= 100)
                event = group["event"]
                self.assertTrue(event["id"] and event["contextKey"] and event["startedAt"])
                family = pipeline.producer.family("si")
                before[server_id] = (
                    group["id"], event["id"], group["total"],
                    family.producer.runtime.display_window.export_state(),
                )
            self.assertEqual(len({row[0] for row in before.values()}), 3)
            loop.save_checkpoint()
            self.assertTrue(checkpoint_path.is_file())

            # A NEW service, CoreSession, cursor and family host restore the
            # persisted checkpoint, not an in-memory copy of a family object.
            fresh_store = RuntimeSnapshotStore()
            with patch.dict(os.environ, environment):
                restored = build_operational_runtime(config, fresh_store)
            self.assertIsInstance(restored, CheckpointedOperationalRuntimeLoop)
            for pipeline in restored.pipelines:
                server_id = pipeline.server_id
                family = pipeline.producer.family("si")
                self.assertEqual(
                    family.producer.runtime.display_window.export_state(),
                    before[server_id][3],
                )
                historical = fresh_store.history(str(server_id))
                self.assertTrue(historical)
                self.assertEqual(historical[-1]["source"]["navigationOrigin"], "simulation")
                self.assertTrue(historical[-1]["groups"][0]["scoreValid"])
            later = START + timedelta(seconds=175)
            restored_source = restored.pipelines[0].coordinator.reader.adapter
            restored_source.clock = lambda: later
            tick = restored.tick(later)
            self.assertEqual(tick.errors, {}, f"failed after checkpoint restart: {tick.errors}")
            for server_id in (1, 2, 3):
                self.assertIsNotNone(tick.results[server_id].poll)
                current = fresh_store.get(str(server_id))
                self.assertIsNotNone(current)
                group = current["groupList"][0]
                self.assertTrue(group["scoreValid"])
                self.assertEqual(group["id"], before[server_id][0])
                self.assertEqual(group["event"]["id"], before[server_id][1])
                self.assertEqual(current["source"]["navigationOrigin"], "simulation")
                self.assertEqual(current["source"]["syntheticNavigation"], True)
                self.assertEqual({row["id"] for row in group["members"]}, {
                    server_id * 100 + 1, server_id * 100 + 2,
                })


if __name__ == "__main__":
    unittest.main()
