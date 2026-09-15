"""Attach durable SO event evidence storage to an already-built runtime loop.

The operational checkpoint deliberately serializes deterministic Core state, not
infrastructure callbacks. This binding therefore runs *after* the factory (and
any checkpoint restoration) and reattaches the observation sink from the same
``archive.path`` already approved for canonical source-sample retention.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Mapping

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


def attach_event_observation_archive(
    loop: OperationalRuntimeLoop,
    *,
    config_path: str | os.PathLike[str],
) -> SOEventObservationArchive | None:
    """Attach one shared SQLite archive to every server runtime in ``loop``."""

    archive_path = event_archive_path_from_config(config_path)
    if archive_path is None:
        return None
    archive = SOEventObservationArchive(archive_path)
    for pipeline in loop.pipelines:
        pipeline.producer.runtime.observation_sink = archive.record_frame
    return archive


__all__ = [
    "attach_event_observation_archive",
    "event_archive_path_from_config",
    "operational_config_fingerprint",
]
