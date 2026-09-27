from __future__ import annotations

from datetime import timedelta
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_runtime_adapter.environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.history_contract import LIVE_RUNTIME_HISTORY_SCHEMA_VERSION
from bluewolf_runtime_adapter.operational_state import CheckpointedOperationalRuntimeLoop
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore

from test_environment_factory import NOW, _config


def _snapshot(observed_at, marker: str, total: float = 80.0):
    observed = observed_at.isoformat().replace("+00:00", "Z")
    group = {
        "key": "so",
        "id": "g-history",
        "name": marker,
        "family": "SO",
        "subtitle": "Python Core",
        "total": total,
        "sync": total,
        "route": total,
        "confidence": 90.0,
        "color": "#3366cc",
        "members": [],
        "templateId": "so-default",
        "reason": "runtime",
        "success": "valid",
        "scoreValid": True,
        "observedAt": observed,
    }
    return {
        "schemaVersion": "bluewolf.live-runtime.v1",
        "serverId": "1",
        "arena": "arena-a",
        "status": marker,
        "observedAt": observed,
        "source": {"kind": "python-core", "health": "healthy"},
        "groups": {"so": group},
        "groupList": [group],
    }


class OperationalHistoryStateTests(unittest.TestCase):
    def test_checkpoint_roundtrip_restores_compact_bounded_runtime_history(self) -> None:
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
                _snapshot(NOW - timedelta(seconds=10), "first", 71.0),
                _snapshot(NOW - timedelta(seconds=5), "second", 82.0),
                _snapshot(NOW, "third", 93.0),
            ]
            for row in expected:
                first_store.publish(row)
            first.save_checkpoint()

            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            history = persisted["servers"][0]["runtimeHistory"]
            self.assertEqual(
                [row["schemaVersion"] for row in history],
                [LIVE_RUNTIME_HISTORY_SCHEMA_VERSION] * 3,
            )
            self.assertEqual(
                [row["groups"][0]["name"] for row in history],
                ["first", "second", "third"],
            )
            self.assertEqual(
                [row["groups"][0]["total"] for row in history],
                [71.0, 82.0, 93.0],
            )
            self.assertNotIn("members", history[0]["groups"][0])
            self.assertNotIn("arena", history[0])

            restored_store = RuntimeSnapshotStore(history_limit=4)
            with patch.dict(os.environ, environment, clear=False):
                restored = build_operational_runtime(config, restored_store)
            self.assertIsInstance(restored, CheckpointedOperationalRuntimeLoop)
            self.assertEqual(
                [row["groups"][0]["name"] for row in restored_store.history("1")],
                ["first", "second", "third"],
            )
            self.assertEqual(restored_store.get("1")["status"], "third")

    def test_legacy_v1_checkpoint_with_full_runtime_history_is_migrated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "runtime-state.json"
            config = _config()
            config["persistence"] = {"path": str(state_path)}
            environment = {"TEST_BLUEWOLF_INFLUX_TOKEN": "secret"}

            seed_store = RuntimeSnapshotStore()
            with patch.dict(os.environ, environment, clear=False):
                first = build_operational_runtime(config, seed_store)
            assert isinstance(first, CheckpointedOperationalRuntimeLoop)
            legacy_rows = [
                _snapshot(NOW - timedelta(seconds=5), "legacy-first", 67.0),
                _snapshot(NOW, "legacy-latest", 88.0),
            ]
            for row in legacy_rows:
                seed_store.publish(row)
            first.save_checkpoint()

            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            persisted["servers"][0]["runtimeHistory"] = legacy_rows
            state_path.write_text(
                json.dumps(persisted, ensure_ascii=False),
                encoding="utf-8",
            )

            restored_store = RuntimeSnapshotStore()
            with patch.dict(os.environ, environment, clear=False):
                build_operational_runtime(config, restored_store)
            self.assertEqual(
                [row["groups"][0]["name"] for row in restored_store.history("1")],
                ["legacy-first", "legacy-latest"],
            )
            self.assertEqual(restored_store.get("1")["status"], "legacy-latest")

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
                [row["groups"][0]["name"] for row in restored_store.history("1")],
                ["legacy-latest"],
            )


if __name__ == "__main__":
    unittest.main()
