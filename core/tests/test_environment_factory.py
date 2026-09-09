from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bluewolf_core.grouping import RouteGroup
from bluewolf_core.models import RouteFamily, VehicleSample
from bluewolf_runtime_adapter.environment_factory import (
    build_operational_runtime,
    build_operational_runtime_from_environment,
    load_operational_config,
)
from bluewolf_runtime_adapter.operational_state import (
    CheckpointedOperationalRuntimeLoop,
    OperationalStateCompatibilityError,
)
from bluewolf_runtime_adapter.runtime_host import host_from_environment
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore


NOW = datetime(2026, 9, 9, 19, 0, tzinfo=UTC)


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
                "awakePolicy": "any-active-latest-snapshot",
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


def _sample(at: datetime, vehicle_id: int, active: bool) -> VehicleSample:
    return VehicleSample(
        sample_time_utc=at,
        server_id=1,
        vehicle_number=vehicle_id,
        vehicle_identifier=vehicle_id,
        active=active,
        latitude_deg=32.0,
        longitude_deg=34.8,
        velocity_north_mps=1.0,
        velocity_east_mps=0.0,
    )


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

    def test_awake_policy_uses_only_latest_joined_snapshot(self) -> None:
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            loop = build_operational_runtime(_config(), RuntimeSnapshotStore())
        resolver = loop.pipelines[0].coordinator.awake_resolver
        samples = (
            _sample(NOW - timedelta(minutes=30), 11, True),
            _sample(NOW, 11, False),
            _sample(NOW, 12, False),
        )
        self.assertFalse(resolver(samples, None, None))
        samples_with_latest_active = samples + (_sample(NOW, 13, True),)
        self.assertTrue(resolver(samples_with_latest_active, None, None))

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
        displayed = producer.displayed_score_resolver(binding.group_id, NOW)
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

    def test_non_finite_numeric_configuration_is_rejected(self) -> None:
        config = _config()
        config["servers"][0]["groups"][0]["members"][0]["workSpeedMps"] = float("nan")
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            with self.assertRaisesRegex(ValueError, "must be finite"):
                build_operational_runtime(config, RuntimeSnapshotStore())

    def test_unapproved_displayed_score_policy_is_rejected(self) -> None:
        config = _config()
        config["displayedScore"] = {"mode": "raw-total"}
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            with self.assertRaisesRegex(ValueError, "only 'invalid' is allowed"):
                build_operational_runtime(config, RuntimeSnapshotStore())

    def test_persistence_roundtrip_restores_watermark_runtime_and_active_groups(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "operational-state.json"
            config = _config()
            config["persistence"] = {"path": str(state_path)}
            environment = {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}
            first_store = RuntimeSnapshotStore()
            with patch.dict(os.environ, environment, clear=False):
                first = build_operational_runtime(config, first_store)
            self.assertIsInstance(first, CheckpointedOperationalRuntimeLoop)
            assert isinstance(first, CheckpointedOperationalRuntimeLoop)
            pipeline = first.pipelines[0]
            pipeline.coordinator.cursor.restore_state(
                {
                    "last_processed_utc": NOW.isoformat().replace("+00:00", "Z"),
                    "next_due_utc": (NOW + timedelta(seconds=5)).isoformat().replace("+00:00", "Z"),
                    "awake": True,
                }
            )
            pipeline.producer.restore_state(
                {"structurally_active_group_ids": ["g-persisted"]}
            )
            first_store.publish(
                {
                    "schemaVersion": "bluewolf.live-runtime.v1",
                    "serverId": "1",
                    "observedAt": NOW.isoformat().replace("+00:00", "Z"),
                    "source": {"kind": "python-core", "health": "healthy"},
                    "groups": {},
                }
            )
            first.save_checkpoint()
            self.assertTrue(state_path.exists())
            self.assertEqual(list(state_path.parent.glob("*.tmp")), [])

            restored_store = RuntimeSnapshotStore()
            with patch.dict(os.environ, environment, clear=False):
                restored = build_operational_runtime(config, restored_store)
            self.assertIsInstance(restored, CheckpointedOperationalRuntimeLoop)
            restored_pipeline = restored.pipelines[0]
            self.assertEqual(restored_pipeline.coordinator.cursor.last_processed_utc, NOW)
            self.assertEqual(
                restored_pipeline.coordinator.cursor.next_due_utc,
                NOW + timedelta(seconds=5),
            )
            self.assertTrue(restored_pipeline.coordinator.cursor.awake)
            self.assertEqual(
                restored_pipeline.producer.export_state()["structurally_active_group_ids"],
                ["g-persisted"],
            )
            self.assertIs(restored_pipeline.producer.session, restored_pipeline.coordinator.session)
            self.assertIsNotNone(restored_store.get("1"))

    def test_persistence_rejects_state_from_changed_operational_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "operational-state.json"
            config = _config()
            config["persistence"] = {"path": str(state_path)}
            environment = {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}
            with patch.dict(os.environ, environment, clear=False):
                first = build_operational_runtime(config, RuntimeSnapshotStore())
            assert isinstance(first, CheckpointedOperationalRuntimeLoop)
            first.save_checkpoint()

            changed = _config()
            changed["persistence"] = {"path": str(state_path)}
            changed["servers"][0]["tag"] = "different-source"
            with patch.dict(os.environ, environment, clear=False):
                with self.assertRaisesRegex(
                    OperationalStateCompatibilityError,
                    "fingerprint",
                ):
                    build_operational_runtime(changed, RuntimeSnapshotStore())

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

    def test_shipped_operational_example_builds_without_network_access(self) -> None:
        repository_root = Path(__file__).resolve().parents[2]
        path = repository_root / "deploy" / "runtime" / "operational-config.example.json"
        config = load_operational_config(path)
        with patch.dict(os.environ, {"BLUEWOLF_INFLUX_TOKEN": "example-secret"}, clear=False):
            loop = build_operational_runtime(config, RuntimeSnapshotStore())

        self.assertEqual(len(loop.pipelines), 1)
        pipeline = loop.pipelines[0]
        self.assertEqual(pipeline.server_id, 1)
        self.assertEqual(pipeline.coordinator.server_tag_value, "server-1")
        self.assertEqual(
            pipeline.coordinator.reader.adapter.connection.url,
            "http://influxdb2.internal:8086",
        )
        self.assertEqual(
            pipeline.coordinator.reader.adapter.connection.token,
            "example-secret",
        )


if __name__ == "__main__":
    unittest.main()
