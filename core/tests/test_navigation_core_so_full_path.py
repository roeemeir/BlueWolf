"""Navigation-only SO integration: route, group, score and event MUST come from Core.

No fixture injects routes, group IDs, template selections, scores or events. The
explicit SO configuration supplies only the product-owned template and member
bindings. Synthetic input is permitted solely as TEST raw navigation and must
remain visibly marked in the actual published snapshot/history.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_core.models import RouteFamily
from bluewolf_runtime_adapter.family_environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore
from test_navigation_simulation_pipeline import _config

START = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)


class NavigationToScoredSOFullPathTests(unittest.TestCase):
    def test_navigation_only_must_confirm_so_and_publish_core_score_event(self):
        with tempfile.TemporaryDirectory() as directory:
            config = _config(str(Path(directory) / "navigation.sqlite"))
            config["servers"] = config["servers"][:1]
            config.pop("siTemplates")
            config.pop("siVehicleTypes")
            config["displayedScore"] = {"mode": "core-so"}
            config["polling"]["idleProbeSeconds"] = 5
            radius_m, straight_m, period_s = 60.0, 220.0, 90.0
            speed = (2 * straight_m + 2 * math.pi * radius_m) / period_s
            config["navigationSource"]["vehicles"] = [
                {
                    "serverId": 1, "vehicleNumber": number,
                    "centerLatitude": 32.08, "centerLongitude": 34.79,
                    "radiusMeters": radius_m, "straightLengthMeters": straight_m,
                    "periodSeconds": period_s, "phaseFraction": phase,
                    "shape": "hippodrome",
                }
                for number, phase in ((111, 0.0), (112, 0.5))
            ]
            config["templates"] = [{
                "id": "hippodrome-opposite", "name": "SO opposite phase",
                "default": True,
                "routes": [{
                    "id": "r1", "kind": "single", "slots": [
                        {"id": "front", "vehicleType": "A", "quarter": "Q0"},
                        {"id": "rear", "vehicleType": "A", "quarter": "Q2"},
                    ],
                }],
            }]
            config["servers"][0]["groups"] = [{
                "name": "Real Core SO", "arena": "test-only", "color": "#3366cc",
                "routeInstances": [{"id": "r1", "kind": "single"}],
                "members": [
                    {"vehicleId": number, "vehicleType": "A", "routeInstanceId": "r1", "workSpeedMps": speed}
                    for number in (111, 112)
                ],
            }]
            environment = {
                "BLUEWOLF_TEST_MODE": "1", "BLUEWOLF_TEST_STORAGE_ROOT": directory,
                "BLUEWOLF_SAMPLE_ARCHIVE_PATH": "", "BLUEWOLF_OPERATIONAL_STATE_PATH": "",
                "BLUEWOLF_WORKSPACE_DB": "", "BLUEWOLF_INFLUX_TOKEN": "",
            }
            store = RuntimeSnapshotStore()
            with patch.dict(os.environ, environment):
                loop = build_operational_runtime(config, store)
            pipeline = loop.pipelines[0]
            adapter = pipeline.coordinator.reader.adapter
            seen_confirmed = False
            seen_scored = False
            for elapsed in range(10, 331, 5):
                now = START + timedelta(seconds=elapsed)
                adapter.clock = lambda current=now: current
                tick = loop.tick(now)
                self.assertEqual(tick.errors, {}, f"SO pipeline error at {elapsed}s: {tick.errors}")
                confirmed = [
                    group for group in pipeline.coordinator.session.grouping_snapshot().groups
                    if group.server_id == 1 and group.family is RouteFamily.SO
                    and {key[1] for key in group.member_keys} == {111, 112}
                ]
                if not confirmed:
                    continue
                seen_confirmed = True
                for number in (111, 112):
                    route = pipeline.coordinator.session.confirmed_route(1, number)
                    self.assertIsNotNone(route)
                    self.assertIs(route.family, RouteFamily.SO)
                latest = store.get("1")
                if latest is None:
                    continue
                self.assertEqual(latest["source"]["kind"], "python-core")
                self.assertEqual(latest["source"]["navigationOrigin"], "simulation")
                self.assertIs(latest["source"]["syntheticNavigation"], True)
                groups = [row for row in latest["groupList"] if row["family"] == "SO"]
                if not groups:
                    continue
                for group in groups:
                    self.assertIn(group["id"], {item.group_id for item in confirmed})
                    self.assertEqual({member["id"] for member in group["members"]}, {111, 112})
                    self.assertTrue(group["detectedRoutes"])
                    self.assertTrue(all(route["family"] == "SO" for route in group["detectedRoutes"]))
                    if group["scoreValid"]:
                        self.assertTrue(group["event"]["id"])
                        self.assertTrue(all(member["scoreValid"] for member in group["members"]))
                        self.assertGreaterEqual(group["total"], 0)
                        self.assertLessEqual(group["total"], 100)
                        self.assertAlmostEqual(
                            group["total"], pipeline.producer.family("so").producer.runtime.latest_displayed(
                                group["id"], datetime.fromisoformat(group["observedAt"].replace("Z", "+00:00"))
                            ).score,
                        )
                        seen_scored = True
                if seen_scored:
                    break
            self.assertTrue(seen_confirmed, "Core never grouped the navigation-derived SO routes")
            self.assertTrue(seen_scored, "actual scored SO group/event never reached the runtime publisher")
            self.assertTrue(store.history("1"))
            self.assertTrue(all(
                point["source"]["navigationOrigin"] == "simulation"
                and point["source"]["syntheticNavigation"] is True
                for point in store.history("1")
            ))


if __name__ == "__main__":
    unittest.main()
