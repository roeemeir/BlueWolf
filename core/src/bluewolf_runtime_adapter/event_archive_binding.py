"""Attach durable SO event evidence storage to an already-built runtime loop.

The operational checkpoint deliberately serializes deterministic Core state, not
infrastructure callbacks. This binding therefore runs *after* the factory (and
any checkpoint restoration) and reattaches both observation and lifecycle sinks
from the same ``archive.path`` already approved for canonical source-sample
retention.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Mapping

from .event_lifecycle_archive import SOEventLifecycleArchive
from .event_observation_archive import SOEventObservationArchive
from .operational_pipeline import OperationalRuntimeLoop


def _mapping(value: object, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    return value


def _read_config(path: str | os.PathLike[str]) -> Mapping[str, Any]:
    config_path = Path(path).expanduser().resolve(strict=False)
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"cannot read operational config: {config_path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"operational config is not valid JSON: {config_path}") from exc
    return _mapping(raw, "operational config")


def operational_config_fingerprint(path: str | os.PathLike[str]) -> str:
    config = _read_config(path)
    try:
        canonical = json.dumps(
            config,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("operational config must be finite JSON data") from exc
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def event_archive_path_from_config(path: str | os.PathLike[str]) -> Path | None:
    config = _read_config(path)
    archive_raw = config.get("archive")
    if archive_raw is None:
        return None
    archive = _mapping(archive_raw, "archive")
    value = archive.get("path")
    if not isinstance(value, str) or not value.strip():
        raise ValueError("archive.path must be a non-empty string")
    return Path(value).expanduser().resolve(strict=False)




def _family_runtimes(producer: object) -> tuple[object, ...]:
    """Resolve family runtimes from the canonical host or legacy SO wrapper."""

    families = getattr(producer, "families", None)
    if families is not None:
        runtimes: list[object] = []
        for family in families:
            child = getattr(family, "producer", None)
            runtime = getattr(child, "runtime", None)
            if runtime is not None:
                runtimes.append(runtime)
        return tuple(runtimes)
    legacy = getattr(producer, "runtime", None)
    return () if legacy is None else (legacy,)

def attach_event_archives(
    loop: OperationalRuntimeLoop,
    *,
    config_path: str | os.PathLike[str],
) -> tuple[SOEventObservationArchive, SOEventLifecycleArchive] | None:
    """Attach shared observation + lifecycle SQLite archives to every runtime."""

    archive_path = event_archive_path_from_config(config_path)
    if archive_path is None:
        return None
    observation_archive = SOEventObservationArchive(archive_path)
    lifecycle_archive = SOEventLifecycleArchive(archive_path)
    attached_runtime_count = 0
    for pipeline in loop.pipelines:
        for runtime in _family_runtimes(pipeline.producer):
            if hasattr(runtime, "observation_sink"):
                runtime.observation_sink = observation_archive.record_frame
            if hasattr(runtime, "lifecycle_sink"):
                runtime.lifecycle_sink = lifecycle_archive.record_change
            if hasattr(runtime, "observation_sink") or hasattr(runtime, "lifecycle_sink"):
                attached_runtime_count += 1
    if loop.pipelines and attached_runtime_count == 0:
        raise ValueError("operational runtime exposes no event-archive-capable family runtime")
    return observation_archive, lifecycle_archive


def attach_event_observation_archive(
    loop: OperationalRuntimeLoop,
    *,
    config_path: str | os.PathLike[str],
) -> SOEventObservationArchive | None:
    """Backward-compatible wrapper returning the observation archive."""

    attached = attach_event_archives(loop, config_path=config_path)
    return None if attached is None else attached[0]


__all__ = [
    "attach_event_archives",
    "attach_event_observation_archive",
    "event_archive_path_from_config",
    "operational_config_fingerprint",
]
