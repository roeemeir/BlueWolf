"""Deterministic polling windows for live Influx ingestion.

The scheduler owns only time/watermark semantics. It does not infer whether a
server is awake from scores, routes or vehicle identifiers; the operational
coordinator supplies that state explicitly after processing a batch.

A poll never processes through wall-clock ``now``. Its safe end is delayed by
the join tolerance so interpolation may use source evidence on both sides while
keeping the default live latency within the V1 ten-second envelope.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import math


@dataclass(frozen=True, slots=True)
class LivePollConfig:
    logical_grid_seconds: int = 1
    active_poll_seconds: int = 5
    idle_probe_seconds: int = 300
    join_tolerance_seconds: int = 5
    bootstrap_history_seconds: int = 2400

    def __post_init__(self) -> None:
        for name in (
            "logical_grid_seconds",
            "active_poll_seconds",
            "idle_probe_seconds",
            "join_tolerance_seconds",
            "bootstrap_history_seconds",
        ):
            if int(getattr(self, name)) <= 0:
                raise ValueError(f"{name} must be positive")
        if self.active_poll_seconds > self.idle_probe_seconds:
            raise ValueError("active polling cannot be slower than idle probing")


@dataclass(frozen=True, slots=True)
class PollWindow:
    start_time_utc: datetime
    end_time_utc: datetime

    def __post_init__(self) -> None:
        if self.start_time_utc.tzinfo is None or self.end_time_utc.tzinfo is None:
            raise ValueError("poll window must be timezone-aware")
        if self.end_time_utc < self.start_time_utc:
            raise ValueError("poll window end cannot precede start")


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("poll time must be timezone-aware")
    return value.astimezone(UTC)


def _floor_grid(value: datetime, seconds: int) -> datetime:
    value = _utc(value)
    stamp = value.timestamp()
    return datetime.fromtimestamp(math.floor(stamp / seconds) * seconds, tz=UTC)


class ServerPollCursor:
    """One server's non-overlapping logical processing watermark."""

    def __init__(self, config: LivePollConfig | None = None) -> None:
        self.config = config or LivePollConfig()
        self.last_processed_utc: datetime | None = None
        self.next_due_utc: datetime | None = None
        self.awake: bool = False

    def is_due(self, now_utc: datetime) -> bool:
        now = _utc(now_utc)
        return self.next_due_utc is None or now >= self.next_due_utc

    def next_window(self, now_utc: datetime) -> PollWindow | None:
        now = _utc(now_utc)
        if not self.is_due(now):
            return None
        safe_end = _floor_grid(
            now - timedelta(seconds=self.config.join_tolerance_seconds),
            self.config.logical_grid_seconds,
        )
        if self.last_processed_utc is None:
            start = safe_end - timedelta(seconds=self.config.bootstrap_history_seconds)
        else:
            start = self.last_processed_utc + timedelta(
                seconds=self.config.logical_grid_seconds
            )
        if start > safe_end:
            return None
        return PollWindow(start, safe_end)

    def complete(
        self,
        window: PollWindow,
        *,
        completed_at_utc: datetime,
        server_awake: bool,
    ) -> None:
        completed_at = _utc(completed_at_utc)
        if self.last_processed_utc is not None:
            expected = self.last_processed_utc + timedelta(
                seconds=self.config.logical_grid_seconds
            )
            if window.start_time_utc.astimezone(UTC) != expected:
                raise ValueError("poll completion window is not contiguous with watermark")
        end = window.end_time_utc.astimezone(UTC)
        if self.last_processed_utc is not None and end <= self.last_processed_utc:
            raise ValueError("poll completion must advance the watermark")
        self.last_processed_utc = end
        self.awake = bool(server_awake)
        delay = (
            self.config.active_poll_seconds
            if self.awake
            else self.config.idle_probe_seconds
        )
        self.next_due_utc = completed_at + timedelta(seconds=delay)

    def defer_after_error(self, *, failed_at_utc: datetime) -> None:
        """Retry a failed active query at active cadence without moving watermark."""

        failed_at = _utc(failed_at_utc)
        self.next_due_utc = failed_at + timedelta(seconds=self.config.active_poll_seconds)

    def export_state(self) -> dict[str, object]:
        return {
            "last_processed_utc": (
                None
                if self.last_processed_utc is None
                else self.last_processed_utc.isoformat().replace("+00:00", "Z")
            ),
            "next_due_utc": (
                None
                if self.next_due_utc is None
                else self.next_due_utc.isoformat().replace("+00:00", "Z")
            ),
            "awake": self.awake,
        }

    def restore_state(self, state: dict[str, object]) -> None:
        def parse(value: object) -> datetime | None:
            if value is None:
                return None
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return _utc(parsed)

        self.last_processed_utc = parse(state.get("last_processed_utc"))
        self.next_due_utc = parse(state.get("next_due_utc"))
        self.awake = bool(state.get("awake", False))


__all__ = ["LivePollConfig", "PollWindow", "ServerPollCursor"]
