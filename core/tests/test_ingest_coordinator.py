from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
import unittest

from bluewolf_core.models import CoreBatchResult
from bluewolf_ingest import ServerPollCursor
from bluewolf_runtime_adapter.ingest_coordinator import LiveCoreIngestCoordinator

START = datetime(2026, 9, 9, 12, 0, 10, tzinfo=UTC)


class FakeReader:
    def __init__(self, samples=(), *, fail=False):
        self.samples = tuple(samples)
        self.fail = fail
        self.calls = []

    def read_samples(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail:
            raise RuntimeError("reader failed")
        return self.samples


class FakeSession:
    config = object()
    algorithm_version = "fake-1"

    def __init__(self, state=0, *, fail=False):
        self.state = state
        self.fail = fail
        self.calls = []

    def export_checkpoint(self):
        return json.dumps({"state": self.state, "fail": self.fail}).encode()

    @classmethod
    def from_checkpoint(cls, checkpoint, *, config, algorithm_version):
        payload = json.loads(checkpoint.decode() if isinstance(checkpoint, bytes) else checkpoint)
        return cls(payload["state"], fail=payload["fail"])

    def process_batch(self, samples, *, observed_until_utc=None):
        self.calls.append((tuple(samples), observed_until_utc))
        self.state += 1
        if self.fail:
            raise RuntimeError("core failed")
        return CoreBatchResult(
            schema_version=1,
            algorithm_version=self.algorithm_version,
            frames=(),
            changes=(),
            processed_until_utc=observed_until_utc,
        )


class IngestCoordinatorTests(unittest.TestCase):
    def build(self, *, reader=None, session=None, resolver=None):
        return LiveCoreIngestCoordinator(
            server_id=1,
            server_tag_value="srv-1",
            reader=reader or FakeReader(),
            session=session or FakeSession(),
            cursor=ServerPollCursor(),
            awake_resolver=resolver or (lambda samples, result, window: True),
        )

    def test_success_advances_core_and_poll_watermark_together(self):
        reader = FakeReader()
        session = FakeSession()
        coordinator = self.build(reader=reader, session=session)
        result = coordinator.poll_once(START)
        assert result is not None
        self.assertEqual(session.state, 1)
        self.assertEqual(coordinator.cursor.last_processed_utc, result.window.end_time_utc)
        self.assertTrue(result.server_awake)
        self.assertEqual(coordinator.cursor.next_due_utc, START + timedelta(seconds=5))
        self.assertEqual(reader.calls[0]["server_tag_value"], "srv-1")
        self.assertEqual(result.core_result.processed_until_utc, result.window.end_time_utc)

    def test_reader_failure_does_not_move_watermark_and_schedules_retry(self):
        session = FakeSession(state=4)
        coordinator = self.build(reader=FakeReader(fail=True), session=session)
        with self.assertRaisesRegex(RuntimeError, "reader failed"):
            coordinator.poll_once(START)
        self.assertEqual(coordinator.session.state, 4)
        self.assertIsNone(coordinator.cursor.last_processed_utc)
        self.assertEqual(coordinator.cursor.next_due_utc, START + timedelta(seconds=5))

    def test_partial_core_failure_rolls_session_back(self):
        session = FakeSession(state=7, fail=True)
        coordinator = self.build(session=session)
        with self.assertRaisesRegex(RuntimeError, "core failed"):
            coordinator.poll_once(START)
        self.assertIsNot(coordinator.session, session)
        self.assertEqual(coordinator.session.state, 7)
        self.assertTrue(coordinator.session.fail)
        self.assertIsNone(coordinator.cursor.last_processed_utc)

    def test_awake_resolver_failure_also_rolls_core_back(self):
        session = FakeSession(state=2)

        def fail_resolver(samples, result, window):
            raise RuntimeError("resolver failed")

        coordinator = self.build(session=session, resolver=fail_resolver)
        with self.assertRaisesRegex(RuntimeError, "resolver failed"):
            coordinator.poll_once(START)
        self.assertEqual(coordinator.session.state, 2)
        self.assertIsNone(coordinator.cursor.last_processed_utc)
        self.assertEqual(coordinator.cursor.next_due_utc, START + timedelta(seconds=5))

    def test_not_due_returns_without_query_or_core_mutation(self):
        reader = FakeReader()
        session = FakeSession()
        coordinator = self.build(reader=reader, session=session)
        first = coordinator.poll_once(START)
        assert first is not None
        second = coordinator.poll_once(START + timedelta(seconds=4))
        self.assertIsNone(second)
        self.assertEqual(len(reader.calls), 1)
        self.assertEqual(session.state, 1)


if __name__ == "__main__":
    unittest.main()
