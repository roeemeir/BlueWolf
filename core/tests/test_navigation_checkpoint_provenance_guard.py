"""Transport-only provenance regressions; no route, group or score fixtures.

The synthetic source wrapper must be readable by the operational checkpoint,
restore history without erasing TEST lineage, and reject conflicting provenance.
"""
from __future__ import annotations

from copy import deepcopy
import unittest

from bluewolf_runtime_adapter.contract import LIVE_RUNTIME_SCHEMA_VERSION
from bluewolf_runtime_adapter.navigation_input_factory import SimulatedNavigationPublicationStore
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore


class NavigationCheckpointProvenanceGuardTests(unittest.TestCase):
    @staticmethod
    def empty_transport_frame():
        # No fabricated routes or scores: a deliberately empty transport frame
        # exercises only the publication wrapper's persistence interface.
        return {
            "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
            "serverId": "1",
            "observedAt": "2026-09-24T12:00:00Z",
            "source": {"kind": "python-core", "health": "healthy", "detail": "no groups"},
            "status": "no groups",
            "groups": {},
            "groupList": [],
        }

    def test_checkpoint_read_history_round_trip_preserves_test_lineage(self):
        store = SimulatedNavigationPublicationStore(RuntimeSnapshotStore())
        store.publish(self.empty_transport_frame())
        first = store.get("1")
        self.assertIsNotNone(first)
        self.assertEqual(first["source"]["navigationOrigin"], "simulation")
        self.assertIs(first["source"]["syntheticNavigation"], True)
        self.assertEqual(first["source"]["detail"].count("TEST NAVIGATION"), 1)
        self.assertEqual(first["status"].count("בדיקות ניווט סינתטי"), 1)
        # Operational-state replay passes the already-marked snapshot back
        # through publish(). TEST labels must not be duplicated on every boot.
        store.publish(first)
        second = store.get("1")
        self.assertEqual(second, first)
        history = store.history("1")
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["source"], {
            "kind": "python-core",
            "navigationOrigin": "simulation",
            "syntheticNavigation": True,
        })
        fresh = SimulatedNavigationPublicationStore(RuntimeSnapshotStore())
        fresh.restore_history("1", history)
        self.assertEqual(fresh.history("1"), history)
        self.assertIsNone(fresh.get("1"), "restoring history must not invent a latest snapshot")

    def test_restored_history_and_conflicting_snapshot_fail_closed(self):
        store = SimulatedNavigationPublicationStore(RuntimeSnapshotStore())
        store.publish(self.empty_transport_frame())
        original_history = store.history("1")
        for source in (
            None,
            {"kind": "python-core"},
            {"kind": "python-core", "navigationOrigin": "simulation", "syntheticNavigation": False},
            {"kind": "python-core", "navigationOrigin": "influxdb2", "syntheticNavigation": True},
        ):
            corrupt = deepcopy(original_history)
            if source is None:
                corrupt[0].pop("source")
            else:
                corrupt[0]["source"] = source
            with self.assertRaisesRegex(ValueError, "TEST source provenance"):
                store.restore_history("1", corrupt)
            self.assertEqual(store.history("1"), original_history)
        conflicting = self.empty_transport_frame()
        conflicting["source"]["navigationOrigin"] = "influxdb2"
        with self.assertRaisesRegex(ValueError, "conflicting source provenance"):
            store.publish(conflicting)
        self.assertEqual(store.get("1")["source"]["navigationOrigin"], "simulation")


if __name__ == "__main__":
    unittest.main()
