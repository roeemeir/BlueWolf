from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_runtime_adapter.navigation_input_factory import navigation_reader_and_schema
from bluewolf_runtime_adapter.simulation_storage_guard import assert_simulation_storage_isolated


class SimulationStorageGuardTests(unittest.TestCase):
    def test_no_persistence_is_in_memory(self):
        assert_simulation_storage_isolated({}, environment={})

    def test_archive_must_have_explicit_test_root(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = str(Path(folder) / "archive.sqlite")
            with self.assertRaisesRegex(ValueError, "BLUEWOLF_TEST_STORAGE_ROOT"):
                assert_simulation_storage_isolated({"archive": {"path": archive}}, environment={})
            assert_simulation_storage_isolated(
                {"archive": {"path": archive}},
                environment={"BLUEWOLF_TEST_STORAGE_ROOT": folder},
            )

    def test_reject_real_archive_even_when_env_override_wins(self):
        with tempfile.TemporaryDirectory() as temporary:
            test_root = Path(temporary) / "test-root"
            production = Path(temporary) / "production"
            test_root.mkdir()
            production.mkdir()
            config = {"archive": {"path": str(test_root / "original.sqlite")}}
            with self.assertRaisesRegex(ValueError, "BLUEWOLF_SAMPLE_ARCHIVE_PATH escapes"):
                assert_simulation_storage_isolated(config, environment={
                    "BLUEWOLF_TEST_STORAGE_ROOT": str(test_root),
                    "BLUEWOLF_SAMPLE_ARCHIVE_PATH": str(production / "navigation.sqlite"),
                })

    def test_reject_checkpoint_workspace_and_config_escape(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "test"
            root.mkdir()
            other = Path(temporary) / "live.sqlite"
            env = {"BLUEWOLF_TEST_STORAGE_ROOT": str(root)}
            for key in ("BLUEWOLF_WORKSPACE_DB", "BLUEWOLF_OPERATIONAL_STATE_PATH"):
                with self.subTest(key=key), self.assertRaisesRegex(ValueError, f"{key} escapes"):
                    assert_simulation_storage_isolated({}, environment={**env, key: str(other)})
            for section in ("archive", "persistence"):
                with self.subTest(section=section), self.assertRaisesRegex(ValueError, "escapes"):
                    assert_simulation_storage_isolated({section: {"path": str(other)}}, environment=env)

    def test_canonical_paths_disallow_symlink_escape_and_relative_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "test"
            root.mkdir()
            outside = Path(temporary) / "outside"
            outside.mkdir()
            (root / "escape").symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "escapes"):
                assert_simulation_storage_isolated(
                    {"archive": {"path": str(root / "escape" / "archive.sqlite")}},
                    environment={"BLUEWOLF_TEST_STORAGE_ROOT": str(root)},
                )
            with self.assertRaisesRegex(ValueError, "absolute TEST file path"):
                assert_simulation_storage_isolated(
                    {"archive": {"path": "./navigation.sqlite"}},
                    environment={"BLUEWOLF_TEST_STORAGE_ROOT": str(root)},
                )

    def test_simulation_factory_rejects_archive_before_reader_is_started(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "test"
            root.mkdir()
            wrong_archive = str(Path(temporary) / "real.sqlite")
            config = {
                "navigationSource": {"mode": "simulation"},
                "archive": {"path": wrong_archive},
            }
            with patch.dict(os.environ, {
                "BLUEWOLF_TEST_MODE": "1",
                "BLUEWOLF_TEST_STORAGE_ROOT": str(root),
                "BLUEWOLF_SAMPLE_ARCHIVE_PATH": "",
                "BLUEWOLF_OPERATIONAL_STATE_PATH": "",
                "BLUEWOLF_WORKSPACE_DB": "",
            }), self.assertRaisesRegex(ValueError, "archive.path escapes"):
                navigation_reader_and_schema(config)
            self.assertFalse(Path(wrong_archive).exists())


if __name__ == "__main__":
    unittest.main()
