from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_runtime_adapter.composite_producer import DiscardingRuntimeSnapshotStore
from bluewolf_runtime_adapter.family_environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.family_runtime import (
    FAMILY_RUNTIME_STATE_SCHEMA_VERSION,
    FamilyRuntimeHost,
    SIFamilyRuntimeAdapter,
    SOFamilyRuntimeAdapter,
)
from bluewolf_runtime_adapter.operational_state import (
    CheckpointedOperationalRuntimeLoop,
    OPERATIONAL_STATE_SCHEMA_VERSION,
)
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


class SymmetricFamilyEnvironmentFactoryTests(unittest.TestCase):
    def test_si_and_so_are_first_class_sibling_families(self) -> None:
        store = RuntimeSnapshotStore()
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            loop = build_operational_runtime(_config(), store)

        self.assertEqual(len(loop.pipelines), 1)
        pipeline = loop.pipelines[0]
        host = pipeline.producer
        self.assertIsInstance(host, FamilyRuntimeHost)
        assert isinstance(host, FamilyRuntimeHost)
        self.assertEqual(set(host.family_names), {"si", "so"})
        self.assertIs(host.store, store)
        self.assertIs(host.session, pipeline.coordinator.session)
        si = host.family("si")
        so = host.family("so")
        self.assertIsInstance(si, SIFamilyRuntimeAdapter)
        self.assertIsInstance(so, SOFamilyRuntimeAdapter)
        self.assertIs(si.session, pipeline.coordinator.session)
        self.assertIs(so.session, pipeline.coordinator.session)
        self.assertIsInstance(si.store, DiscardingRuntimeSnapshotStore)
        self.assertIsInstance(so.store, DiscardingRuntimeSnapshotStore)
        self.assertFalse(hasattr(host, "runtime"), "server host must not expose SO as preferred runtime")

    def test_session_replacement_propagates_equally_to_all_families(self) -> None:
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            loop = build_operational_runtime(_config(), RuntimeSnapshotStore())
        host = loop.pipelines[0].producer
        assert isinstance(host, FamilyRuntimeHost)
        replacement = object()
        host.session = replacement
        for name in host.family_names:
            self.assertIs(host.family(name).session, replacement)

    def test_checkpoint_v2_namespaces_algorithm_state_inside_each_family(self) -> None:
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
            self.assertEqual(saved["schemaVersion"], OPERATIONAL_STATE_SCHEMA_VERSION)
            server = saved["servers"][0]
            self.assertNotIn("liveRuntime", server)
            producer_state = server["producer"]
            self.assertEqual(set(producer_state), {"si", "so"})
            for family in ("si", "so"):
                self.assertEqual(
                    producer_state[family]["schemaVersion"],
                    FAMILY_RUNTIME_STATE_SCHEMA_VERSION,
                )
                self.assertEqual(producer_state[family]["family"], family)
                self.assertIsInstance(producer_state[family]["producer"], dict)
                self.assertIsInstance(producer_state[family]["runtime"], dict)

            with patch.dict(os.environ, environment, clear=False):
                second = build_operational_runtime(config, RuntimeSnapshotStore())
            host = second.pipelines[0].producer
            self.assertIsInstance(host, FamilyRuntimeHost)
            assert isinstance(host, FamilyRuntimeHost)
            self.assertIs(host.session, second.pipelines[0].coordinator.session)
            self.assertEqual(set(host.family_names), {"si", "so"})

    def test_so_only_configuration_still_uses_the_same_family_host(self) -> None:
        config = _config()
        config.pop("siTemplates")
        config.pop("siVehicleTypes")
        with patch.dict(os.environ, {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}, clear=False):
            loop = build_operational_runtime(config, RuntimeSnapshotStore())
        host = loop.pipelines[0].producer
        self.assertIsInstance(host, FamilyRuntimeHost)
        assert isinstance(host, FamilyRuntimeHost)
        self.assertEqual(host.family_names, ("so",))
        self.assertFalse(hasattr(host, "runtime"))


if __name__ == "__main__":
    unittest.main()
