from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_runtime_adapter.composite_producer import DiscardingRuntimeSnapshotStore
from bluewolf_runtime_adapter.mixed_environment_factory import (
    MixedRuntimeProducer,
    build_operational_runtime,
)
from bluewolf_runtime_adapter.operational_state import CheckpointedOperationalRuntimeLoop
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore


def _metrics():
    return [
        {"metric": "vehicle_identifier", "bucket": "navigation", "measurement": "vehicle_id", "field": "value"},
        {"metric": "active", "bucket": "navigation", "measurement": "active", "field": "value"},
        {"metric": "latitude_deg", "bucket": "navigation", "measurement": "latitude", "field": "value"},
        {"metric": "longitude_deg", "bucket": "navigation", "measurement": "longitude", "field": "value"},
        {"metric": "velocity_north_mps", "bucket": "navigation", "measurement": "velocity_north", "field": "value"},
        {"metric": "velocity_east_mps", "bucket": "navigation", "measurement": "velocity_east", "field": "value"},
    ]


def _config(*, persistence_path: str | None = None):
    config = {
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
        "siTemplates": [
            {
                "id": "si-default",
                "name": "SI 120",
                "default": True,
                "slots": [
                    {"id": "si-outer-0", "vehicleType": "A", "routeRole": "outer", "phaseOffset": 0.0},
                    {"id": "si-outer-120", "vehicleType": "A", "routeRole": "outer", "phaseOffset": 1.0 / 3.0},
                ],
            }
        ],
        "siVehicleTypes": [
            {"id": "A", "minId": 1, "maxId": 999, "workSpeedMps": 20.0, "siRoles": ["outer"]}
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
    if persistence_path is not None:
        config["persistence"] = {"path": persistence_path}
    return config


class MixedEnvironmentFactoryTests(unittest.TestCase):
    def test_si_configuration_upgrades_server_to_atomic_mixed_producer(self) -> None:
        store = RuntimeSnapshotStore()
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            loop = build_operational_runtime(_config(), store)

        self.assertEqual(len(loop.pipelines), 1)
        pipeline = loop.pipelines[0]
        producer = pipeline.producer
        self.assertIsInstance(producer, MixedRuntimeProducer)
        assert isinstance(producer, MixedRuntimeProducer)
        self.assertIs(producer.store, store)
        self.assertIs(producer.session, pipeline.coordinator.session)
        self.assertIs(producer.so_producer.session, pipeline.coordinator.session)
        self.assertIs(producer.si_producer.session, pipeline.coordinator.session)
        self.assertIs(producer.runtime, producer.so_producer.runtime)
        self.assertIsInstance(producer.so_producer.store, DiscardingRuntimeSnapshotStore)
        self.assertIsInstance(producer.si_producer.store, DiscardingRuntimeSnapshotStore)
        self.assertEqual(producer.si_producer.arena, "arena-a")

    def test_session_replacement_propagates_to_si_and_so_children(self) -> None:
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            loop = build_operational_runtime(_config(), RuntimeSnapshotStore())
        producer = loop.pipelines[0].producer
        assert isinstance(producer, MixedRuntimeProducer)
        replacement = object()
        producer.session = replacement
        self.assertIs(producer.so_producer.session, replacement)
        self.assertIs(producer.si_producer.session, replacement)

    def test_checkpoint_roundtrip_keeps_so_runtime_and_namespaces_family_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = str(Path(directory) / "runtime-state.json")
            config = _config(persistence_path=state_path)
            environment = {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}
            with patch.dict(os.environ, environment, clear=False):
                first = build_operational_runtime(config, RuntimeSnapshotStore())
            self.assertIsInstance(first, CheckpointedOperationalRuntimeLoop)
            assert isinstance(first, CheckpointedOperationalRuntimeLoop)
            first.save_checkpoint()

            saved = json.loads(Path(state_path).read_text(encoding="utf-8"))
            producer_state = saved["servers"][0]["producer"]
            self.assertEqual(set(producer_state), {"si", "so"})
            self.assertIn("liveRuntime", saved["servers"][0])

            with patch.dict(os.environ, environment, clear=False):
                second = build_operational_runtime(config, RuntimeSnapshotStore())
            self.assertIsInstance(second, CheckpointedOperationalRuntimeLoop)
            producer = second.pipelines[0].producer
            self.assertIsInstance(producer, MixedRuntimeProducer)
            self.assertIs(producer.session, second.pipelines[0].coordinator.session)


if __name__ == "__main__":
    unittest.main()
