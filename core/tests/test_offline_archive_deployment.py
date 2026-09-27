from __future__ import annotations

import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from bluewolf_runtime_adapter.environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore
from test_environment_factory import _config


class OfflineArchiveDeploymentTests(unittest.TestCase):
    def test_deployment_environment_enables_durable_archive_even_without_json_archive_block(self) -> None:
        with TemporaryDirectory(prefix="bluewolf-deployment-archive-") as directory:
            archive_path = Path(directory) / "joined-samples.sqlite3"
            environment = {
                "TEST_BLUEWOLF_INFLUX_TOKEN": "secret",
                "BLUEWOLF_SAMPLE_ARCHIVE_PATH": str(archive_path),
                "BLUEWOLF_ARCHIVE_RETENTION_DAYS": "30",
                "BLUEWOLF_ARCHIVE_PRUNE_INTERVAL_SECONDS": "3600",
            }
            with patch.dict(os.environ, environment, clear=False):
                loop = build_operational_runtime(_config(), RuntimeSnapshotStore())

            archive = loop.pipelines[0].coordinator.sample_archive
            self.assertIsNotNone(archive)
            assert archive is not None
            self.assertEqual(archive.path, archive_path.resolve())
            self.assertEqual(archive.retention_days, 30)
            self.assertEqual(archive.prune_interval_seconds, 3600)
            self.assertTrue(archive_path.exists())

    def test_json_archive_path_still_works_when_deployment_override_is_absent(self) -> None:
        with TemporaryDirectory(prefix="bluewolf-json-archive-") as directory:
            archive_path = Path(directory) / "configured.sqlite3"
            config = _config()
            config["archive"] = {"path": str(archive_path)}
            environment = {
                "TEST_BLUEWOLF_INFLUX_TOKEN": "secret",
                "BLUEWOLF_ARCHIVE_RETENTION_DAYS": "7",
                "BLUEWOLF_ARCHIVE_PRUNE_INTERVAL_SECONDS": "600",
            }
            with patch.dict(os.environ, environment, clear=False):
                os.environ.pop("BLUEWOLF_SAMPLE_ARCHIVE_PATH", None)
                loop = build_operational_runtime(config, RuntimeSnapshotStore())

            archive = loop.pipelines[0].coordinator.sample_archive
            self.assertIsNotNone(archive)
            assert archive is not None
            self.assertEqual(archive.path, archive_path.resolve())
            self.assertEqual(archive.retention_days, 7)
            self.assertEqual(archive.prune_interval_seconds, 600)


if __name__ == "__main__":
    unittest.main()
