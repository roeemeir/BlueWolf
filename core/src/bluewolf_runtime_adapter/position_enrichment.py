"""Add observed WGS84 positions to an application runtime snapshot.

This adapter is intentionally downstream of scoring serialization. It uses only
real samples at the group's own ``observedAt`` timestamp; it never reconstructs
position from route geometry, phase or a newer/older sample.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
import math
from types import MappingProxyType
from typing import Any, Mapping, Sequence

from bluewolf_core.models import VehicleSample

from .ingest_coordinator import IngestPollResult
from .producer import LiveRuntimeProducer, RuntimePublicationResult


def _parse_utc(value: object) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError("runtime group observedAt is required for position enrichment")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("runtime group observedAt must be timezone-aware")
    return parsed.astimezone(UTC)


def _navigation_heading(sample: VehicleSample) -> float | None:
    east = sample.velocity_east_mps
    north = sample.velocity_north_mps
    if east is None or north is None:
        return None
    east_f = float(east)
    north_f = float(north)
    if not math.isfinite(east_f) or not math.isfinite(north_f):
        return None
    if math.hypot(east_f, north_f) <= 1e-12:
        return None
    # Navigation convention: north=0, east=90, clockwise positive.
    return math.degrees(math.atan2(east_f, north_f)) % 360.0


def _sample_index(
    samples: Sequence[VehicleSample],
) -> Mapping[tuple[str, datetime, int], VehicleSample]:
    output: dict[tuple[str, datetime, int], VehicleSample] = {}
    for sample in samples:
        key = (
            str(sample.server_id),
            sample.sample_time_utc.astimezone(UTC),
            sample.vehicle_identifier,
        )
        previous = output.get(key)
        if previous is not None and previous != sample:
            raise ValueError("ambiguous duplicate sample during position enrichment")
        output[key] = sample
    return MappingProxyType(output)


def _enrich_group(
    group: dict[str, Any],
    *,
    server_id: str,
    sample_index: Mapping[tuple[str, datetime, int], VehicleSample],
) -> None:
    observed_at = _parse_utc(group.get("observedAt"))
    members = group.get("members")
    if not isinstance(members, list):
        return
    for member in members:
        if not isinstance(member, dict):
            continue
        vehicle_id = member.get("id")
        if isinstance(vehicle_id, bool) or not isinstance(vehicle_id, int):
            continue
        sample = sample_index.get((server_id, observed_at, vehicle_id))
        if sample is None or sample.latitude_deg is None or sample.longitude_deg is None:
            continue
        latitude = float(sample.latitude_deg)
        longitude = float(sample.longitude_deg)
        if not math.isfinite(latitude) or not math.isfinite(longitude):
            continue
        member["latitude"] = latitude
        member["longitude"] = longitude
        heading = _navigation_heading(sample)
        if heading is not None:
            member["headingDeg"] = heading


def enrich_runtime_snapshot_positions(
    snapshot: Mapping[str, object],
    samples: Sequence[VehicleSample],
) -> Mapping[str, object]:
    """Return a detached snapshot enriched only by same-timestamp observations."""

    server_id = snapshot.get("serverId")
    if not isinstance(server_id, str) or not server_id:
        raise ValueError("runtime snapshot serverId is required")
    enriched = deepcopy(dict(snapshot))
    index = _sample_index(samples)

    group_list = enriched.get("groupList")
    if isinstance(group_list, list):
        for group in group_list:
            if isinstance(group, dict):
                _enrich_group(group, server_id=server_id, sample_index=index)

    legacy = enriched.get("groups")
    if isinstance(legacy, dict):
        for group in legacy.values():
            if isinstance(group, dict):
                _enrich_group(group, server_id=server_id, sample_index=index)

    return MappingProxyType(enriched)


class PositionEnrichedLiveRuntimeProducer(LiveRuntimeProducer):
    """LiveRuntimeProducer that republishes the committed snapshot with map evidence.

    The parent producer remains the source of grouping/scoring/event semantics.
    This subclass only adds presentation coordinates from the same poll. The
    final store value is the enriched snapshot.
    """

    def publish_poll(self, poll: IngestPollResult) -> RuntimePublicationResult:
        result = super().publish_poll(poll)
        if result.snapshot is None:
            return result
        enriched = enrich_runtime_snapshot_positions(result.snapshot, poll.samples)
        self.store.publish(enriched)
        return RuntimePublicationResult(
            enriched,
            result.published_group_ids,
            result.skipped_groups,
        )


__all__ = [
    "PositionEnrichedLiveRuntimeProducer",
    "enrich_runtime_snapshot_positions",
]
