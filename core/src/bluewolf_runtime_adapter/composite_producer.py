"""Compose independent family producers into one atomic live snapshot.

SI and SO keep separate scoring/lifecycle implementations.  This adapter merges
their already-validated payloads and publishes once, preventing one family from
overwriting the other in ``RuntimeSnapshotStore``.
"""
from __future__ import annotations

from datetime import UTC, datetime
from types import MappingProxyType
from typing import Mapping, Protocol

from .contract import LIVE_RUNTIME_SCHEMA_VERSION
from .ingest_coordinator import IngestPollResult
from .position_enrichment import enrich_runtime_snapshot_positions
from .producer import RuntimePublicationResult
from .service import RuntimeSnapshotStore


class RuntimeFamilyProducer(Protocol):
    def publish_poll(self, poll: IngestPollResult) -> RuntimePublicationResult: ...
    def export_state(self) -> dict[str, object]: ...
    def restore_state(self, state: Mapping[str, object]) -> None: ...


class DiscardingRuntimeSnapshotStore:
    """Store-shaped sink for child producers; only the composite may commit."""

    def publish(self, snapshot: Mapping[str, object]) -> None:
        del snapshot


def _parse_utc(value: object) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError("runtime observedAt is required")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("runtime observedAt must be timezone-aware")
    return parsed.astimezone(UTC)


class CompositeRuntimeProducer:
    def __init__(
        self,
        *,
        server_id: int,
        producers: tuple[tuple[str, RuntimeFamilyProducer], ...],
        store: RuntimeSnapshotStore,
    ) -> None:
        if isinstance(server_id, bool) or not isinstance(server_id, int) or server_id < 0:
            raise ValueError("server_id must be a non-negative integer")
        if not producers:
            raise ValueError("at least one runtime family producer is required")
        names = [name for name, _ in producers]
        if any(not name for name in names) or len(names) != len(set(names)):
            raise ValueError("runtime producer names must be unique and non-empty")
        self.server_id = server_id
        self.producers = producers
        self.store = store

    def export_state(self) -> dict[str, object]:
        return {
            name: producer.export_state()
            for name, producer in self.producers
            if hasattr(producer, "export_state")
        }

    def restore_state(self, state: Mapping[str, object]) -> None:
        for name, producer in self.producers:
            raw = state.get(name)
            if raw is None:
                continue
            if not isinstance(raw, Mapping):
                raise ValueError(f"composite producer state for {name} must be an object")
            if hasattr(producer, "restore_state"):
                producer.restore_state(raw)

    def publish_poll(self, poll: IngestPollResult) -> RuntimePublicationResult:
        results = [(name, producer.publish_poll(poll)) for name, producer in self.producers]
        snapshots = [
            (name, result.snapshot)
            for name, result in results
            if result.snapshot is not None
        ]
        skipped: dict[str, str] = {}
        published_ids: list[str] = []
        for name, result in results:
            published_ids.extend(result.published_group_ids)
            for group_id, reason in result.skipped_groups.items():
                key = group_id if group_id not in skipped else f"{name}:{group_id}"
                skipped[key] = reason
        if not snapshots:
            return RuntimePublicationResult(None, tuple(published_ids), skipped)

        group_list: list[dict[str, object]] = []
        groups: dict[str, object] = {}
        seen_group_ids: set[str] = set()
        arenas: list[str] = []
        observed_values: list[datetime] = []
        for _name, snapshot in snapshots:
            assert snapshot is not None
            if snapshot.get("schemaVersion") != LIVE_RUNTIME_SCHEMA_VERSION:
                raise ValueError("child producer returned an unsupported runtime schema")
            if snapshot.get("serverId") != str(self.server_id):
                raise ValueError("child producer snapshot belongs to a different server")
            arena = snapshot.get("arena")
            if isinstance(arena, str) and arena:
                arenas.append(arena)
            observed_values.append(_parse_utc(snapshot.get("observedAt")))
            child_groups = snapshot.get("groups")
            if not isinstance(child_groups, Mapping):
                raise ValueError("child runtime groups must be an object")
            for family, group in child_groups.items():
                if family in groups and groups[family] != group:
                    raise ValueError(f"multiple child producers emitted legacy family {family}")
                groups[str(family)] = group
            child_list = snapshot.get("groupList")
            rows = child_list if isinstance(child_list, list) else list(child_groups.values())
            for raw_group in rows:
                if not isinstance(raw_group, Mapping):
                    raise ValueError("child runtime group must be an object")
                group = dict(raw_group)
                group_id = group.get("id")
                if not isinstance(group_id, str) or not group_id:
                    raise ValueError("child runtime group id is required")
                if group_id in seen_group_ids:
                    raise ValueError(f"duplicate runtime group id across families: {group_id}")
                seen_group_ids.add(group_id)
                group_list.append(group)

        observed_at = max(observed_values)
        # Arena is presentation metadata only. Prefer a concrete child value over
        # the SI fallback label; never use it for grouping or scoring.
        concrete_arenas = sorted({arena for arena in arenas if arena != "Operational"})
        arena = concrete_arenas[0] if concrete_arenas else (arenas[0] if arenas else "Operational")
        family_counts: dict[str, int] = {}
        for group in group_list:
            family = str(group.get("family", "?"))
            family_counts[family] = family_counts.get(family, 0) + 1
        status = " · ".join(f"{count} קבוצות {family}" for family, count in sorted(family_counts.items()))
        snapshot: dict[str, object] = {
            "schemaVersion": LIVE_RUNTIME_SCHEMA_VERSION,
            "serverId": str(self.server_id),
            "arena": arena,
            "status": status,
            "observedAt": observed_at.isoformat().replace("+00:00", "Z"),
            "source": {
                "kind": "python-core",
                "health": "healthy",
                "detail": "CompositeRuntimeProducer · SI+SO family-safe atomic snapshot",
            },
            "groups": groups,
            "groupList": group_list,
        }
        self.store.publish(snapshot)
        return RuntimePublicationResult(
            MappingProxyType(snapshot),
            tuple(published_ids),
            skipped,
        )


class PositionEnrichedCompositeRuntimeProducer:
    """Enrich one composite snapshot with same-timestamp real positions before commit."""

    def __init__(self, producer: CompositeRuntimeProducer, store: RuntimeSnapshotStore) -> None:
        self.producer = producer
        self.store = store

    def export_state(self) -> dict[str, object]:
        return self.producer.export_state()

    def restore_state(self, state: Mapping[str, object]) -> None:
        self.producer.restore_state(state)

    def publish_poll(self, poll: IngestPollResult) -> RuntimePublicationResult:
        real_store = self.producer.store
        self.producer.store = DiscardingRuntimeSnapshotStore()  # type: ignore[assignment]
        try:
            result = self.producer.publish_poll(poll)
        finally:
            self.producer.store = real_store
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
    "CompositeRuntimeProducer",
    "DiscardingRuntimeSnapshotStore",
    "PositionEnrichedCompositeRuntimeProducer",
]
