"""Lifecycle host for the operational polling loop beside the ASGI service.

The current runtime store is process-local, so ingestion/publication and the
HTTP transport must share one process.  This module starts one background loop
thread and provides an explicit deployment bootstrap hook without putting
Influx or product configuration into ``bluewolf_core``.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from importlib import import_module
import os
from threading import Event, Lock, Thread
from typing import Any, Callable, Protocol

from .operational_pipeline import OperationalRuntimeLoop, OperationalTick


class OperationalLoopFactory(Protocol):
    def __call__(self, store: Any) -> OperationalRuntimeLoop: ...


def load_operational_loop_factory(spec: str) -> OperationalLoopFactory:
    """Load ``module:function`` and require a callable operational-loop factory."""

    value = spec.strip()
    module_name, separator, attribute_name = value.partition(":")
    if not separator or not module_name or not attribute_name:
        raise ValueError("operational factory must use module:function syntax")
    module = import_module(module_name)
    factory = getattr(module, attribute_name, None)
    if not callable(factory):
        raise ValueError(f"operational factory is not callable: {value}")
    return factory


@dataclass(frozen=True, slots=True)
class OperationalHostSnapshot:
    enabled: bool
    running: bool
    tick_count: int
    last_tick_utc: datetime | None
    last_errors: tuple[tuple[int, str], ...]
    thread_error: str | None


class OperationalLoopHost:
    """Own exactly one background thread for an ``OperationalRuntimeLoop``."""

    def __init__(
        self,
        loop: OperationalRuntimeLoop,
        *,
        loop_sleep_seconds: float = 1.0,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if loop_sleep_seconds <= 0.0:
            raise ValueError("loop_sleep_seconds must be positive")
        self.loop = loop
        self.loop_sleep_seconds = float(loop_sleep_seconds)
        self.clock = clock or (lambda: datetime.now(UTC))
        self._stop = Event()
        self._lock = Lock()
        self._thread: Thread | None = None
        self._tick_count = 0
        self._last_tick_utc: datetime | None = None
        self._last_errors: tuple[tuple[int, str], ...] = ()
        self._thread_error: str | None = None

    @property
    def running(self) -> bool:
        thread = self._thread
        return bool(thread is not None and thread.is_alive())

    def snapshot(self) -> OperationalHostSnapshot:
        with self._lock:
            return OperationalHostSnapshot(
                enabled=True,
                running=self.running,
                tick_count=self._tick_count,
                last_tick_utc=self._last_tick_utc,
                last_errors=self._last_errors,
                thread_error=self._thread_error,
            )

    def _record_tick(self, tick: OperationalTick) -> None:
        with self._lock:
            self._tick_count += 1
            self._last_tick_utc = tick.at_utc
            self._last_errors = tuple(sorted(tick.errors.items()))

    def _run(self) -> None:
        try:
            self.loop.run_forever(
                stop_requested=self._stop.is_set,
                clock=self.clock,
                sleep=self._stop.wait,
                loop_sleep_seconds=self.loop_sleep_seconds,
                on_tick=self._record_tick,
            )
        except Exception as exc:  # lifecycle failure must remain observable.
            with self._lock:
                self._thread_error = f"{type(exc).__name__}: {exc}"

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        with self._lock:
            self._thread_error = None
        self._thread = Thread(
            target=self._run,
            name="bluewolf-operational-runtime",
            daemon=True,
        )
        self._thread.start()

    def stop(self, *, join_timeout_seconds: float = 5.0) -> None:
        if join_timeout_seconds <= 0.0:
            raise ValueError("join_timeout_seconds must be positive")
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(join_timeout_seconds)
            if thread.is_alive():
                raise TimeoutError("operational runtime thread did not stop")


def host_from_environment(store: Any) -> OperationalLoopHost | None:
    """Create the optional process-local operational loop from environment."""

    spec = os.environ.get("BLUEWOLF_OPERATIONAL_FACTORY", "").strip()
    if not spec:
        return None
    factory = load_operational_loop_factory(spec)
    loop = factory(store)
    if not isinstance(loop, OperationalRuntimeLoop):
        raise TypeError("operational factory must return OperationalRuntimeLoop")
    sleep_seconds = float(os.environ.get("BLUEWOLF_OPERATIONAL_LOOP_SECONDS", "1"))
    return OperationalLoopHost(loop, loop_sleep_seconds=sleep_seconds)


__all__ = [
    "OperationalHostSnapshot",
    "OperationalLoopFactory",
    "OperationalLoopHost",
    "host_from_environment",
    "load_operational_loop_factory",
]
