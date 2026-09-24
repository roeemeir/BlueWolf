"""Truth-backed live runtime integration beyond source ingestion and route detection.

Only the navigation samples are synthetic. The structural route/group, SI member
metrics, event and publication must be produced by the existing live components.
Current displayedScore.mode=invalid is intentionally not concealed by this test.
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
    def test_real_si_group_and_member_scores_reach_runtime_publication(self):
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
            core_group_evidence = False
            # The real cursor's safe end is now minus five seconds. Begin
            # after the first source fixes so the initial probe sees activity.
            for elapsed in range(10, 171, 5):
                now = START + timedelta(seconds=elapsed)
                adapter.clock = lambda current=now: current
                tick = loop.tick(now)
                self.assertEqual(tick.errors, {}, f"real runtime failed at t={elapsed}: {tick.errors}")
                self.assertIn(1, tick.results)
                self.assertIsNotNone(tick.results[1].poll)
                if loop.pipelines[0].coordinator.session.grouping_snapshot().groups:
                    core_group_evidence = True
                latest = store.get("1")
                if latest is not None:
                    self.assertEqual(latest["source"]["kind"], "python-core")
                    self.assertIs(latest["source"]["syntheticNavigation"], True)
                    published_groups.extend(latest.get("groupList", []))
            self.assertTrue(core_group_evidence, "Core did not create a structural group")
            self.assertTrue(published_groups, "Core SI group never reached the runtime store")
            valid_member_groups = [
                group for group in published_groups
                if group["family"] == "SI"
                and len(group["members"]) == 2
                and all(member.get("scoreValid") is True for member in group["members"])
            ]
            self.assertTrue(valid_member_groups, "Real SI member scoring never became ready")
            # Existing displayed-score policy remains invalid: group-level UI
            # and alert validity are a separately tracked blocking integration.
            self.assertTrue(all(group["scoreValid"] is False for group in valid_member_groups))


if __name__ == "__main__":
    unittest.main()
