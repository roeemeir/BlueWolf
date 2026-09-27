from __future__ import annotations

import unittest
from datetime import UTC, datetime

from bluewolf_runtime_adapter.operational_pipeline import (
    OperationalRuntimeLoop,
    OperationalServerPipeline,
)


NOW = datetime(2026, 9, 9, 19, 0, tzinfo=UTC)


class _Coordinator:
    def __init__(
        self,
        server_id: int,
        *,
        replace_session_on_success: bool = False,
        fail: bool = False,
        due: bool = True,
    ) -> None:
        self.server_id = server_id
        self.session = object()
        self.initial_session = self.session
        self.replace_session_on_success = replace_session_on_success
        self.fail = fail
        self.due = due
        self.poll = object()

    def poll_once(self, now_utc: datetime):
        self.last_now = now_utc
        if self.fail:
            # Models an ingestion/query failure. The real coordinator may have
            # replaced its session while restoring a checkpoint before raising.
            self.session = object()
            raise RuntimeError("synthetic source failure")
        if not self.due:
            return None
        if self.replace_session_on_success:
            # Models the first successful poll after a previous rollback.
            self.session = object()
        return self.poll


class _Producer:
    def __init__(self, session: object) -> None:
        self.session = session
        self.seen_session: object | None = None
        self.seen_poll: object | None = None
        self.publication = object()

    def publish_poll(self, poll):
        self.seen_session = self.session
        self.seen_poll = poll
        return self.publication


class OperationalPipelineTests(unittest.TestCase):
    def test_publication_rebinds_to_current_session_after_rollback_replacement(self) -> None:
        coordinator = _Coordinator(1, replace_session_on_success=True)
        producer = _Producer(coordinator.session)
        original_session = coordinator.session
        pipeline = OperationalServerPipeline(coordinator, producer)

        result = pipeline.poll_once(NOW)

        self.assertIsNot(coordinator.session, original_session)
        self.assertIs(producer.session, coordinator.session)
        self.assertIs(producer.seen_session, coordinator.session)
        self.assertIs(producer.seen_poll, coordinator.poll)
        self.assertIs(result.poll, coordinator.poll)
        self.assertIs(result.publication, producer.publication)

    def test_not_due_poll_does_not_publish_or_rebind(self) -> None:
        coordinator = _Coordinator(2, due=False)
        producer = _Producer(coordinator.session)
        pipeline = OperationalServerPipeline(coordinator, producer)

        result = pipeline.poll_once(NOW)

        self.assertIsNone(result.poll)
        self.assertIsNone(result.publication)
        self.assertIsNone(producer.seen_poll)
        self.assertIs(producer.session, coordinator.initial_session)

    def test_one_server_failure_does_not_block_other_servers(self) -> None:
        bad_coordinator = _Coordinator(1, fail=True)
        bad = OperationalServerPipeline(bad_coordinator, _Producer(bad_coordinator.session))
        good_coordinator = _Coordinator(2, replace_session_on_success=True)
        good_producer = _Producer(good_coordinator.session)
        good = OperationalServerPipeline(good_coordinator, good_producer)
        loop = OperationalRuntimeLoop((good, bad))

        tick = loop.tick(NOW)

        self.assertEqual(tick.at_utc, NOW)
        self.assertEqual(set(tick.errors), {1})
        self.assertIn("synthetic source failure", tick.errors[1])
        self.assertEqual(set(tick.results), {2})
        self.assertIs(tick.results[2].publication, good_producer.publication)
        self.assertIs(good_producer.seen_session, good_coordinator.session)

    def test_duplicate_server_ids_are_rejected(self) -> None:
        first_coordinator = _Coordinator(7)
        second_coordinator = _Coordinator(7)
        first = OperationalServerPipeline(first_coordinator, _Producer(first_coordinator.session))
        second = OperationalServerPipeline(second_coordinator, _Producer(second_coordinator.session))

        with self.assertRaisesRegex(ValueError, "server ids must be unique"):
            OperationalRuntimeLoop((first, second))


if __name__ == "__main__":
    unittest.main()
