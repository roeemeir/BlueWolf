"""Checkpointable ten-second display score for ONE already-scored Core group.

Only an actual valid selected-template ``GroupScores.total`` can enter this
window. The output is the arithmetic mean of *observed* Core group scores in
the trailing ten seconds. No values are interpolated or carried across invalid
samples, temporal gaps, route/context changes, or group end. Alternate-template
comparison stays raw; this display policy never participates in grouping.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
import math
from typing import Any, Mapping

from .models import GroupScores


class CoreDisplayedScoreWindow:
    """One idempotence-checked live group-score filter with restart support."""

    def __init__(self, *, duration_seconds: float = 10.0, max_gap_seconds: float = 5.0) -> None:
        if not math.isfinite(duration_seconds) or duration_seconds <= 0.0:
            raise ValueError("display score window duration must be finite and positive")
        if not math.isfinite(max_gap_seconds) or max_gap_seconds <= 0.0:
            raise ValueError("display score maximum contiguous gap must be finite and positive")
        self.duration_seconds = float(duration_seconds)
        self.max_gap_seconds = float(max_gap_seconds)
        self._history: dict[str, tuple[str, list[tuple[datetime, float]]]] = {}

    def clear(self, group_id: str) -> None:
        self._history.pop(group_id, None)

    def observe(
        self,
        group_id: str,
        context_key: str,
        observed_at_utc: datetime,
        group_scores: GroupScores | None,
    ) -> tuple[float | None, bool]:
        if not group_id or not context_key:
            raise ValueError("group id and context key are required")
        if observed_at_utc.tzinfo is None:
            raise ValueError("Core display score requires an aware sample timestamp")
        observed_at = observed_at_utc.astimezone(UTC)
        if (
            group_scores is None
            or not group_scores.valid
            or group_scores.valid_vehicle_count < 2
            or group_scores.total is None
        ):
            self.clear(group_id)
            return None, False
        score = float(group_scores.total)
        if not math.isfinite(score) or not 0.0 <= score <= 100.0:
            raise ValueError("valid Core group score must be finite and in [0,100]")

        previous = self._history.get(group_id)
        rows: list[tuple[datetime, float]] = []
        if previous is not None and previous[0] == context_key:
            rows = previous[1]
            gap = (observed_at - rows[-1][0]).total_seconds()
            if gap <= 0.0:
                raise ValueError("Core display scores must be observed at strictly increasing timestamps")
            if gap > self.max_gap_seconds:
                rows = []
        cutoff = observed_at - timedelta(seconds=self.duration_seconds)
        rows = [(when, value) for when, value in rows if when > cutoff]
        rows.append((observed_at, score))
        self._history[group_id] = (context_key, rows)
        return sum(value for _, value in rows) / len(rows), True

    def export_state(self) -> dict[str, Any]:
        return {
            "schemaVersion": "bluewolf.core-display-score.v1",
            "durationSeconds": self.duration_seconds,
            "maxGapSeconds": self.max_gap_seconds,
            "groups": [
                {
                    "groupId": group_id,
                    "contextKey": context_key,
                    "samples": [
                        {"observedAtUtc": when.isoformat().replace("+00:00", "Z"), "total": score}
                        for when, score in rows
                    ],
                }
                for group_id, (context_key, rows) in sorted(self._history.items())
            ],
        }

    def restore_state(self, state: Mapping[str, Any]) -> None:
        if state.get("schemaVersion") != "bluewolf.core-display-score.v1":
            raise ValueError("unsupported Core display-score state schema")
        if state.get("durationSeconds") != self.duration_seconds or state.get("maxGapSeconds") != self.max_gap_seconds:
            raise ValueError("Core display-score checkpoint uses a different timing policy")
        raw_groups = state.get("groups")
        if not isinstance(raw_groups, list):
            raise ValueError("Core display-score groups must be a list")
        restored: dict[str, tuple[str, list[tuple[datetime, float]]]] = {}
        for raw in raw_groups:
            if not isinstance(raw, Mapping):
                raise ValueError("Core display-score group must be an object")
            group_id = raw.get("groupId")
            context_key = raw.get("contextKey")
            samples = raw.get("samples")
            if not isinstance(group_id, str) or not group_id or group_id in restored:
                raise ValueError("Core display-score group ids must be unique and non-empty")
            if not isinstance(context_key, str) or not context_key:
                raise ValueError("Core display-score context key is required")
            if not isinstance(samples, list) or not samples:
                raise ValueError("Core display-score checkpoint samples must be non-empty")
            entries: list[tuple[datetime, float]] = []
            for sample in samples:
                if not isinstance(sample, Mapping):
                    raise ValueError("Core display-score sample must be an object")
                timestamp = sample.get("observedAtUtc")
                if not isinstance(timestamp, str):
                    raise ValueError("Core display-score timestamp must be text")
                try:
                    when = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                except ValueError as exc:
                    raise ValueError("Core display-score timestamp is invalid") from exc
                if when.tzinfo is None:
                    raise ValueError("Core display-score timestamp must include UTC")
                when = when.astimezone(UTC)
                raw_score = sample.get("total")
                if isinstance(raw_score, bool) or not isinstance(raw_score, (int, float)):
                    raise ValueError("Core display-score sample score must be numeric")
                score = float(raw_score)
                if not math.isfinite(score) or not 0.0 <= score <= 100.0:
                    raise ValueError("Core display-score sample score must be finite and in [0,100]")
                if entries and (when - entries[-1][0]).total_seconds() <= 0:
                    raise ValueError("Core display-score checkpoint timestamps must increase")
                if entries and (when - entries[-1][0]).total_seconds() > self.max_gap_seconds:
                    raise ValueError("Core display-score checkpoint contains a temporal gap")
                entries.append((when, score))
            if (entries[-1][0] - entries[0][0]).total_seconds() >= self.duration_seconds:
                raise ValueError("Core display-score checkpoint exceeds the window duration")
            restored[group_id] = (context_key, entries)
        self._history = restored


__all__ = ["CoreDisplayedScoreWindow"]
