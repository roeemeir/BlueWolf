from __future__ import annotations

import unittest
from datetime import timedelta

from bluewolf_core.live_so_event_runtime import TemplateComparisonDimension
from bluewolf_runtime_adapter import LIVE_RUNTIME_SCHEMA_VERSION, build_so_live_runtime_snapshot
from bluewolf_runtime_adapter.contract import RuntimeVehiclePosition

from test_live_so_event_runtime import _members, _runtime
from test_live_so_scoring import START, _constellation, _route


class LiveRuntimeContractTests(unittest.TestCase):
    def test_valid_so_runtime_uses_explicit_displayed_score(self) -> None:
        runtime, _, _ = _runtime()
        route = _route(period_s=100.0)
        constellation = _constellation()
        runtime.process_snapshot(
            "g1",
            constellation,
            _members(route, 0),
            reference_period_s=100.0,
            displayed_group_score=88.0,
            displayed_score_valid=True,
        )
        result = runtime.process_snapshot(
            "g1",
            constellation,
            _members(route, 5),
            reference_period_s=100.0,
            displayed_group_score=88.0,
            displayed_score_valid=True,
        )

        payload = build_so_live_runtime_snapshot(
            result,
            server_id=1,
            observed_at_utc=START + timedelta(seconds=5),
            arena="arena-a",
            displayed_group_score=88.0,
            displayed_score_valid=True,
            comparison_dimension=TemplateComparisonDimension.SYNC,
            vehicle_ids={"m1": 1, "m2": 2},
        )

        self.assertEqual(payload["schemaVersion"], LIVE_RUNTIME_SCHEMA_VERSION)
        self.assertEqual(payload["source"]["kind"], "python-core")
        self.assertEqual(set(payload["groups"]), {"so"})
        group = payload["groups"]["so"]
        self.assertTrue(group["scoreValid"])
        self.assertEqual(group["total"], 88.0)
        self.assertGreater(group["sync"], 0.0)
        self.assertEqual(group["templateId"], "default")
        self.assertEqual([row["id"] for row in group["members"]], [1, 2])
        self.assertTrue(all(row["scoreValid"] for row in group["members"]))
        self.assertEqual(group["event"]["contextKey"], result.context_key)

    def test_optional_map_position_is_explicit_and_preserves_navigation_heading(self) -> None:
        runtime, _, _ = _runtime()
        route = _route(period_s=100.0)
        constellation = _constellation()
        runtime.process_snapshot(
            "g1",
            constellation,
            _members(route, 0),
            reference_period_s=100.0,
            displayed_group_score=88.0,
            displayed_score_valid=True,
        )
        result = runtime.process_snapshot(
            "g1",
            constellation,
            _members(route, 5),
            reference_period_s=100.0,
            displayed_group_score=88.0,
            displayed_score_valid=True,
        )

        payload = build_so_live_runtime_snapshot(
            result,
            server_id=1,
            observed_at_utc=START + timedelta(seconds=5),
            arena="arena-a",
            displayed_group_score=88.0,
            displayed_score_valid=True,
            comparison_dimension=TemplateComparisonDimension.SYNC,
            vehicle_ids={"m1": 1, "m2": 2},
            position_by_member={
                "m1": RuntimeVehiclePosition(32.0853, 34.7818, 370.0),
            },
        )

        members = payload["groups"]["so"]["members"]
        first = next(row for row in members if row["id"] == 1)
        second = next(row for row in members if row["id"] == 2)
        self.assertEqual(first["latitude"], 32.0853)
        self.assertEqual(first["longitude"], 34.7818)
        self.assertEqual(first["headingDeg"], 10.0)
        self.assertNotIn("latitude", second)
        self.assertNotIn("longitude", second)
        self.assertNotIn("headingDeg", second)

    def test_invalid_displayed_score_never_falls_back_to_raw_group_total(self) -> None:
        runtime, _, _ = _runtime()
        route = _route(period_s=100.0)
        constellation = _constellation()
        runtime.process_snapshot(
            "g1",
            constellation,
            _members(route, 0),
            reference_period_s=100.0,
            displayed_group_score=None,
            displayed_score_valid=False,
        )
        result = runtime.process_snapshot(
            "g1",
            constellation,
            _members(route, 5),
            reference_period_s=100.0,
            displayed_group_score=None,
            displayed_score_valid=False,
        )
        self.assertIsNotNone(result.live_scoring.scoring)

        payload = build_so_live_runtime_snapshot(
            result,
            server_id=1,
            observed_at_utc=START + timedelta(seconds=5),
            arena="arena-a",
            displayed_group_score=None,
            displayed_score_valid=False,
            comparison_dimension=TemplateComparisonDimension.SYNC,
            vehicle_ids={"m1": 1, "m2": 2},
        )
        group = payload["groups"]["so"]
        self.assertFalse(group["scoreValid"])
        self.assertEqual(group["total"], 0.0)
        self.assertEqual(group["sync"], 0.0)
        self.assertEqual(group["route"], 0.0)
        self.assertEqual(group["confidence"], 0.0)

    def test_template_suggestion_is_serialized_without_inventing_duration(self) -> None:
        runtime, _, _ = _runtime()
        route = _route(period_s=100.0)
        constellation = _constellation()
        result = None
        for seconds in range(0, 130, 5):
            result = runtime.process_snapshot(
                "g1",
                constellation,
                _members(route, seconds),
                reference_period_s=100.0,
                displayed_group_score=90.0,
                displayed_score_valid=True,
            )
        assert result is not None
        self.assertEqual(result.event.snapshot.suggested_template_id, "same")

        payload = build_so_live_runtime_snapshot(
            result,
            server_id=1,
            observed_at_utc=START + timedelta(seconds=125),
            arena="arena-a",
            displayed_group_score=90.0,
            displayed_score_valid=True,
            comparison_dimension=TemplateComparisonDimension.SYNC,
            vehicle_ids={"m1": 1, "m2": 2},
        )
        recommendation = payload["groups"]["so"]["recommendation"]
        self.assertEqual(recommendation["templateId"], "same")
        self.assertEqual(recommendation["activeTemplateId"], "default")
        self.assertEqual(recommendation["dimension"], "sync")
        self.assertGreater(recommendation["improvementPoints"], 30.0)
        self.assertTrue(recommendation["ready"])
        self.assertNotIn("sustainedSeconds", recommendation)


if __name__ == "__main__":
    unittest.main()
