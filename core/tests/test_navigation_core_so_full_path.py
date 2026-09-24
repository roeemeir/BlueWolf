"""Navigation-only SO integration: Core must own all derived outcomes.

Synthetic input replaces only raw navigation. The template and explicit route
instance/member bindings are product configuration; confirmed route geometry,
structural group, selected-template scores and events must be discovered by the
running Core. This is NOT a customer Influx or browser/report E2E test.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
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

START = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)


class NavigationToScoredSOFullPathTests(unittest.TestCase):
    def test_two_distinct_navigation_routes_reach_actual_so_group_score_and_event(self):
        with tempfile.TemporaryDirectory() as directory:
            config = _config(str(Path(directory) / "navigation.sqlite"))
            config["servers"] = config["servers"][:1]
            config.pop("siTemplates")
            config.pop("siVehicleTypes")
            config["displayedScore"] = {"mode": "core-so"}
            config["polling"]["idleProbeSeconds"] = 5
            radius_m, straight_m, period_s = 60.0, 220.0, 90.0
            speed = (2 * straight_m + 2 * math.pi * radius_m) / period_s
            # Two distinct physical neighboring SO tracks with positive gap.
            # Route IDs and geometry are still independently derived by Core.
            config["navigationSource"]["vehicles"] = [
                {
                    "serverId": 1, "vehicleNumber": number,
                    "centerLatitude": latitude, "centerLongitude": 34.79,
                    "radiusMeters": radius_m, "straightLengthMeters": straight_m,
                    "periodSeconds": period_s, "phaseFraction": phase,
                    "shape": "hippodrome",
                }
                for number, latitude, phase in (
                    (111, 32.08, 0.0), (112, 32.0815, 0.5),
                )
            ]
            config["templates"] = [{
                "id": "two-so-routes", "name": "SO two neighboring route instances",
                "default": True,
                "routes": [
                    {"id": "r1", "kind": "single", "slots": [
                        {"id": "first", "vehicleType": "A", "quarter": "Q0"},
                    ]},
                    {"id": "r2", "kind": "single", "slots": [
                        {"id": "second", "vehicleType": "A", "quarter": "Q2"},
                    ]},
                ],
            }]
            config["servers"][0]["groups"] = [{
                "name": "Real Core SO", "arena": "test-only", "color": "#3366cc",
                "routeInstances": [
                    {"id": "r1", "kind": "single"},
                    {"id": "r2", "kind": "single"},
                ],
                "members": [
                    {"vehicleId": number, "vehicleType": "A", "routeInstanceId": route,
                     "workSpeedMps": speed}
                    for number, route in ((111, "r1"), (112, "r2"))
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
                    self.assertEqual({route["routeInstanceId"] for route in group["detectedRoutes"]}, {"r1", "r2"})
                    self.assertTrue(all(route["family"] == "so" for route in group["detectedRoutes"]))
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
