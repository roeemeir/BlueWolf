"""Transactional composition of live Influx windows into the semantic CoreSession.

This layer advances ingestion, the semantic core and the optional durable joined
sample archive as one logical transaction. It intentionally does not build UI
snapshots or choose templates: publication is downstream and a transient
publication failure must not replay a batch through temporal core state.

When an archive is configured, the watermark is not advanced unless the joined
samples were durably recorded. A changed historical sample is reported by the
archive for a future checkpoint replay path; it is never injected directly into
a CoreSession that already advanced past that timestamp.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Protocol

from bluewolf_core.models import CoreBatchResult, VehicleSample
from bluewolf_core.semantic_session import CoreSession
from bluewolf_ingest.polling import PollWindow, ServerPollCursor
from bluewolf_ingest.window_reader import InfluxDB2WindowReader

from .sample_archive import SampleArchiveWriteResult

AwakeResolver = Callable[[tuple[VehicleSample, ...], CoreBatchResult, PollWindow], bool]


class SampleArchiveWriter(Protocol):
    def record_batch(
        self,
        samples: tuple[VehicleSample, ...],
        *,
        recorded_at_utc: datetime,
    ) -> SampleArchiveWriteResult: ...


@dataclass(frozen=True, slots=True)
class IngestPollResult:
    window: PollWindow
    samples: tuple[VehicleSample, ...]
    core_result: CoreBatchResult
    server_awake: bool
    archive_result: SampleArchiveWriteResult | None = None


class LiveCoreIngestCoordinator:
    """One server's query -> join -> semantic-core -> archive transaction."""

    def __init__(
        self,
        *,
        server_id: int,
        server_tag_value: str | None,
        reader: InfluxDB2WindowReader,
        session: CoreSession,
        cursor: ServerPollCursor,
        awake_resolver: AwakeResolver,
        sample_archive: SampleArchiveWriter | None = None,
    ) -> None:
        if isinstance(server_id, bool) or not isinstance(server_id, int) or server_id < 0:
            raise ValueError("server_id must be a non-negative integer")
        self.server_id = server_id
        self.server_tag_value = server_tag_value
        self.reader = reader
        self.session = session
        self.cursor = cursor
        self.awake_resolver = awake_resolver
        self.sample_archive = sample_archive

    def poll_once(self, now_utc: datetime) -> IngestPollResult | None:
        window = self.cursor.next_window(now_utc)
        if window is None:
            return None

        checkpoint = self.session.export_checkpoint()
        try:
            samples = self.reader.read_samples(
                server_id=self.server_id,
                server_tag_value=self.server_tag_value,
                start_time_utc=window.start_time_utc,
                end_time_utc=window.end_time_utc,
            )
            core_result = self.session.process_batch(
                samples,
                observed_until_utc=window.end_time_utc,
            )
            server_awake = bool(self.awake_resolver(samples, core_result, window))
            archive_result = (
                None
                if self.sample_archive is None
                else self.sample_archive.record_batch(
                    samples,
                    recorded_at_utc=now_utc,
                )
            )
        except Exception:
            # A partially processed batch must never coexist with an unchanged
            # ingestion watermark. Archive failure is therefore also a core
            # transaction failure; the same window will be retried.
            self.session = type(self.session).from_checkpoint(
                checkpoint,
                config=self.session.config,
                algorithm_version=self.session.algorithm_version,
            )
            self.cursor.defer_after_error(failed_at_utc=now_utc)
            raise

        self.cursor.complete(
            window,
            completed_at_utc=now_utc,
            server_awake=server_awake,
        )
        return IngestPollResult(
            window=window,
            samples=samples,
            core_result=core_result,
            server_awake=server_awake,
            archive_result=archive_result,
        )


__all__ = [
    "AwakeResolver",
    "IngestPollResult",
    "LiveCoreIngestCoordinator",
    "SampleArchiveWriter",
]
