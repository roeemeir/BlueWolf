from __future__ import annotations

import os
import sys
import time
import types
import unittest
from datetime import UTC, datetime
from unittest.mock import patch

from bluewolf_runtime_adapter.operational_pipeline import OperationalRuntimeLoop, OperationalTick
from bluewolf_runtime_adapter.runtime_host import (
    OperationalLoopHost,
    host_from_environment,
    load_operational_loop_factory,
)


NOW = datetime(2026, 9, 9, 19, 30, tzinfo=UTC)


class _Loop:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls = 0

    def run_forever(self, *, stop_requested, clock, sleep, loop_sleep_seconds, on_tick=None):
        if self.fail:
            raise RuntimeError("synthetic host failure")
        while not stop_requested():
            self.calls += 1
            tick = OperationalTick(clock(), {}, {})
            if on_tick is not None:
                on_tick(tick)
            sleep(loop_sleep_seconds)


class RuntimeHostTests(unittest.TestCase):
    def test_background_host_starts_records_ticks_and_stops(self) -> None:
        loop = _Loop()
        host = OperationalLoopHost(loop, loop_sleep_seconds=0.01, clock=lambda: NOW)

        host.start()
        deadline = time.monotonic() + 1.0
        while host.snapshot().tick_count == 0 and time.monotonic() < deadline:
            time.sleep(0.005)
        snapshot = host.snapshot()
        self.assertTrue(snapshot.running)
        self.assertGreaterEqual(snapshot.tick_count, 1)
        self.assertEqual(snapshot.last_tick_utc, NOW)
        self.assertEqual(snapshot.last_errors, ())

        host.stop()
        self.assertFalse(host.snapshot().running)

    def test_host_records_terminal_thread_failure(self) -> None:
        host = OperationalLoopHost(_Loop(fail=True), loop_sleep_seconds=0.01)
        host.start()
        deadline = time.monotonic() + 1.0
        while host.snapshot().thread_error is None and time.monotonic() < deadline:
            time.sleep(0.005)
        snapshot = host.snapshot()
        self.assertIn("synthetic host failure", snapshot.thread_error or "")
        host.stop()

    def test_factory_loader_requires_module_function_and_callable(self) -> None:
        module = types.ModuleType("bluewolf_test_runtime_factory")
        module.make_loop = lambda store: OperationalRuntimeLoop(())
        module.not_callable = 7
        sys.modules[module.__name__] = module
        self.addCleanup(sys.modules.pop, module.__name__, None)

        factory = load_operational_loop_factory(f"{module.__name__}:make_loop")
        self.assertIsInstance(factory(object()), OperationalRuntimeLoop)
        with self.assertRaisesRegex(ValueError, "module:function"):
            load_operational_loop_factory(module.__name__)
        with self.assertRaisesRegex(ValueError, "not callable"):
            load_operational_loop_factory(f"{module.__name__}:not_callable")

    def test_environment_bootstrap_is_disabled_unless_explicitly_configured(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(host_from_environment(object()))

    def test_environment_bootstrap_passes_shared_store_to_factory(self) -> None:
        module = types.ModuleType("bluewolf_test_runtime_environment")
        seen: list[object] = []

        def make_loop(store):
            seen.append(store)
            return OperationalRuntimeLoop(())

        module.make_loop = make_loop
        sys.modules[module.__name__] = module
        self.addCleanup(sys.modules.pop, module.__name__, None)
        store = object()
        with patch.dict(
            os.environ,
            {
                "BLUEWOLF_OPERATIONAL_FACTORY": f"{module.__name__}:make_loop",
                "BLUEWOLF_OPERATIONAL_LOOP_SECONDS": "0.25",
            },
            clear=True,
        ):
            host = host_from_environment(store)

        self.assertIsNotNone(host)
        assert host is not None
        self.assertEqual(seen, [store])
        self.assertEqual(host.loop_sleep_seconds, 0.25)


if __name__ == "__main__":
    unittest.main()
