"""Operational orchestration across ingestion and runtime publication.

The transactional ingest coordinator may replace its ``CoreSession`` object when
restoring a checkpoint after a failed poll. A publisher must therefore never
assume that the session reference captured at construction remains current.
This module owns that synchronization boundary and isolates failures by server.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Callable, Mapping, Protocol

from bluewolf_core.semantic_session import CoreSession

from .ingest_coordinator import IngestPollResult
from .producer import RuntimePublicationResult


class _Coordinator(Protocol):
    server_id: int
    session: CoreSession

    def poll_once(self, now_utc: datetime) -> IngestPollResult | None: ...


class _Producer(Protocol):
    session: CoreSession

    def publish_poll(self, poll: IngestPollResult) -> RuntimePublicationResult: ...


@dataclass(frozen=True, slots=True)
class OperationalPipelineResult:
    server_id: int
    poll: IngestPollResult | None
    publication: RuntimePublicationResult | None


class OperationalServerPipeline:
    """One server's rollback-safe ingest -> publication composition."""

    def __init__(self, coordinator: _Coordinator, producer: _Producer) -> None:
        self.coordinator = coordinator
        self.producer = producer

    @property
    def server_id(self) -> int:
        return self.coordinator.server_id

    def poll_once(self, now_utc: datetime) -> OperationalPipelineResult:
        poll = self.coordinator.poll_once(now_utc)
        if poll is None:
            return OperationalPipelineResult(self.server_id, None, None)

        # poll_once may be the first success after an earlier rollback that
        # replaced coordinator.session. Always bind publication to the current
        # committed session immediately before consuming the successful batch.
        self.producer.session = self.coordinator.session
        publication = self.producer.publish_poll(poll)
        return OperationalPipelineResult(self.server_id, poll, publication)


@dataclass(frozen=True, slots=True)
class OperationalTick:
    at_utc: datetime
    results: Mapping[int, OperationalPipelineResult]
    errors: Mapping[int, str]

    def __post_init__(self) -> None:
        object.__setattr__(self, "results", MappingProxyType(dict(self.results)))
        object.__setattr__(self, "errors", MappingProxyType(dict(self.errors)))


class OperationalRuntimeLoop:
    """Poll multiple independent servers without one failure blocking the rest."""

    def __init__(self, pipelines: tuple[OperationalServerPipeline, ...]) -> None:
        ids = [pipeline.server_id for pipeline in pipelines]
        if len(ids) != len(set(ids)):
            raise ValueError("operational server ids must be unique")
        self.pipelines = tuple(sorted(pipelines, key=lambda item: item.server_id))

    def tick(self, now_utc: datetime) -> OperationalTick:
        if now_utc.tzinfo is None:
            raise ValueError("operational loop time must be timezone-aware")
        now = now_utc.astimezone(UTC)
        results: dict[int, OperationalPipelineResult] = {}
        errors: dict[int, str] = {}
        for pipeline in self.pipelines:
            try:
                results[pipeline.server_id] = pipeline.poll_once(now)
            except Exception as exc:  # one source must not starve other servers.
                errors[pipeline.server_id] = f"{type(exc).__name__}: {exc}"
        return OperationalTick(now, results, errors)

    def run_forever(
        self,
        *,
        stop_requested: Callable[[], bool],
        clock: Callable[[], datetime],
        sleep: Callable[[float], None],
        loop_sleep_seconds: float = 1.0,
        on_tick: Callable[[OperationalTick], None] | None = None,
    ) -> None:
        if loop_sleep_seconds <= 0.0:
            raise ValueError("loop_sleep_seconds must be positive")
        while not stop_requested():
            tick = self.tick(clock())
            if on_tick is not None:
                on_tick(tick)
            if not stop_requested():
                sleep(loop_sleep_seconds)


__all__ = [
    "OperationalPipelineResult",
    "OperationalRuntimeLoop",
    "OperationalServerPipeline",
    "OperationalTick",
]
