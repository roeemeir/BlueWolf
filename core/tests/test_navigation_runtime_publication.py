"""Truth-backed live runtime integration beyond source ingestion and route detection.

Only navigation samples are synthetic. Routes, structural groups, member scores,
events and published snapshots must come from the existing live Python Core.
The product's unavailable displayed-group-score policy is not concealed.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_runtime_adapter.family_environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore
from test_navigation_simulation_pipeline import _config

START = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)


class NavigationRuntimePublicationTests(unittest.TestCase):
    def test_real_si_group_member_scores_and_event_reach_runtime_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            config = _config(str(Path(directory) / "navigation.sqlite"))
            config["servers"] = config["servers"][:1]
            config["polling"]["idleProbeSeconds"] = 5  # Explicit fast QA probe, not an operational default.
            config["siVehicleTypes"][0]["workSpeedMps"] = 2.0 * 3.141592653589793 * 100.0 / 60.0
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
            adapter = loop.pipelines[0].coordinator.reader.adapter
            published_groups = []
            core_group_ids: set[str] = set()
            for elapsed in range(10, 171, 5):
                now = START + timedelta(seconds=elapsed)
                adapter.clock = lambda current=now: current
                tick = loop.tick(now)
                self.assertEqual(tick.errors, {}, f"runtime failed at t={elapsed}: {tick.errors}")
                self.assertIn(1, tick.results)
                self.assertIsNotNone(tick.results[1].poll)
                core_group_ids.update(
                    group.group_id for group in loop.pipelines[0].coordinator.session.grouping_snapshot().groups
                    if group.server_id == 1
                )
                latest = store.get("1")
                if latest is not None:
                    self.assertEqual(latest["source"]["kind"], "python-core")
                    self.assertIs(latest["source"]["syntheticNavigation"], True)
                    published_groups.extend(latest.get("groupList", []))
            self.assertTrue(core_group_ids, "Core did not create a structural group")
            self.assertTrue(published_groups, "Core SI group never reached the runtime store")
            self.assertTrue(all(group["id"] in core_group_ids for group in published_groups))
            events = [group["event"] for group in published_groups if "event" in group]
            self.assertTrue(events, "Core event lifecycle never reached runtime publication")
            self.assertTrue(all(event["active"] is True and event["id"] for event in events))
            self.assertTrue(all(event["contextKey"] and event["startedAt"] for event in events))
            valid_member_groups = [
                group for group in published_groups
                if group["family"] == "SI"
                and len(group["members"]) == 2
                and all(member.get("scoreValid") is True for member in group["members"])
            ]
            self.assertTrue(valid_member_groups, "Real SI member scoring never became ready")
            self.assertTrue(all(
                0.0 <= member["score"] <= 100.0
                and 0.0 <= member["sync"] <= 100.0
                and 0.0 <= member["route"] <= 100.0
                for group in valid_member_groups for member in group["members"]
            ))
            # No fake group score or low-score alert is ever substituted when
            # the displayed-score bridge has not produced valid evidence.
            self.assertTrue(all(group["scoreValid"] is False for group in valid_member_groups))
            self.assertTrue(all("alert" not in group for group in valid_member_groups))


if __name__ == "__main__":
    unittest.main()
