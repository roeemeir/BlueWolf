"""Integration contract: only navigation is simulated; real Core owns outcomes."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bluewolf_ingest.navigation_simulation import SimulatedNavigationMetricAdapter
from bluewolf_runtime_adapter.family_environment_factory import build_operational_runtime
from bluewolf_runtime_adapter.navigation_input_factory import SimulatedNavigationPublicationStore
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore

START = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)


def _config(archive_path: str):
    vehicles = []
    for server_id in (1, 2, 3):
        for vehicle_number, phase in ((server_id * 100 + 1, 0.0), (server_id * 100 + 2, 0.5)):
            vehicles.append({
                "serverId": server_id,
                "vehicleNumber": vehicle_number,
                "centerLatitude": 32.08 + server_id * 0.01,
                "centerLongitude": 34.79,
                "radiusMeters": 150.0,
                "periodSeconds": 90.0,
                "phaseFraction": phase,
            })
    return {
        "navigationSource": {
            "mode": "simulation",
            "startedAtUtc": START.isoformat(),
            "sampleSeconds": 1,
            "vehicles": vehicles,
        },
        "join": {"logicalGridSeconds": 1, "toleranceSeconds": 5},
        "polling": {
            "logicalGridSeconds": 1,
            "activePollSeconds": 5,
            "idleProbeSeconds": 300,
            "joinToleranceSeconds": 5,
            "bootstrapHistorySeconds": 15,
        },
        "archive": {"path": archive_path},
        "displayedScore": {"mode": "invalid"},
        "siTemplates": [{
            "id": "sim-input-si-template",
            "name": "QA SI template, never an observed route",
            "default": True,
            "slots": [
                {"id": "slot-0", "vehicleType": "A", "routeRole": "outer", "phaseOffset": 0.0},
                {"id": "slot-1", "vehicleType": "A", "routeRole": "outer", "phaseOffset": 0.5},
            ],
        }],
        "siVehicleTypes": [{
            "id": "A", "minId": 101, "maxId": 302,
            "workSpeedMps": 20.0, "siRoles": ["outer"],
        }],
        "servers": [
            {"id": server_id, "awakePolicy": "any-active-latest-snapshot"}
            for server_id in (1, 2, 3)
        ],
    }


class NavigationSimulationPipelineTests(unittest.TestCase):
    def test_three_servers_reach_real_core_and_one_durable_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = str(Path(directory) / "test-navigation.sqlite")
            store = RuntimeSnapshotStore()
            with patch.dict(os.environ, {
                "BLUEWOLF_TEST_MODE": "1",
                "BLUEWOLF_SAMPLE_ARCHIVE_PATH": "",
                "BLUEWOLF_INFLUX_TOKEN": "",
            }):
                loop = build_operational_runtime(_config(archive_path), store)
            self.assertEqual([pipeline.server_id for pipeline in loop.pipelines], [1, 2, 3])
            adapters = [pipeline.coordinator.reader.adapter for pipeline in loop.pipelines]
            self.assertTrue(all(isinstance(adapter, SimulatedNavigationMetricAdapter) for adapter in adapters))
            self.assertIs(adapters[0], adapters[1])
            self.assertIs(adapters[1], adapters[2])
            self.assertTrue(all(
                isinstance(pipeline.producer.store, SimulatedNavigationPublicationStore)
                for pipeline in loop.pipelines
            ))
            for adapter in adapters:
                adapter.clock = lambda: START + timedelta(seconds=10)
            tick = loop.tick(START + timedelta(seconds=10))
            self.assertEqual(tick.errors, {})
            self.assertEqual(set(tick.results), {1, 2, 3})
            for server_id, output in tick.results.items():
                self.assertIsNotNone(output.poll)
                self.assertIsNotNone(output.poll.core_result)
                self.assertTrue(output.poll.server_awake)
                self.assertEqual({sample.server_id for sample in output.poll.samples}, {server_id})
                self.assertEqual({sample.vehicle_identifier for sample in output.poll.samples}, {
                    server_id * 100 + 1, server_id * 100 + 2,
                })
                self.assertIsNotNone(output.poll.archive_result)
                self.assertGreater(output.poll.archive_result.inserted, 0)
            self.assertTrue(Path(archive_path).is_file())
            # No score, group or event is fabricated just because the source
            # emitted positions; only Core may establish those observations.
            self.assertTrue(all(
                result.publication is None or not result.publication.published_group_ids
                for result in tick.results.values()
            ))


if __name__ == "__main__":
    unittest.main()
