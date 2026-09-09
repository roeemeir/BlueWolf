"""Atomic restart continuity for the process-local operational runtime.

A checkpoint contains only deterministic runtime state and the published live
runtime cache. Secrets are never persisted. A configuration fingerprint
prevents a watermark/session from being restored under a different Influx
mapping, server tag, template bank or operational binding.

``runtimeHistory`` is an optional V1 extension. Older V1 checkpoints that only
contain ``runtimeSnapshot`` remain valid; newer checkpoints restore bounded
operator history before the latest snapshot so a process restart does not reset
the live timeline.

Checkpoint writes are cadence-limited. The first state-changing tick is saved
immediately; subsequent changes are marked dirty and written no more often than
the configured interval. A graceful host shutdown calls ``flush_checkpoint`` so
pending state is not lost merely because the interval has not elapsed yet.
"""
from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from datetime import UTC, datetime
import json
import math
import os
from pathlib import Path
import tempfile
from typing import Any

from bluewolf_core.live_so_event_runtime import LiveSOEventRuntime

from .operational_pipeline import OperationalRuntimeLoop, OperationalServerPipeline, OperationalTick


OPERATIONAL_STATE_SCHEMA_VERSION = "bluewolf.operational-state.v1"
DEFAULT_CHECKPOINT_INTERVAL_SECONDS = 300.0


class OperationalStateCompatibilityError(ValueError):
    """Persisted operational state cannot safely be applied to this runtime."""


