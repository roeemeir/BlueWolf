"""Generic deterministic latest-cycle selection for Blue Wolf.

The 40-minute route-history buffer is evidence/recovery storage, not the active
fit window. Once a route period is known, the active geometry is fitted from the
latest period-length traversal plus one boundary sample immediately before it.
This helper intentionally makes no assumption about route family, centre, axis,
turn count or self-crossing topology.
"""

from __future__ import annotations

from bisect import bisect_left
from datetime import datetime, timedelta
from typing import Any, Mapping, Sequence, TypeVar

from .models import VehicleSample

T = TypeVar("T")


def _slice_latest_cycle(
    ordered: Sequence[T],
    times: Sequence[datetime],
    period_seconds: float | None,
    *,
    minimum_items: int,
) -> list[T]:
    if not ordered or period_seconds is None or period_seconds <= 0:
        return list(ordered)
    end = times[-1]
    target = end - timedelta(seconds=float(period_seconds))
    index = bisect_left(times, target)
    # Include exactly one sample before the estimated boundary when available.
    # This avoids losing closure because of discrete sampling without inventing
    # a percentage padding that would depend on route shape or period.
    if index > 0:
        index -= 1
    selected = list(ordered[index:])
    return selected if len(selected) >= minimum_items else list(ordered)


def latest_cycle_vehicle_samples(
    samples: Sequence[VehicleSample],
    period_seconds: float | None,
    *,
    minimum_items: int = 12,
) -> list[VehicleSample]:
    ordered = sorted(samples, key=lambda sample: sample.sample_time_utc)
    return _slice_latest_cycle(
        ordered,
        [sample.sample_time_utc for sample in ordered],
        period_seconds,
        minimum_items=minimum_items,
    )


def _mapping_time(sample: Mapping[str, Any]) -> datetime:
    raw = str(sample["timestamp"])
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def latest_cycle_mapping_samples(
    samples: Sequence[Mapping[str, Any]],
    period_seconds: float | None,
    *,
    minimum_items: int = 4,
) -> list[Mapping[str, Any]]:
    ordered = sorted(samples, key=_mapping_time)
    return _slice_latest_cycle(
        ordered,
        [_mapping_time(sample) for sample in ordered],
        period_seconds,
        minimum_items=minimum_items,
    )


__all__ = ["latest_cycle_vehicle_samples", "latest_cycle_mapping_samples"]
