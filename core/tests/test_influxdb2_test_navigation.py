from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_ingest.influxdb2 import InfluxDB2StreamSchema
from bluewolf_runtime_adapter import navigation_input_factory
from bluewolf_runtime_adapter.event_archive_binding import _navigation_source_mode
from bluewolf_runtime_adapter.navigation_input_factory import navigation_reader_and_schema


class InfluxDB2TestNavigationModeTests(unittest.TestCase):
    def test_explicit_test_influx_uses_real_reader_factory_only_in_test_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "archive.sqlite"
            config = {
                "navigationSource": {"mode": "influxdb2-test"},
                "archive": {"path": str(archive)},
            }
            sentinel_reader = object()
            sentinel_schema = InfluxDB2StreamSchema(
                vehicle_number_column="vehicle",
                server_column="server",
                time_column="_time",
            )
            with patch.object(
                navigation_input_factory,
                "_connection_and_reader",
                return_value=(sentinel_reader, sentinel_schema),
            ):
                with patch.dict(os.environ, {
                    "BLUEWOLF_TEST_MODE": "0",
                    "BLUEWOLF_TEST_STORAGE_ROOT": str(root),
                }, clear=False):
                    with self.assertRaisesRegex(ValueError, "BLUEWOLF_TEST_MODE"):
                        navigation_reader_and_schema(config)
                with patch.dict(os.environ, {
                    "BLUEWOLF_TEST_MODE": "1",
                    "BLUEWOLF_TEST_STORAGE_ROOT": str(root),
                    "BLUEWOLF_SAMPLE_ARCHIVE_PATH": str(archive),
                }, clear=False):
                    reader, schema = navigation_reader_and_schema(config)
            self.assertIs(reader, sentinel_reader)
            self.assertIs(schema, sentinel_schema)

    def test_test_influx_cannot_escape_dedicated_storage_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "test-root"
            root.mkdir()
            outside = Path(directory) / "outside.sqlite"
            config = {
                "navigationSource": {"mode": "influxdb2-test"},
                "archive": {"path": str(outside)},
            }
            with patch.dict(os.environ, {
                "BLUEWOLF_TEST_MODE": "1",
                "BLUEWOLF_TEST_STORAGE_ROOT": str(root),
                "BLUEWOLF_SAMPLE_ARCHIVE_PATH": "",
                "BLUEWOLF_OPERATIONAL_STATE_PATH": "",
                "BLUEWOLF_WORKSPACE_DB": "",
            }, clear=False):
                with self.assertRaisesRegex(ValueError, "escapes BLUEWOLF_TEST_STORAGE_ROOT"):
                    navigation_reader_and_schema(config)

    def test_event_archive_recognizes_explicit_test_influx_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime.json"
            path.write_text(json.dumps({"navigationSource": {"mode": "influxdb2-test"}}), encoding="utf-8")
            self.assertEqual(_navigation_source_mode(path), "influxdb2-test")


if __name__ == "__main__":
    unittest.main()
