from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
import unittest

from bluewolf_runtime_adapter.event_archive_binding import (
    attach_event_observation_archive,
    event_archive_path_from_config,
    operational_config_fingerprint,
)


class EventArchiveBindingTests(unittest.TestCase):
    def test_archive_path_fingerprint_and_sink_binding_use_existing_archive_config(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            archive_path = root / "bluewolf-source.sqlite"
            config_path = root / "runtime.json"
            config = {
                "archive": {"path": str(archive_path)},
                "servers": [{"id": 1}],
                "comparisonDimension": "sync",
            }
            config_path.write_text(json.dumps(config), encoding="utf-8")

            runtime_a = SimpleNamespace(observation_sink=None)
            runtime_b = SimpleNamespace(observation_sink=None)
            loop = SimpleNamespace(
                pipelines=(
                    SimpleNamespace(producer=SimpleNamespace(runtime=runtime_a)),
                    SimpleNamespace(producer=SimpleNamespace(runtime=runtime_b)),
                )
            )

            archive = attach_event_observation_archive(loop, config_path=config_path)

            self.assertIsNotNone(archive)
            assert archive is not None
            self.assertEqual(archive.path, archive_path.resolve())
            self.assertEqual(event_archive_path_from_config(config_path), archive_path.resolve())
            self.assertTrue(callable(runtime_a.observation_sink))
            self.assertTrue(callable(runtime_b.observation_sink))
            self.assertIs(runtime_a.observation_sink.__self__, archive)
            self.assertIs(runtime_b.observation_sink.__self__, archive)
            first = operational_config_fingerprint(config_path)
            config_path.write_text(json.dumps({**config, "comparisonDimension": "total"}), encoding="utf-8")
            second = operational_config_fingerprint(config_path)
            self.assertNotEqual(first, second)

    def test_family_host_binds_each_event_capable_sibling_without_so_first_attribute(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            archive_path = root / "bluewolf-family.sqlite"
            config_path = root / "runtime.json"
            config_path.write_text(
                json.dumps({"archive": {"path": str(archive_path)}}),
                encoding="utf-8",
            )
            si_runtime = SimpleNamespace(observation_sink=None, lifecycle_sink=None)
            so_runtime = SimpleNamespace(observation_sink=None, lifecycle_sink=None)
            host = SimpleNamespace(
                families=(
                    SimpleNamespace(producer=SimpleNamespace(runtime=si_runtime)),
                    SimpleNamespace(producer=SimpleNamespace(runtime=so_runtime)),
                )
            )
            loop = SimpleNamespace(pipelines=(SimpleNamespace(producer=host),))

            archive = attach_event_observation_archive(loop, config_path=config_path)

            self.assertIsNotNone(archive)
            assert archive is not None
            for runtime in (si_runtime, so_runtime):
                self.assertTrue(callable(runtime.observation_sink))
                self.assertTrue(callable(runtime.lifecycle_sink))
                self.assertIs(runtime.observation_sink.__self__, archive)

    def test_missing_archive_keeps_runtime_sink_unconfigured(self) -> None:
        with TemporaryDirectory() as directory:
            config_path = Path(directory) / "runtime.json"
            config_path.write_text(json.dumps({"servers": []}), encoding="utf-8")
            runtime = SimpleNamespace(observation_sink=None)
            loop = SimpleNamespace(
                pipelines=(SimpleNamespace(producer=SimpleNamespace(runtime=runtime)),)
            )
            self.assertIsNone(attach_event_observation_archive(loop, config_path=config_path))
            self.assertIsNone(runtime.observation_sink)


if __name__ == "__main__":
    unittest.main()
