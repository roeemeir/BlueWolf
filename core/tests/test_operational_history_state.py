from __future__ import annotations

from datetime import timedelta
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_runtime_adapter.environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.operational_state import CheckpointedOperationalRuntimeLoop
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore

from test_environment_factory import NOW, _config


def _snapshot(observed_at, marker: str):
    return {
        "schemaVersion": "bluewolf.live-runtime.v1",
        "serverId": "1",
        "arena": "arena-a",
        "status": marker,
        "observedAt": observed_at.isoformat().replace("+00:00", "Z"),
        "source": {"kind": "python-core", "health": "healthy"},
        "groups": {},
        "groupList": [],
    }


class OperationalHistoryStateTests(unittest.TestCase):
    def test_checkpoint_roundtrip_restores_bounded_runtime_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "runtime-state.json"
            config = _config()
            config["persistence"] = {"path": str(state_path)}
            environment = {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}

            first_store = RuntimeSnapshotStore(history_limit=4)
            with patch.dict(os.environ, environment, clear=False):
                first = build_operational_runtime(config, first_store)
            self.assertIsInstance(first, CheckpointedOperationalRuntimeLoop)
            assert isinstance(first, CheckpointedOperationalRuntimeLoop)

            expected = [
                _snapshot(NOW - timedelta(seconds=10), "first"),
                _snapshot(NOW - timedelta(seconds=5), "second"),
                _snapshot(NOW, "third"),
            ]
            for row in expected:
                first_store.publish(row)
            first.save_checkpoint()

            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(
                [row["status"] for row in persisted["servers"][0]["runtimeHistory"]],
                ["first", "second", "third"],
            )

            restored_store = RuntimeSnapshotStore(history_limit=4)
            with patch.dict(os.environ, environment, clear=False):
                restored = build_operational_runtime(config, restored_store)
            self.assertIsInstance(restored, CheckpointedOperationalRuntimeLoop)
            self.assertEqual(
                [row["status"] for row in restored_store.history("1")],
                ["first", "second", "third"],
            )
            self.assertEqual(restored_store.get("1")["status"], "third")

    def test_legacy_v1_checkpoint_without_runtime_history_still_restores_latest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "runtime-state.json"
            config = _config()
            config["persistence"] = {"path": str(state_path)}
            environment = {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}

            first_store = RuntimeSnapshotStore()
            with patch.dict(os.environ, environment, clear=False):
                first = build_operational_runtime(config, first_store)
            assert isinstance(first, CheckpointedOperationalRuntimeLoop)
            first_store.publish(_snapshot(NOW, "legacy-latest"))
            first.save_checkpoint()

            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            persisted["servers"][0].pop("runtimeHistory", None)
            state_path.write_text(
                json.dumps(persisted, ensure_ascii=False),
                encoding="utf-8",
            )

            restored_store = RuntimeSnapshotStore()
            with patch.dict(os.environ, environment, clear=False):
                build_operational_runtime(config, restored_store)
            self.assertEqual(restored_store.get("1")["status"], "legacy-latest")
            self.assertEqual(
                [row["status"] for row in restored_store.history("1")],
                ["legacy-latest"],
            )


if __name__ == "__main__":
    unittest.main()