class AtomicOperationalStateStore:
    """One JSON checkpoint replaced atomically on the same filesystem."""

    def __init__(self, path: str | os.PathLike[str]) -> None:
        self.path = Path(path)
        if not str(self.path):
            raise ValueError("operational state path is required")

    def load(self) -> Mapping[str, Any] | None:
        if not self.path.exists():
            return None
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise OperationalStateCompatibilityError(
                f"cannot read operational state: {self.path}"
            ) from exc
        except json.JSONDecodeError as exc:
            raise OperationalStateCompatibilityError(
                f"operational state is not valid JSON: {self.path}"
            ) from exc
        if not isinstance(raw, Mapping):
            raise OperationalStateCompatibilityError("operational state must be an object")
        return raw

    def save(self, state: Mapping[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            payload = json.dumps(
                state,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            )
        except (TypeError, ValueError) as exc:
            raise ValueError("operational state is not JSON serializable") from exc

        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.path.parent,
                prefix=f".{self.path.name}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                temporary_path = Path(handle.name)
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, self.path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink(missing_ok=True)


def _mapping(value: object, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise OperationalStateCompatibilityError(f"{name} must be an object")
    return value


def _runtime_history(pipeline: OperationalServerPipeline) -> list[dict[str, Any]]:
    history = getattr(pipeline.producer.store, "history", None)
    if not callable(history):
        return []
    rows = history(str(pipeline.server_id))
    if not isinstance(rows, list):
        raise ValueError("runtime store history() must return a list")
    output: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, Mapping):
            raise ValueError("runtime store history contains a non-object snapshot")
        output.append(deepcopy(dict(row)))
    return output


def _server_state(pipeline: OperationalServerPipeline) -> dict[str, Any]:
    coordinator = pipeline.coordinator
    producer = pipeline.producer
    checkpoint = coordinator.session.export_checkpoint()
    try:
        core_session = json.loads(checkpoint.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("CoreSession checkpoint is not JSON") from exc
    snapshot = producer.store.get(str(pipeline.server_id))
    return {
        "serverId": pipeline.server_id,
        "coreSession": core_session,
        "cursor": coordinator.cursor.export_state(),
        "liveRuntime": producer.runtime.export_state(),
        "producer": producer.export_state(),
        "runtimeHistory": _runtime_history(pipeline),
        "runtimeSnapshot": snapshot,
    }


def export_operational_state(
    loop: OperationalRuntimeLoop,
    *,
    config_fingerprint: str,
) -> dict[str, Any]:
    if not config_fingerprint:
        raise ValueError("config_fingerprint is required")
    return {
        "schemaVersion": OPERATIONAL_STATE_SCHEMA_VERSION,
        "configFingerprint": config_fingerprint,
        "servers": [_server_state(pipeline) for pipeline in loop.pipelines],
    }


def _restore_runtime_cache(producer, raw: Mapping[str, Any]) -> None:
    history_raw = raw.get("runtimeHistory", [])
    if not isinstance(history_raw, list):
        raise OperationalStateCompatibilityError("runtimeHistory must be a list when supplied")
    for index, snapshot in enumerate(history_raw):
        if not isinstance(snapshot, Mapping):
            raise OperationalStateCompatibilityError(
                f"runtimeHistory[{index}] must be an object"
            )
        producer.store.publish(deepcopy(dict(snapshot)))

    snapshot = raw.get("runtimeSnapshot")
    if snapshot is not None:
        if not isinstance(snapshot, Mapping):
            raise OperationalStateCompatibilityError("runtimeSnapshot must be an object or null")
        # Same-observedAt publication is idempotent in RuntimeSnapshotStore and
        # keeps backward compatibility with checkpoints that only had this field.
        producer.store.publish(deepcopy(dict(snapshot)))


def _restore_pipeline(pipeline: OperationalServerPipeline, raw: Mapping[str, Any]) -> None:
    if raw.get("serverId") != pipeline.server_id:
        raise OperationalStateCompatibilityError("operational state server id mismatch")

    coordinator = pipeline.coordinator
    producer = pipeline.producer
    core_raw = _mapping(raw.get("coreSession"), "coreSession")
    cursor_raw = _mapping(raw.get("cursor"), "cursor")
    runtime_raw = _mapping(raw.get("liveRuntime"), "liveRuntime")
    producer_raw = _mapping(raw.get("producer"), "producer")

    checkpoint = json.dumps(
        core_raw,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    current_session = coordinator.session
    restored_session = type(current_session).from_checkpoint(
        checkpoint,
        config=current_session.config,
        algorithm_version=current_session.algorithm_version,
    )

    current_cursor = coordinator.cursor
    restored_cursor = type(current_cursor)(current_cursor.config)
    restored_cursor.restore_state(dict(cursor_raw))

    current_runtime = producer.runtime
    restored_runtime, invalidated = LiveSOEventRuntime.from_state(
        current_runtime.bank,
        runtime_raw,
        scoring_config=current_runtime.scorer.scoring_config,
        event_config=current_runtime.event_engine.config,
    )
    if invalidated:
        ids = ", ".join(item.template_id for item in invalidated)
        raise OperationalStateCompatibilityError(
            f"persisted manual template selections are invalid under current bank: {ids}"
        )

    # Producer validation mutates only after the complete active-group list is
    # validated, so perform it before swapping the larger runtime objects.
    producer.restore_state(producer_raw)
    coordinator.session = restored_session
    coordinator.cursor = restored_cursor
    producer.session = restored_session
    producer.runtime = restored_runtime
    _restore_runtime_cache(producer, raw)


def restore_operational_state(
    loop: OperationalRuntimeLoop,
    state: Mapping[str, Any],
    *,
    config_fingerprint: str,
) -> None:
    if state.get("schemaVersion") != OPERATIONAL_STATE_SCHEMA_VERSION:
        raise OperationalStateCompatibilityError("unsupported operational state schema")
    if state.get("configFingerprint") != config_fingerprint:
        raise OperationalStateCompatibilityError(
            "operational state configuration fingerprint does not match"
        )
    raw_servers = state.get("servers")
    if not isinstance(raw_servers, list):
        raise OperationalStateCompatibilityError("operational state servers must be a list")
    by_id: dict[int, Mapping[str, Any]] = {}
    for raw in raw_servers:
        value = _mapping(raw, "server state")
        server_id = value.get("serverId")
        if isinstance(server_id, bool) or not isinstance(server_id, int):
            raise OperationalStateCompatibilityError("server state id must be an integer")
        if server_id in by_id:
            raise OperationalStateCompatibilityError("duplicate server id in operational state")
        by_id[server_id] = value

    expected = {pipeline.server_id for pipeline in loop.pipelines}
    if set(by_id) != expected:
        raise OperationalStateCompatibilityError(
            "operational state server set does not match current configuration"
        )
    for pipeline in loop.pipelines:
        _restore_pipeline(pipeline, by_id[pipeline.server_id])


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("checkpoint time must be timezone-aware")
    return value.astimezone(UTC)


def _configured_checkpoint_interval(
    pipelines: tuple[OperationalServerPipeline, ...],
) -> float:
    values: list[float] = []
    for pipeline in pipelines:
        coordinator = getattr(pipeline, "coordinator", None)
        session = getattr(coordinator, "session", None)
        config = getattr(session, "config", None)
        timing = getattr(config, "timing", None)
        raw = getattr(timing, "checkpoint_seconds", None)
        if raw is None:
            continue
        value = float(raw)
        if not math.isfinite(value) or value <= 0.0:
            raise ValueError("Core timing checkpoint_seconds must be finite and positive")
        values.append(value)
    # A shared state file must satisfy the most frequent configured requirement.
    return min(values) if values else DEFAULT_CHECKPOINT_INTERVAL_SECONDS


class CheckpointedOperationalRuntimeLoop(OperationalRuntimeLoop):
    """Operational loop with bounded checkpoint I/O and explicit shutdown flush."""

    def __init__(
        self,
        pipelines: tuple[OperationalServerPipeline, ...],
        *,
        state_store: AtomicOperationalStateStore,
        config_fingerprint: str,
        checkpoint_interval_seconds: float | None = None,
    ) -> None:
        super().__init__(pipelines)
        if not config_fingerprint:
            raise ValueError("config_fingerprint is required")
        interval = (
            _configured_checkpoint_interval(self.pipelines)
            if checkpoint_interval_seconds is None
            else float(checkpoint_interval_seconds)
        )
        if not math.isfinite(interval) or interval <= 0.0:
            raise ValueError("checkpoint_interval_seconds must be finite and positive")
        self.state_store = state_store
        self.config_fingerprint = config_fingerprint
        self.checkpoint_interval_seconds = interval
        self._dirty = False
        self._last_checkpoint_utc: datetime | None = None
        restored = self.state_store.load()
        if restored is not None:
            restore_operational_state(
                self,
                restored,
                config_fingerprint=self.config_fingerprint,
            )

    @property
    def checkpoint_dirty(self) -> bool:
        return self._dirty

    @property
    def last_checkpoint_utc(self) -> datetime | None:
        return self._last_checkpoint_utc

    def _write_checkpoint(self, *, at_utc: datetime | None) -> None:
        self.state_store.save(
            export_operational_state(
                self,
                config_fingerprint=self.config_fingerprint,
            )
        )
        self._dirty = False
        if at_utc is not None:
            self._last_checkpoint_utc = _utc(at_utc)

    def save_checkpoint(self) -> None:
        """Force an immediate checkpoint, preserving the pre-cadence public API."""
        self._write_checkpoint(at_utc=None)

    def flush_checkpoint(self) -> bool:
        """Persist pending state once; return whether a write was required."""
        if not self._dirty:
            return False
        self._write_checkpoint(at_utc=None)
        return True

    def _checkpoint_due(self, at_utc: datetime) -> bool:
        at = _utc(at_utc)
        if self._last_checkpoint_utc is None:
            return True
        elapsed = (at - self._last_checkpoint_utc).total_seconds()
        return elapsed >= self.checkpoint_interval_seconds

    def tick(self, now_utc) -> OperationalTick:
        tick = super().tick(now_utc)
        changed = bool(tick.errors) or any(
            result.poll is not None for result in tick.results.values()
        )
        if changed:
            self._dirty = True
            if self._checkpoint_due(tick.at_utc):
                self._write_checkpoint(at_utc=tick.at_utc)
        return tick


__all__ = [
    "DEFAULT_CHECKPOINT_INTERVAL_SECONDS",
    "OPERATIONAL_STATE_SCHEMA_VERSION",
    "AtomicOperationalStateStore",
    "CheckpointedOperationalRuntimeLoop",
    "OperationalStateCompatibilityError",
    "export_operational_state",
    "restore_operational_state",
]
