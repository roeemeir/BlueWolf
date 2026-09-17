from __future__ import annotations

from datetime import UTC, datetime
from types import MappingProxyType, SimpleNamespace
import unittest

from bluewolf_runtime_adapter.composite_producer import CompositeRuntimeProducer
from bluewolf_runtime_adapter.contract import LIVE_RUNTIME_SCHEMA_VERSION
from bluewolf_runtime_adapter.producer import RuntimePublicationResult
from bluewolf_runtime_adapter.service import RuntimeSnapshotStore


NOW = datetime(2026, 9, 17, 4, 0, tzinfo=UTC)


def _group(group_id: str, family: str):
    return {
        "key": family.lower(),
        "id": group_id,
        "name": group_id,
        "family": family,
        "subtitle": "test",
        "total": 80.0,
        "sync": 80.0,
        "route": 80.0,
        "confidence": 100.0,
        "color": "#000000",
        "members": [],
        "templateId": f"{family}-template",
        "reason": "test",
        "success": "test",
        "scoreValid": True,
        "observedAt": NOW.isoformat().replace("+00:00", "Z"),
    }


class _Producer:
    def __init__(self, family: str, group_id: str, arena: str = "Operational") -> None:
        self.family = family
        self.group_id = group_id
        self.arena = arena
        self.restored = None

    def publish_poll(self, poll):
        del poll
        key = self.family.lower()
        group = _group(self.group_id, self.family)
        snapshot = MappingProxyType({
            "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
            "serverId": "1",
            "arena": self.arena,
            "status": "test",
            "observedAt": NOW.isoformat().replace("+00:00", "Z"),
            "source": {"kind": "python-core", "health": "healthy"},
            "groups": {key: group},
            "groupList": [group],
        })
        return RuntimePublicationResult(snapshot, (self.group_id,), {})

    def export_state(self):
        return {"family": self.family}

    def restore_state(self, state):
        self.restored = dict(state)


class CompositeRuntimeProducerTests(unittest.TestCase):
    def test_si_and_so_are_published_together_without_family_overwrite(self) -> None:
        store = RuntimeSnapshotStore()
        si = _Producer("SI", "si-1")
        so = _Producer("SO", "so-1", "Arena A")
        composite = CompositeRuntimeProducer(
            server_id=1,
            producers=(("si", si), ("so", so)),  # type: ignore[arg-type]
            store=store,
        )
        result = composite.publish_poll(SimpleNamespace())
        self.assertIsNotNone(result.snapshot)
        snapshot = result.snapshot
        self.assertEqual(set(snapshot["groups"]), {"si", "so"})  # type: ignore[arg-type,index]
        self.assertEqual(
            {item["id"] for item in snapshot["groupList"]},  # type: ignore[index]
            {"si-1", "so-1"},
        )
        self.assertEqual(snapshot["arena"], "Arena A")
        stored = store.get("1")
        self.assertIsNotNone(stored)
        self.assertEqual(set(stored["groups"]), {"si", "so"})  # type: ignore[index]

    def test_duplicate_group_ids_across_families_fail_closed(self) -> None:
        composite = CompositeRuntimeProducer(
            server_id=1,
            producers=(
                ("si", _Producer("SI", "same")),
                ("so", _Producer("SO", "same")),
            ),  # type: ignore[arg-type]
            store=RuntimeSnapshotStore(),
        )
        with self.assertRaisesRegex(ValueError, "duplicate runtime group id"):
            composite.publish_poll(SimpleNamespace())

    def test_family_state_round_trip_is_namespaced(self) -> None:
        si = _Producer("SI", "si")
        so = _Producer("SO", "so")
        composite = CompositeRuntimeProducer(
            server_id=1,
            producers=(("si", si), ("so", so)),  # type: ignore[arg-type]
            store=RuntimeSnapshotStore(),
        )
        state = composite.export_state()
        self.assertEqual(state, {"si": {"family": "SI"}, "so": {"family": "SO"}})
        composite.restore_state({"si": {"x": 1}, "so": {"x": 2}})
        self.assertEqual(si.restored, {"x": 1})
        self.assertEqual(so.restored, {"x": 2})


if __name__ == "__main__":
    unittest.main()
