from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bluewolf_core.grouping import RouteGroup
from bluewolf_core.models import RouteFamily
from bluewolf_runtime_adapter.environment_factory import (
    build_operational_runtime,
    build_operational_runtime_from_environment,
    load_operational_config,
)
from bluewolf_runtime_adapter.runtime_host import host_from_environment
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore


def _metrics():
    return [
        {"metric": "vehicle_identifier", "bucket": "navigation", "measurement": "vehicle_id", "field": "value"},
        {"metric": "active", "bucket": "navigation", "measurement": "active", "field": "value", "valueMap": {"green": True, "red": False}},
        {"metric": "latitude_deg", "bucket": "navigation", "measurement": "latitude", "field": "value"},
        {"metric": "longitude_deg", "bucket": "navigation", "measurement": "longitude", "field": "value"},
        {"metric": "velocity_north_mps", "bucket": "navigation", "measurement": "velocity_north", "field": "value"},
        {"metric": "velocity_east_mps", "bucket": "navigation", "measurement": "velocity_east", "field": "value"},
    ]


def _config():
    return {
        "influx": {
            "url": "http://influx.internal:8086",
            "organization": "bluewolf",
            "tokenEnv": "TEST_BLUEWOLF_INFLUX_TOKEN",
            "stream": {"vehicleNumberColumn": "vehicle_number", "serverColumn": "server"},
            "metrics": _metrics(),
        },
        "join": {"logicalGridSeconds": 1, "toleranceSeconds": 5},
        "polling": {
            "logicalGridSeconds": 1,
            "activePollSeconds": 5,
            "idleProbeSeconds": 300,
            "joinToleranceSeconds": 5,
            "bootstrapHistorySeconds": 2400,
        },
        "comparisonDimension": "sync",
        "displayedScore": {"mode": "invalid"},
        "templates": [
            {
                "id": "so-default",
                "name": "SO default",
                "default": True,
                "routes": [
                    {
                        "id": "r1",
                        "kind": "single",
                        "slots": [
                            {"id": "front", "vehicleType": "A", "quarter": "Q0"},
                            {"id": "back", "vehicleType": "A", "quarter": "Q2"},
                        ],
                    }
                ],
            }
        ],
        "servers": [
            {
                "id": 1,
                "tag": "server-1",
                "awakePolicy": "any-active-sample",
                "groups": [
                    {
                        "name": "SO Alpha",
                        "arena": "arena-a",
                        "color": "#3366cc",
                        "routeInstances": [{"id": "r1", "kind": "single"}],
                        "members": [
                            {"vehicleId": 11, "vehicleType": "A", "routeInstanceId": "r1", "workSpeedMps": 20.0},
                            {"vehicleId": 12, "vehicleType": "A", "routeInstanceId": "r1", "workSpeedMps": 20.0},
                        ],
                    }
                ],
            }
        ],
    }


class EnvironmentFactoryTests(unittest.TestCase):
    def test_config_builds_one_server_pipeline_without_network_access(self) -> None:
        store = RuntimeSnapshotStore()
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            loop = build_operational_runtime(_config(), store)

        self.assertEqual(len(loop.pipelines), 1)
        pipeline = loop.pipelines[0]
        self.assertEqual(pipeline.server_id, 1)
        self.assertIs(pipeline.producer.store, store)
        self.assertIs(pipeline.producer.session, pipeline.coordinator.session)
        self.assertEqual(pipeline.coordinator.server_tag_value, "server-1")
        self.assertEqual(pipeline.coordinator.cursor.config.active_poll_seconds, 5)
        self.assertEqual(pipeline.coordinator.cursor.config.idle_probe_seconds, 300)
        self.assertEqual(
            pipeline.coordinator.reader.adapter.connection.token,
            "secret",
        )

    def test_binding_matches_structural_group_by_vehicle_set_not_dynamic_group_id(self) -> None:
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            loop = build_operational_runtime(_config(), RuntimeSnapshotStore())
        producer = loop.pipelines[0].producer
        structural = RouteGroup(
            group_id="runtime-generated-group-17",
            server_id=1,
            family=RouteFamily.SO,
            member_keys=((1, 11), (1, 12)),
            route_ids=("route-11", "route-12"),
            base_period_s=100.0,
        )

        binding = producer.binding_resolver(structural)

        self.assertIsNotNone(binding)
        assert binding is not None
        self.assertEqual(binding.group_id, "runtime-generated-group-17")
        self.assertEqual(binding.arena, "arena-a")
        self.assertEqual(binding.color, "#3366cc")
        self.assertEqual(
            {item.vehicle_identifier for item in binding.members},
            {11, 12},
        )
        self.assertEqual(binding.constellation.routes[0].vehicle_types, ("A", "A"))
        displayed = producer.displayed_score_resolver(binding.group_id, structural.base_period_s)
        self.assertFalse(displayed.valid)
        self.assertIsNone(displayed.score)

    def test_secret_is_required_from_environment_and_not_json(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "Influx token environment variable is missing"):
                build_operational_runtime(_config(), RuntimeSnapshotStore())

    def test_missing_required_navigation_metric_is_rejected(self) -> None:
        config = _config()
        config["influx"]["metrics"] = [
            item for item in config["influx"]["metrics"] if item["metric"] != "velocity_east_mps"
        ]
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            with self.assertRaisesRegex(ValueError, "missing required metrics"):
                build_operational_runtime(config, RuntimeSnapshotStore())

    def test_unapproved_displayed_score_policy_is_rejected(self) -> None:
        config = _config()
        config["displayedScore"] = {"mode": "raw-total"}
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            with self.assertRaisesRegex(ValueError, "only 'invalid' is allowed"):
                build_operational_runtime(config, RuntimeSnapshotStore())

    def test_config_file_and_builtin_host_bootstrap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime.json"
            path.write_text(json.dumps(_config()), encoding="utf-8")
            loaded = load_operational_config(path)
            self.assertEqual(loaded["servers"][0]["id"], 1)
            environment = {
                "BLUEWOLF_OPERATIONAL_CONFIG": str(path),
                "TEST_BLUEWOLF_INFLUX_TOKEN": "secret",
            }
            with patch.dict(os.environ, environment, clear=True):
                loop = build_operational_runtime_from_environment(RuntimeSnapshotStore())
                host = host_from_environment(RuntimeSnapshotStore())

        self.assertEqual(len(loop.pipelines), 1)
        self.assertIsNotNone(host)
        assert host is not None
        self.assertEqual(len(host.loop.pipelines), 1)


if __name__ == "__main__":
    unittest.main()
