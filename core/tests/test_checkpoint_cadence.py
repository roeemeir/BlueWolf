from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
import unittest

from bluewolf_runtime_adapter.operational_pipeline import OperationalPipelineResult
from bluewolf_runtime_adapter.operational_state import CheckpointedOperationalRuntimeLoop
from bluewolf_runtime_adapter.runtime_host import OperationalLoopHost


NOW = datetime(2026, 9, 9, 20, 30, tzinfo=UTC)


class _StateStore:
    def __init__(self) -> None:
        self.saved: list[dict[str, object]] = []

    def load(self):
        return None

    def save(self, state):
        self.saved.append(dict(state))


class _Session:
    def __init__(self, checkpoint_seconds: int) -> None:
        self.config = SimpleNamespace(
            timing=SimpleNamespace(checkpoint_seconds=checkpoint_seconds)
        )

    def export_checkpoint(self) -> bytes:
        return b"{}"


class _Cursor:
    def export_state(self):
        return {}


class _Runtime:
    def export_state(self):
        return {}


class _RuntimeStore:
    def history(self, server_id: str):
        del server_id
        return []

    def get(self, server_id: str):
        del server_id
        return None


class _Producer:
    def __init__(self) -> None:
        self.runtime = _Runtime()
        self.store = _RuntimeStore()

    def export_state(self):
        return {}


class _Coordinator:
    def __init__(self, checkpoint_seconds: int) -> None:
        self.session = _Session(checkpoint_seconds)
        self.cursor = _Cursor()


class _ChangedPipeline:
    def __init__(self, server_id: int, checkpoint_seconds: int) -> None:
        self.server_id = server_id
        self.coordinator = _Coordinator(checkpoint_seconds)
        self.producer = _Producer()

    def poll_once(self, now_utc):
        del now_utc
        return OperationalPipelineResult(self.server_id, object(), None)


class CheckpointCadenceTests(unittest.TestCase):
    def test_first_change_saves_immediately_then_respects_core_cadence(self) -> None:
        state_store = _StateStore()
        loop = CheckpointedOperationalRuntimeLoop(
            (_ChangedPipeline(1, 300),),
            state_store=state_store,
            config_fingerprint="fingerprint",
        )
        self.assertEqual(loop.checkpoint_interval_seconds, 300.0)

        loop.tick(NOW)
        self.assertEqual(len(state_store.saved), 1)
        self.assertFalse(loop.checkpoint_dirty)
        self.assertEqual(loop.last_checkpoint_utc, NOW)

        loop.tick(NOW + timedelta(seconds=5))
        loop.tick(NOW + timedelta(seconds=299))
        self.assertEqual(len(state_store.saved), 1)
        self.assertTrue(loop.checkpoint_dirty)

        loop.tick(NOW + timedelta(seconds=300))
        self.assertEqual(len(state_store.saved), 2)
        self.assertFalse(loop.checkpoint_dirty)
        self.assertEqual(loop.last_checkpoint_utc, NOW + timedelta(seconds=300))

    def test_shared_state_uses_most_frequent_core_checkpoint_requirement(self) -> None:
        loop = CheckpointedOperationalRuntimeLoop(
            (_ChangedPipeline(1, 300), _ChangedPipeline(2, 120)),
            state_store=_StateStore(),
            config_fingerprint="fingerprint",
        )
        self.assertEqual(loop.checkpoint_interval_seconds, 120.0)

    def test_explicit_checkpoint_interval_overrides_core_default(self) -> None:
        loop = CheckpointedOperationalRuntimeLoop(
            (_ChangedPipeline(1, 300),),
            state_store=_StateStore(),
            config_fingerprint="fingerprint",
            checkpoint_interval_seconds=45,
        )
        self.assertEqual(loop.checkpoint_interval_seconds, 45.0)

    def test_flush_writes_dirty_state_once(self) -> None:
        state_store = _StateStore()
        loop = CheckpointedOperationalRuntimeLoop(
            (_ChangedPipeline(1, 300),),
            state_store=state_store,
            config_fingerprint="fingerprint",
        )
        loop.tick(NOW)
        loop.tick(NOW + timedelta(seconds=5))
        self.assertEqual(len(state_store.saved), 1)
        self.assertTrue(loop.checkpoint_dirty)

        self.assertTrue(loop.flush_checkpoint())
        self.assertEqual(len(state_store.saved), 2)
        self.assertFalse(loop.checkpoint_dirty)
        self.assertFalse(loop.flush_checkpoint())
        self.assertEqual(len(state_store.saved), 2)

    def test_host_stop_flushes_pending_checkpoint_after_loop_is_stopped(self) -> None:
        state_store = _StateStore()
        loop = CheckpointedOperationalRuntimeLoop(
            (_ChangedPipeline(1, 300),),
            state_store=state_store,
            config_fingerprint="fingerprint",
        )
        loop.tick(NOW)
        loop.tick(NOW + timedelta(seconds=5))
        self.assertTrue(loop.checkpoint_dirty)

        host = OperationalLoopHost(loop)
        host.stop()
        self.assertEqual(len(state_store.saved), 2)
        self.assertFalse(loop.checkpoint_dirty)


if __name__ == "__main__":
    unittest.main()
