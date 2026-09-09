"""Transactional composition of live Influx windows into the semantic CoreSession.

This layer advances ingestion and the core watermark together. It intentionally
does not build UI snapshots or choose templates: publication is downstream and
a transient publication failure must not replay a batch through temporal core
state.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable

from bluewolf_core.models import CoreBatchResult, VehicleSample
from bluewolf_core.semantic_session import CoreSession
from bluewolf_ingest.polling import PollWindow, ServerPollCursor
from bluewolf_ingest.window_reader import InfluxDB2WindowReader

AwakeResolver = Callable[[tuple[VehicleSample, ...], CoreBatchResult, PollWindow], bool]


@dataclass(frozen=True, slots=True)
class IngestPollResult:
    window: PollWindow
    samples: tuple[VehicleSample, ...]
    core_result: CoreBatchResult
    server_awake: bool


class LiveCoreIngestCoordinator:
    """One server's query -> join -> semantic-core polling transaction."""

    def __init__(
        self,
        *,
        server_id: int,
        server_tag_value: str | None,
        reader: InfluxDB2WindowReader,
        session: CoreSession,
        cursor: ServerPollCursor,
        awake_resolver: AwakeResolver,
    ) -> None:
        if isinstance(server_id, bool) or not isinstance(server_id, int) or server_id < 0:
            raise ValueError("server_id must be a non-negative integer")
        self.server_id = server_id
        self.server_tag_value = server_tag_value
        self.reader = reader
        self.session = session
        self.cursor = cursor
        self.awake_resolver = awake_resolver

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
        except Exception:
            # A partially processed batch must never coexist with an unchanged
            # ingestion watermark. Restore the semantic core transactionally.
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
        )


__all__ = ["AwakeResolver", "IngestPollResult", "LiveCoreIngestCoordinator"]
