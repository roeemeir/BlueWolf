from __future__ import annotations

from datetime import UTC, datetime, timedelta
import unittest

from bluewolf_ingest.polling import LivePollConfig, PollWindow, ServerPollCursor

START = datetime(2026, 9, 9, 12, 0, 10, tzinfo=UTC)


class LivePollingTests(unittest.TestCase):
    def test_initial_window_uses_safe_end_and_history_ceiling(self):
        cursor = ServerPollCursor()
        window = cursor.next_window(START)
        assert window is not None
        self.assertEqual(window.end_time_utc, START - timedelta(seconds=5))
        self.assertEqual(
            window.start_time_utc,
            window.end_time_utc - timedelta(seconds=2400),
        )

    def test_active_windows_are_contiguous_without_duplicate_logical_second(self):
        cursor = ServerPollCursor()
        first = cursor.next_window(START)
        assert first is not None
        cursor.complete(first, completed_at_utc=START, server_awake=True)
        self.assertEqual(cursor.next_due_utc, START + timedelta(seconds=5))
        self.assertIsNone(cursor.next_window(START + timedelta(seconds=4)))

        second = cursor.next_window(START + timedelta(seconds=5))
        assert second is not None
        self.assertEqual(
            second.start_time_utc,
            first.end_time_utc + timedelta(seconds=1),
        )
        self.assertEqual(second.end_time_utc, START)

    def test_idle_server_uses_probe_interval_but_keeps_watermark(self):
        config = LivePollConfig(idle_probe_seconds=300)
        cursor = ServerPollCursor(config)
        first = cursor.next_window(START)
        assert first is not None
        cursor.complete(first, completed_at_utc=START, server_awake=False)
        self.assertFalse(cursor.awake)
        self.assertEqual(cursor.next_due_utc, START + timedelta(seconds=300))
        self.assertIsNone(cursor.next_window(START + timedelta(seconds=299)))
        later = cursor.next_window(START + timedelta(seconds=300))
        assert later is not None
        self.assertEqual(later.start_time_utc, first.end_time_utc + timedelta(seconds=1))

    def test_failed_query_retries_without_advancing_watermark(self):
        cursor = ServerPollCursor()
        first = cursor.next_window(START)
        assert first is not None
        cursor.complete(first, completed_at_utc=START, server_awake=True)
        watermark = cursor.last_processed_utc
        failure_time = START + timedelta(seconds=5)
        cursor.defer_after_error(failed_at_utc=failure_time)
        self.assertEqual(cursor.last_processed_utc, watermark)
        self.assertEqual(cursor.next_due_utc, failure_time + timedelta(seconds=5))

    def test_checkpoint_roundtrip_preserves_schedule_and_watermark(self):
        cursor = ServerPollCursor()
        window = cursor.next_window(START)
        assert window is not None
        cursor.complete(window, completed_at_utc=START, server_awake=True)
        state = cursor.export_state()

        restored = ServerPollCursor()
        restored.restore_state(state)
        self.assertEqual(restored.last_processed_utc, cursor.last_processed_utc)
        self.assertEqual(restored.next_due_utc, cursor.next_due_utc)
        self.assertTrue(restored.awake)
        self.assertEqual(
            restored.next_window(START + timedelta(seconds=5)),
            cursor.next_window(START + timedelta(seconds=5)),
        )

    def test_non_contiguous_completion_is_rejected(self):
        cursor = ServerPollCursor()
        first = cursor.next_window(START)
        assert first is not None
        cursor.complete(first, completed_at_utc=START, server_awake=True)
        bad = PollWindow(
            first.end_time_utc + timedelta(seconds=2),
            first.end_time_utc + timedelta(seconds=3),
        )
        with self.assertRaisesRegex(ValueError, "contiguous"):
            cursor.complete(
                bad,
                completed_at_utc=START + timedelta(seconds=5),
                server_awake=True,
            )

    def test_invalid_configuration_is_rejected(self):
        with self.assertRaises(ValueError):
            LivePollConfig(join_tolerance_seconds=0)
        with self.assertRaisesRegex(ValueError, "slower"):
            LivePollConfig(active_poll_seconds=301, idle_probe_seconds=300)


if __name__ == "__main__":
    unittest.main()
